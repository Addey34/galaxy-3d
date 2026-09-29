#!/usr/bin/env node
/* global console, process, fetch, URLSearchParams, setTimeout, URL, Response, Buffer */
/**
 * Validation numérique des positions de Galaxy contre JPL Horizons.
 *
 * Ce que ce script mesure, et rien d'autre : pour chaque corps et chaque SOURCE de position
 * réellement branchée dans l'application (astronomy-engine, binaires Horizons, éléments
 * képlériens, noyau SPK), l'écart entre la position que calcule le CODE DE L'APPLICATION et
 * celle que renvoie l'API Horizons, sur un échantillon de dates couvrant la plage de la source.
 * Il ne conclut rien : il produit un rapport (moyenne, médiane, p95, max, en km et en rayons du
 * corps), et c'est la lecture de ce rapport qui décide.
 *
 * Trois choix qui conditionnent la validité de la mesure :
 *
 *   - Le code mesuré est CELUI DE L'APPLICATION, chargé par le chargeur de modules de Vite
 *     (`ssrLoadModule`, comme le plugin des pages par corps), jamais une copie : une formule
 *     recopiée ici validerait la copie. Seule la conversion de la référence Horizons vers le
 *     repère scène est réécrite, volontairement : si `frames.ts` se trompait de repère, un
 *     script qui l'emprunterait pour la référence ne le verrait pas.
 *   - Les dates d'échantillon tombent à des fractions de jour pseudo-aléatoires (graine fixe) :
 *     des dates alignées sur la grille de 4 jours des binaires masqueraient exactement l'erreur
 *     d'interpolation qu'on cherche.
 *   - La référence est demandée en TEMPS UT (`TIME_TYPE=UT`) : l'application reçoit une `Date`
 *     JavaScript, donc de l'UTC ; toute erreur de conversion UTC → TDB côté application est
 *     donc DANS la mesure, pas hors d'elle.
 *
 * Deux repères, parce qu'ils répondent à deux questions :
 *   - « relatif » : un satellite dans le repère de son parent, tel que la source le fournit.
 *     C'est l'erreur PROPRE de la source, sans celle du parent.
 *   - « héliocentrique » : pour les corps héliocentriques, la sortie de la source ; pour la
 *     ligne « production », la position composée comme la scène la compose (parent + relatif,
 *     chaque terme par la règle de priorité de `BodyPositionResolver`).
 *
 * Les réponses Horizons sont mises en cache sur disque (`.cache/horizons-validation/`, clé =
 * empreinte de la requête complète) : une seconde exécution ne touche plus l'API. Les requêtes
 * partent en série, avec une pause, comme le demande JPL.
 *
 *   node scripts/validate-against-horizons.mjs
 *     [--samples 48]            dates par (corps, fenêtre)
 *     [--only titan,ceres]      restreindre aux corps listés
 *     [--providers kepler,spk]  restreindre aux sources listées
 *     [--offline]               échouer plutôt qu'appeler l'API sur un défaut de cache
 *     [--out reports/horizons-validation]
 *
 * Auto-contrôle (falsification) — une erreur CONNUE injectée dans la sortie de l'application :
 *     [--inject-km 1000]        décale chaque position calculée de 1000 km (axe X scène)
 *     [--inject-seconds 60]     décale la date passée à l'application de 60 s ; le rapport
 *                               affiche alors l'erreur prédite |v|·Δt à côté de la mesurée
 *     [--inject-provider kepler] limiter l'injection à une source
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const CACHE_DIR = join(ROOT, '.cache', 'horizons-validation');
const KM_PER_AU = 149_597_870.7;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2_440_587.5;
const MS_PER_JULIAN_YEAR = 365.25 * MS_PER_DAY;
const REQUEST_PAUSE_MS = 1_200;
const SPK_FILE = join(ROOT, 'public', 'assets', 'kernels', 'sat441l.bsp');
const SPK_FAKE_URL = 'http://galaxy.validation/assets/kernels/sat441l.bsp';

// ───────────────────────────── options ─────────────────────────────

const argv = process.argv.slice(2);
const option = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i === -1 ? fallback : argv[i + 1];
};
const list = (flag) =>
  option(flag)
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? null;

const SAMPLES = Number(option('--samples', '48'));
const ONLY = list('--only');
const PROVIDERS = list('--providers');
const OFFLINE = argv.includes('--offline');
const OUT = option('--out', 'reports/horizons-validation');
const INJECT_KM = Number(option('--inject-km', '0'));
const INJECT_SECONDS = Number(option('--inject-seconds', '0'));
const INJECT_PROVIDER = option('--inject-provider', null);
const INJECTING = INJECT_KM !== 0 || INJECT_SECONDS !== 0;

// ─────────────────── identifiants Horizons par corps ───────────────────
//
// `command` : cible Horizons. Un « ; » final UNIQUEMENT pour un numéro de petit corps (cf.
// CLAUDE.md, « 699; » résout l'astéroïde 699 Hela). `expect` : fragment que le nom renvoyé par
// Horizons doit contenir, vérifié à chaque réponse — une cible mal résolue produit sinon une
// « erreur » parfaitement plausible.

// DONNÉE, pas du code : la table vit dans `validation-targets.json`, à côté de ce
// script. Ajouter un corps au catalogue n'exige plus de toucher ce fichier.
const TARGETS = JSON.parse(
  readFileSync(new URL('./validation-targets.json', import.meta.url), 'utf8')
).targets;

/** Centre Horizons (corps, pas barycentre) pour un parent du catalogue. */
// DONNÉE, pas du code : la table vit dans `validation-targets.json`, à côté de ce
// script. Ajouter un corps au catalogue n'exige plus de toucher ce fichier.
const CENTERS = JSON.parse(
  readFileSync(new URL('./validation-targets.json', import.meta.url), 'utf8')
).centers;

/** Enum astronomy-engine → clé de `CENTERS`. */
const ASTRO_CENTER = {
  EMB: 'emb',
  Earth: 'earth',
  Mars: 'mars',
  Jupiter: 'jupiter',
  Saturn: 'saturn',
  Uranus: 'uranus',
  Neptune: 'neptune',
  Pluto: 'pluto',
};

// ───────────────────────────── utilitaires ─────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jdOf = (ms) => ms / MS_PER_DAY + UNIX_EPOCH_JD;
const iso = (ms) => new Date(ms).toISOString();
const utc = (s) => Date.parse(s);

/** PRNG déterministe (mulberry32) : même graine → mêmes dates → cache réutilisable. */
function rng(seedText) {
  let seed = createHash('sha256').update(seedText).digest().readUInt32LE(0);
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Échantillon stratifié : une date par strate, à une position aléatoire dans la strate,
 * arrondie à la milliseconde. Couvre toute la plage sans jamais tomber sur une grille.
 */
function sampleDates(seedText, fromMs, toMs, count) {
  const random = rng(seedText);
  const span = toMs - fromMs;
  return Array.from({ length: count }, (_, i) =>
    Math.round(fromMs + ((i + random()) / count) * span)
  );
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / (sorted.length || NaN);
  return {
    mean,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? NaN,
  };
}

/** Écliptique J2000 Horizons → repère scène. Réécrit ici à dessein (cf. en-tête). */
const eclipticKmToScene = ([x, y, z]) => [x, z, -y];

// ───────────────────────────── Horizons ─────────────────────────────

let apiCalls = 0;
let cacheHits = 0;

/**
 * Vecteurs Horizons (km, km/s, écliptique ICRF, géométriques) de `command` vu depuis `center`
 * aux instants `datesMs` (UT). Renvoie `{ rows }` ou `{ error }` — une plage refusée par
 * Horizons est une information du rapport, pas une panne du script.
 *
 * Pour un petit corps dont Horizons INTÈGRE la solution (ligne `EPOCH=` de l'en-tête), la liste
 * est coupée à l'époque et demandée en deux fois. Une liste unique étalée sur deux siècles se
 * comporte comme une intégration partie de sa première date : mesuré au lot 11 sur Itokawa (qui
 * croise souvent la Terre), aux 48 dates de 1900-2100, le binaire livré s'écartait de 775 km en
 * moyenne de la liste unique, et de 3,7 km de requêtes courtes, une par date. La référence
 * mesurait donc sa propre dérive, pas l'erreur de l'application. Les deux moitiés partent de
 * l'époque et coïncident avec les requêtes courtes (0,00 à 0,18 km, mesuré sur Itokawa).
 */
async function horizonsVectors(targetKey, centerKey, datesMs, override) {
  const whole = await horizonsVectorsOnce(
    targetKey,
    centerKey,
    datesMs,
    override
  );
  if (whole.error || !(whole.epochJd > 0)) return whole;
  const before = [];
  const after = [];
  datesMs.forEach((ms, i) =>
    (jdOf(ms) < whole.epochJd ? before : after).push(i)
  );
  if (before.length === 0 || after.length === 0) return whole;
  const rows = new Array(datesMs.length);
  for (const indices of [before, after]) {
    const part = await horizonsVectorsOnce(
      targetKey,
      centerKey,
      indices.map((i) => datesMs[i]),
      override
    );
    if (part.error) return part;
    indices.forEach((i, k) => (rows[i] = part.rows[k]));
  }
  return { ...whole, rows };
}

/**
 * `override` (lot 39) remplace la cible ou le centre de la requête sans toucher aux tables :
 * `{ target: { command, expect } }` pour interroger le BARYCENTRE d'un système aux époques où
 * l'API refuse le corps, `{ center: { id, expect } }` pour mesurer l'écart du corps À ce
 * barycentre. Le contrôle du nom renvoyé s'applique aux deux, et il n'a pas de valeur par
 * défaut sur une substitution : « Jupiter Barycenter » contient « jupiter », donc le contrôle
 * ordinaire ne verrait pas la différence.
 */
async function horizonsVectorsOnce(targetKey, centerKey, datesMs, override) {
  const target = override?.target ?? TARGETS[targetKey];
  const center = override?.center ?? CENTERS[centerKey];
  if (!target)
    throw new Error(`Pas d'identifiant Horizons pour « ${targetKey} »`);
  const params = {
    format: 'json',
    COMMAND: `'${target.command}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'500@${center.id}'`,
    TLIST: datesMs.map((ms) => jdOf(ms).toFixed(9)).join(' '),
    TLIST_TYPE: 'JD',
    TIME_TYPE: 'UT',
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF',
    OUT_UNITS: 'KM-S',
    VEC_TABLE: '2',
    VEC_CORR: 'NONE',
    CSV_FORMAT: 'YES',
  };
  const query = new URLSearchParams(params).toString();
  const key = createHash('sha256').update(query).digest('hex').slice(0, 32);
  const cacheFile = join(CACHE_DIR, `${key}.json`);

  let text;
  if (existsSync(cacheFile)) {
    text = JSON.parse(readFileSync(cacheFile, 'utf-8')).result;
    cacheHits++;
  } else {
    if (OFFLINE)
      throw new Error(
        `--offline : réponse absente du cache (${targetKey}@${centerKey})`
      );
    for (let attempt = 0; ; attempt++) {
      if (apiCalls > 0) await sleep(REQUEST_PAUSE_MS);
      apiCalls++;
      let response;
      try {
        response = await fetch(`${API_URL}?${query}`);
      } catch (error) {
        if (attempt >= 4) throw error;
        await sleep(10_000);
        continue;
      }
      const body = await response.text();
      let json = null;
      try {
        json = JSON.parse(body);
      } catch {
        /* réponse non JSON : transitoire, on réessaie */
      }
      const result = json?.result ?? json?.error;
      // Définitif : un bloc d'éphéméride, ou un refus de plage nommé par Horizons.
      if (
        response.ok &&
        typeof result === 'string' &&
        (result.includes('$$SOE') || /No ephemeris/i.test(result))
      ) {
        text = result;
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(
          cacheFile,
          JSON.stringify({
            query: params,
            fetchedAt: new Date().toISOString(),
            result,
          })
        );
        break;
      }
      if (attempt >= 4)
        throw new Error(
          `Horizons ${targetKey}@${centerKey} : HTTP ${response.status}\n${String(result ?? body).slice(0, 600)}`
        );
      await sleep(15_000);
    }
  }

  if (!text.includes('$$SOE')) {
    const reason =
      text.match(/No ephemeris[^\n]*/)?.[0] ??
      text.trim().split('\n').slice(-3).join(' ');
    return { error: reason.trim() };
  }

  const targetName = text.match(/Target body name:\s*(.+?)\s*\{/)?.[1] ?? '';
  const centerName = text.match(/Center body name:\s*(.+?)\s*\{/)?.[1] ?? '';
  const expectTarget = target.expect ?? targetKey;
  if (!targetName.toLowerCase().includes(expectTarget))
    throw new Error(
      `${targetKey} : Horizons a résolu « ${target.command} » en « ${targetName} » (attendu « ${expectTarget} »)`
    );
  if (!centerName.toLowerCase().includes(center.expect))
    throw new Error(
      `${targetKey} : centre résolu en « ${centerName} » (attendu « ${center.expect} »)`
    );

  const block = text.slice(text.indexOf('$$SOE') + 5, text.indexOf('$$EOE'));
  const rows = block
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const f = line.split(',').map((s) => s.trim());
      const values = f.slice(2, 8).map(Number);
      return {
        jd: Number(f[0]),
        position: values.slice(0, 3),
        velocity: values.slice(3, 6),
      };
    });
  if (rows.length !== datesMs.length)
    throw new Error(
      `${targetKey}@${centerKey} : ${rows.length} lignes pour ${datesMs.length} dates demandées`
    );
  rows.forEach((row, i) => {
    // 1e-6 jour = 86 ms : Horizons imprime le JD tronqué, pas une autre date.
    if (!(Math.abs(row.jd - jdOf(datesMs[i])) < 1e-6))
      throw new Error(
        `${targetKey}@${centerKey} : ligne ${i} datée JD ${row.jd}, demandée ${jdOf(datesMs[i])}`
      );
    if (row.position.some((v) => !Number.isFinite(v)))
      throw new Error(`${targetKey}@${centerKey} : ligne ${i} non numérique`);
  });
  // Époque de la solution intégrée, absente pour un corps que Horizons lit dans un fichier
  // (planète, satellite, Bennu servi par le fichier de la mission OSIRIS-REx).
  const epochJd = Number(text.match(/EPOCH=\s*([\d.]+)/)?.[1]);
  return { rows, targetName, centerName, epochJd };
}

// ───────────────────── chargement du code de l'application ─────────────────────

const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': join(ROOT, 'src') } },
});
const load = (path) => loader.ssrLoadModule(path);

const { CELESTIAL_CONFIG } = await load('/src/config/bodies.ts');
const { forEachBody } = await load('/src/config/catalog.ts');
const { SPK_SETTINGS } = await load('/src/config/engine.ts');
const { INTERSTELLAR_OBJECTS, interstellarWindow } = await load(
  '/src/config/interstellar.ts'
);
const { EphemerisService } = await load('/src/core/EphemerisService.ts');
const { OrbitalElementsService } = await load(
  '/src/core/OrbitalElementsService.ts'
);
const { OrbitalMechanics } = await load('/src/core/OrbitalMechanics.ts');
const { SimulationClock } = await load('/src/core/SimulationClock.ts');
const { keplerianPositionEcliptic } = await load('/src/core/kepler.ts');
const { eclipticToScene, equatorialToScene } = await load(
  '/src/core/frames.ts'
);
const { etSecondsFromDate } = await load('/src/core/SpkKernel.ts');
const { horizonsServiceFromDisk, horizonsManifest } = await load(
  '/src/core/horizonsTestFixture.ts'
);

const ephemeris = new EphemerisService();
const elementsService = new OrbitalElementsService();
const horizonsService = horizonsServiceFromDisk();

/**
 * Le résolveur de PRODUCTION, construit par `OrbitalMechanics` lui-même : ses tables de
 * parents sont donc exactement celles de l'application, pas une reconstitution. Source précise
 * = binaires Horizons seuls, comme en ligne (le SPK n'y est actif que si VITE_SPK_KERNEL_URL
 * est défini, ce qui n'est le cas nulle part dans la CI de déploiement).
 */
const mechanics = new OrbitalMechanics(
  new SimulationClock(),
  ephemeris,
  elementsService,
  horizonsService,
  CELESTIAL_CONFIG,
  {}
);
const resolver = mechanics._positions;
if (!resolver)
  throw new Error(
    'OrbitalMechanics._positions introuvable : le résolveur a changé de nom'
  );

// ── SPK : le vrai Worker (`SpkKernelWorker.ts`) exécuté dans ce processus ──
//
// Le Worker lit le noyau par requêtes HTTP Range. On lui sert le fichier local par un `fetch`
// intercepté, et on route ses `postMessage` vers le client : c'est le chemin de production
// (annuaire des segments, chargement par segment, composition via centre commun), pas un
// raccourci `SpkKernel.parse`.
let spk = null;
const spkStatus = {
  kernel: existsSync(SPK_FILE),
  enabledInProduction: Boolean(SPK_SETTINGS.url),
};
if (spkStatus.kernel && (!PROVIDERS || PROVIDERS.includes('spk'))) {
  const handle = await open(SPK_FILE, 'r');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith(SPK_FAKE_URL)) return realFetch(input, init);
    const [, start, end] =
      /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? '') ?? [];
    if (start === undefined) return new Response(null, { status: 416 });
    const length = Number(end) - Number(start) + 1;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Number(start));
    return new Response(buffer, { status: 206 });
  };
  const waiting = new Map();
  globalThis.location = new URL('http://galaxy.validation/');
  globalThis.postMessage = (message) => {
    const pending = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.type === 'error') pending?.reject(new Error(message.message));
    else pending?.resolve(message);
  };
  await load('/src/core/SpkKernelWorker.ts');
  let nextId = 1;
  const call = (request) =>
    new Promise((resolvePromise, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve: resolvePromise, reject });
      globalThis.onmessage({ data: { ...request, id } });
    });
  const transport = {
    loadUrl: (url) => call({ type: 'loadUrl', url }).then((m) => m.segments),
    getState: (target, center, etSeconds) =>
      call({ type: 'state', target, center, etSeconds }).then((m) => m.state),
    dispose: () => undefined,
  };
  const { SpkWorkerEphemerisProvider } = await load(
    '/src/core/SpkWorkerEphemerisProvider.ts'
  );
  const provider = new SpkWorkerEphemerisProvider(
    transport,
    SPK_SETTINGS.bodyIds ?? {}
  );
  await provider.loadUrl('/assets/kernels/sat441l.bsp');
  // La façade est synchrone : premier appel = requête au Worker, second = état en cache.
  const settle = async (read) => {
    const first = read();
    if (first) return first;
    while (provider.pending.size > 0) await sleep(0);
    return read();
  };
  spk = { provider, settle, transport };
}

// ───────────────────────────── plan de mesure ─────────────────────────────

const CORE = {
  id: '1900–2100',
  kind: 'fixed',
  from: utc('1900-01-01T00:00:00Z'),
  to: utc('2100-12-31T00:00:00Z'),
};
const EXTENDED = {
  id: '1600–2400',
  kind: 'fixed',
  from: utc('1600-01-01T00:00:00Z'),
  to: utc('2400-01-01T00:00:00Z'),
};
// Horizons ne sert les satellites que sur une plage bornée (Io : jusqu'en 2200, Titan : depuis
// 1750) : au-delà, la RÉFÉRENCE manque, pas la source. D'où une fenêtre étendue propre aux lunes.
const MOON_EXTENDED = {
  id: '1800–2199',
  kind: 'fixed',
  from: utc('1800-01-01T00:00:00Z'),
  to: utc('2199-12-01T00:00:00Z'),
};
const SPK_WINDOW = MOON_EXTENDED;

function binaryWindow(entry) {
  const startMs = (entry.startJdTdb - UNIX_EPOCH_JD) * MS_PER_DAY;
  const stopMs =
    startMs + (entry.sampleCount - 1) * entry.stepDays * MS_PER_DAY;
  // Un jour de marge de chaque côté : l'écart TDB−UTC ne doit pas faire sortir un échantillon.
  return {
    id: `binaire ${iso(startMs).slice(0, 10)}→${iso(stopMs).slice(0, 10)}`,
    kind: 'binary',
    from: startMs + MS_PER_DAY,
    to: stopMs - MS_PER_DAY,
  };
}

function epochWindow(epoch) {
  const e = epoch.getTime();
  return {
    id: `époque ${iso(e).slice(0, 10)} ±10 ans`,
    kind: 'epoch',
    from: e - 10 * MS_PER_JULIAN_YEAR,
    to: e + 10 * MS_PER_JULIAN_YEAR,
  };
}

// ─────────────────── la profondeur du temps (lot 39) ───────────────────
//
// L'horloge de Galaxy accepte n'importe quelle date, et la fiche disait « écart à Horizons non
// mesuré » dès qu'on sortait de 1600-2400 : honnête, mais muet. Ce qui manquait n'était pas une
// interface, c'était le CHIFFRE — la fiche affiche déjà la fenêtre qui contient la date.
//
// Ce que l'API sert, MESURÉ le 2026-09-29 et non supposé : le centre d'une planète vient d'une
// théorie de satellites bornée (Jupiter 1600, Saturne 1749, Neptune et Pluton 1800), alors que
// les BARYCENTRES et les corps de DE441 (Mercure, Vénus, la Terre, la Lune) remontent au
// 9999-MAR-15 av. J.-C. et vont jusqu'au 9999-DEC-30. D'où la substitution, déclarée par corps
// dans `validation-targets.json` et jamais devinée ici.
//
// La substitution a un PLANCHER : l'écart entre le corps et son barycentre, que le script mesure
// (`measureFloor`) au lieu de le recopier. Une ligne dont le plancher dépasse un centième de
// l'écart mesuré n'est PAS publiée : la fiche imprime deux chiffres significatifs, donc en deçà
// la substitution ne peut pas changer ce que le visiteur lit.
//
// Le pas est le MILLÉNAIRE. Il n'est pas arbitraire : l'écart d'astronomy-engine croît lentement
// (mesuré sur Jupiter : 29 218 km en 2000, 30 596 en 1600, 119 119 en 1002), et la fiche nomme
// toujours la fenêtre à côté du chiffre, comme elle le fait déjà pour 1900-2100.

const DEEP_TILE_YEARS = 1000;
/** Première année mesurée : l'ère chrétienne. Avant, voir le § « Ce qui reste » du lot 39. */
const DEEP_FIRST_YEAR = 1;
/** Dernier instant servi par l'API (9999-DEC-30), moins une marge de dix jours. */
const DEEP_LAST_MS = utc('9999-12-20T00:00:00Z');
/** Fraction de l'écart mesuré en deçà de laquelle le plancher de substitution est publiable. */
const PUBLISHABLE_FLOOR_FRACTION = 0.01;
/**
 * Fenêtre du témoin : la plus large où Horizons sert le corps ET son barycentre pour les SIX
 * corps substitués (Saturne commence au 1749-12-30, Neptune et Pluton au 1800-01-02, Jupiter
 * s'arrête au 1600-01-10 → 2200-01-08). Aucune ne s'y fait recadrer, et c'est indispensable :
 * un recadrage donnerait deux jeux de dates différents aux deux lignes du témoin, qui ne
 * pourraient plus se comparer.
 */
const WITNESS_WINDOW = {
  id: 'témoin 1801-2199',
  kind: 'fixed',
  from: utc('1801-01-01T00:00:00Z'),
  to: utc('2199-12-01T00:00:00Z'),
};
/**
 * Au-delà de ce multiple du rayon du corps, un plancher ne décrit plus un barycentre de système
 * planétaire — le plus excentré, celui de Pluton-Charon, est à 1,8 rayon — mais une erreur de
 * repère ou de centre. Le script s'arrête alors : c'est le garde-fou du piège documenté par ce
 * dépôt, où comparer une position héliocentrique au barycentre du SYSTÈME SOLAIRE ajoute un
 * million de km parfaitement plausible.
 */
const ABSURD_FLOOR_RADII = 10;

/** `Date.UTC` place les années 0-99 en 1900-1999 : ce détour est la raison de cette fonction. */
function yearStartMs(year) {
  const d = new Date(0);
  d.setUTCFullYear(year, 0, 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

const DEEP_TILES = [];
for (let year = 0; year < 10_000; year += DEEP_TILE_YEARS) {
  const from = yearStartMs(Math.max(year, DEEP_FIRST_YEAR));
  const to = Math.min(yearStartMs(year + DEEP_TILE_YEARS), DEEP_LAST_MS);
  if (!(to > from)) continue;
  const lastYear = new Date(to - MS_PER_DAY).getUTCFullYear();
  DEEP_TILES.push({
    id: `an ${new Date(from).getUTCFullYear()}-${lastYear}`,
    kind: 'deep',
    from,
    to,
  });
}

/**
 * Distance GÉOMÉTRIQUE entre un corps et le barycentre qui le remplace aux époques profondes,
 * demandée à Horizons en une fois (cible = le corps, centre = le barycentre), aux dates du
 * témoin.
 *
 * Ce n'est PAS le plancher, et les confondre coûtait le lot : pour Uranus cette distance ne
 * dépasse jamais 44 km, alors que la DIFFÉRENCE des deux positions héliocentriques atteint
 * 4 831 km (nulle vers 1986, l'époque du survol de Voyager 2). Horizons n'est donc pas
 * cohérent avec lui-même sur ce corps : le barycentre qu'il sert comme cible et celui qu'implique
 * son éphéméride de satellites ne sont pas le même point. Le plancher qui compte est celui du
 * chemin RÉELLEMENT emprunté, mesuré par le témoin ; cette distance-ci reste mesurée à côté,
 * parce que c'est leur désaccord qui a révélé le fait.
 */
async function measureSeparation(body, deep, dates) {
  const answer = await horizonsVectors(body, 'sun', dates, {
    center: { id: deep.command, expect: deep.expect },
  });
  if (answer.error) throw new Error(`séparation ${body} : ${answer.error}`);
  const km = answer.rows.map((r) => Math.hypot(...r.position));
  return { maxKm: Math.max(...km), minKm: Math.min(...km), n: km.length };
}

/**
 * Un « cas » = (corps, source, repère, fenêtre) : une fonction date → position scène (UA) ou
 * null, et le centre Horizons de référence.
 */
const cases = [];
const addCase = (c) => {
  if (ONLY && !ONLY.includes(c.body)) return;
  if (PROVIDERS && !PROVIDERS.includes(c.provider)) return;
  cases.push(c);
};

const bodyInfo = new Map();

forEachBody(CELESTIAL_CONFIG, ({ name, config: cfg, parentName }) => {
  if (cfg.kind === 'skybox' || cfg.kind === 'star') return;
  const radiusKm = cfg.realData?.radiusKm;
  const relative = cfg.frame === 'parentRelative';
  bodyInfo.set(name, { radiusKm, parentName, relative });
  const parentCenter = relative ? parentName : 'sun';
  const frame = relative ? `relatif à ${parentName}` : 'héliocentrique';
  const extended = relative ? MOON_EXTENDED : EXTENDED;
  // La source qui répond à TOUTE date, donc la seule que les millénaires profonds puissent
  // mesurer. Renseignée par la branche qui s'applique, jamais devinée deux fois.
  let anyDate = null;

  // astronomy-engine — les trois branches réellement appelées par `resolve()`.
  if (cfg.relativeEphemeris?.kind === 'jupiterMoon') {
    const moon = cfg.relativeEphemeris.moon;
    anyDate = {
      provider: 'astronomy-engine',
      frame,
      center: 'jupiter',
      compute: (date) => ephemeris.getJupiterMoonRelativeAU(moon, date),
    };
    for (const window of [CORE, extended])
      addCase({
        body: name,
        provider: 'astronomy-engine',
        frame,
        center: 'jupiter',
        window,
        compute: (date) => ephemeris.getJupiterMoonRelativeAU(moon, date),
      });
  } else if (cfg.astroBody !== undefined) {
    if (relative) {
      const parentAstro = mechanics._parentAstroBody.get(name);
      const center = ASTRO_CENTER[parentAstro];
      anyDate = {
        provider: 'astronomy-engine',
        frame: `relatif à ${parentName} (${parentAstro})`,
        center,
        compute: (date) =>
          ephemeris.getParentRelativeAU(cfg.astroBody, parentAstro, date),
      };
      for (const window of [CORE, extended])
        addCase({
          body: name,
          provider: 'astronomy-engine',
          frame: `relatif à ${parentName} (${parentAstro})`,
          center,
          window,
          compute: (date) =>
            ephemeris.getParentRelativeAU(cfg.astroBody, parentAstro, date),
        });
    } else {
      const astro = cfg.positionBody ?? cfg.astroBody;
      anyDate = {
        provider: 'astronomy-engine',
        frame: astro === cfg.astroBody ? frame : `héliocentrique (${astro})`,
        center: 'sun',
        compute: (date) => ephemeris.getHeliocentricAU(astro, date),
      };
      for (const window of [CORE, extended])
        addCase({
          body: name,
          provider: 'astronomy-engine',
          frame: astro === cfg.astroBody ? frame : `héliocentrique (${astro})`,
          center: 'sun',
          window,
          compute: (date) => ephemeris.getHeliocentricAU(astro, date),
        });
    }
  }

  // Binaires Horizons — via `precise()`, donc avec le test de plausibilité de production.
  const entry = horizonsManifest.bodies[name];
  if (entry) {
    addCase({
      body: name,
      provider: 'horizons-binary',
      frame,
      center: parentCenter,
      window: binaryWindow(entry),
      compute: (date) => resolver.precise(name, cfg, date),
      raw: (date) =>
        relative
          ? horizonsService.getParentRelativeAU(name, parentName, date)
          : horizonsService.getHeliocentricAU(name, date),
    });
  }

  // Éléments képlériens — repli de couverture infinie.
  const elements = cfg.relativeOrbitalElements ?? cfg.orbitalElements;
  if (elements) {
    anyDate ??= {
      provider: 'kepler',
      frame,
      center: parentCenter,
      compute: (date) => resolver.elementsOnly(cfg, date),
    };
    for (const window of [epochWindow(elements.epoch), CORE, extended])
      addCase({
        body: name,
        provider: 'kepler',
        frame,
        center: parentCenter,
        window,
        compute: (date) => resolver.elementsOnly(cfg, date),
      });
  }

  // SPK — seulement les corps que la table `SPK_SETTINGS.bodyIds` sait nommer.
  if (spk && SPK_SETTINGS.bodyIds[name] !== undefined) {
    addCase({
      body: name,
      provider: 'spk',
      frame,
      center: parentCenter,
      window: SPK_WINDOW,
      async: true,
      compute: (date) =>
        spk.settle(() =>
          relative
            ? spk.provider.getParentRelativeAU(name, parentName, date)
            : spk.provider.getHeliocentricAU(name, date)
        ),
    });
    if (relative)
      addCase({
        body: name,
        provider: 'spk',
        frame: 'héliocentrique',
        center: 'sun',
        window: SPK_WINDOW,
        async: true,
        compute: (date) =>
          spk.settle(() => spk.provider.getHeliocentricAU(name, date)),
      });

    // Le Worker interrogé DIRECTEMENT, sans la façade synchrone. Ce chemin n'est pas celui de
    // production : il mesure le noyau et son évaluation (Chebyshev, ET, composition par centre
    // commun), pour séparer une erreur de calcul d'un refus de la façade.
    const ids = SPK_SETTINGS.bodyIds;
    const centerId = relative ? ids[parentName] : ids.sun;
    if (centerId !== undefined)
      addCase({
        body: name,
        provider: 'spk-worker-direct',
        frame,
        center: parentCenter,
        window: SPK_WINDOW,
        async: true,
        compute: async (date) => {
          const state = await spk.transport.getState(
            ids[name],
            centerId,
            etSecondsFromDate(date)
          );
          if (!state || state.frame !== 1) return null;
          const [x, y, z] = state.positionKm;
          return equatorialToScene(x / KM_PER_AU, y / KM_PER_AU, z / KM_PER_AU);
        },
      });
  }

  // Profondeur du temps — un millénaire par ligne, contre la cible profonde déclarée par le
  // corps. La source mesurée est celle qui RÉPOND à ces dates : aucun binaire ne les couvre.
  const deep = TARGETS[name]?.deep;
  if (deep && anyDate) {
    const substituted = deep.command !== TARGETS[name].command;
    if (substituted && !deep.expect)
      throw new Error(
        `« ${name} » déclare une cible profonde substituée (${deep.command}) sans « expect » : ` +
          `le contrôle du nom renvoyé retomberait sur « ${name} », que « ${deep.command} » ` +
          `contient déjà. Voir le $comment.deep de validation-targets.json.`
      );
    for (const window of DEEP_TILES)
      addCase({
        body: name,
        provider: anyDate.provider,
        frame: anyDate.frame,
        center: anyDate.center,
        window,
        compute: anyDate.compute,
        deep: { ...deep, substituted },
      });

    // TÉMOIN de la substitution. Une courbe d'écart aux époques profondes est crédible quoi
    // qu'elle vaille : c'est le témoin qui tranche. Les deux lignes ci-dessous mesurent LA MÊME
    // source aux MÊMES dates, là où Horizons sert le corps ET son barycentre ; leurs écarts ne
    // peuvent différer, date par date, de plus que le plancher. Sans elles, une erreur de repère
    // ou de centre passerait pour une croissance de l'erreur (le piège du lot 22.10, où comparer
    // l'héliocentrique au barycentre du SYSTÈME SOLAIRE ajoutait un million de km très plausible).
    if (substituted)
      for (const witness of ['corps', 'barycentre'])
        addCase({
          body: name,
          provider: 'témoin-profondeur',
          frame: anyDate.frame,
          center: anyDate.center,
          window: WITNESS_WINDOW,
          compute: anyDate.compute,
          witness,
          deep: witness === 'barycentre' ? { ...deep, substituted } : undefined,
        });
  }

  // Production — position héliocentrique telle que la scène la compose.
  addCase({
    body: name,
    provider: 'production',
    frame: 'héliocentrique composé',
    center: 'sun',
    window: CORE,
    compute: (date) => {
      const own = resolver.resolve(name, cfg, date);
      if (!own || !relative) return own;
      const parent = resolver.resolve(
        parentName,
        CELESTIAL_CONFIG.bodies[parentName],
        date
      );
      return parent ? own.clone().add(parent) : null;
    },
    source: (date) => {
      if (resolver.precise(name, cfg, date)) return 'binaire';
      if (
        cfg.relativeEphemeris?.kind === 'jupiterMoon' ||
        cfg.astroBody !== undefined
      )
        return 'astronomy-engine';
      return 'kepler';
    },
  });
});

// Sondes : binaires Horizons seuls, sur leur couverture propre.
for (const [name, entry] of Object.entries(horizonsManifest.bodies)) {
  if (bodyInfo.has(name)) continue;
  bodyInfo.set(name, { radiusKm: undefined, relative: false });
  addCase({
    body: name,
    provider: 'horizons-binary',
    frame: 'héliocentrique',
    center: 'sun',
    window: binaryWindow(entry),
    compute: (date) => horizonsService.getHeliocentricAU(name, date),
  });
}

// Objets interstellaires : Kepler hyperbolique, sur la fenêtre affichée (±20 ans).
for (const object of INTERSTELLAR_OBJECTS) {
  bodyInfo.set(object.name, { radiusKm: undefined, relative: false });
  const { from, to } = interstellarWindow(object);
  addCase({
    body: object.name,
    provider: 'kepler',
    frame: 'héliocentrique (hyperbole)',
    center: 'sun',
    window: {
      id: `périhélie ±20 ans`,
      kind: 'perihelion',
      from: from.getTime(),
      to: to.getTime(),
    },
    compute: (date) => {
      const p = keplerianPositionEcliptic(object.elements, date);
      return eclipticToScene(p.x, p.y, p.z);
    },
  });
}

// ───────────────────────────── exécution ─────────────────────────────

console.log(
  `${cases.length} cas, ${SAMPLES} dates chacun. SPK : ${spk ? 'noyau local chargé' : 'non mesuré'}` +
    `${INJECTING ? ` : INJECTION ${INJECT_KM} km / ${INJECT_SECONDS} s sur ${INJECT_PROVIDER ?? 'toutes les sources'}` : ''}`
);

const results = [];
const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');

/** Borne que nomme un refus Horizons (« No ephemeris … after A.D. 2200-JAN-08 … »). */
function horizonsBound(message) {
  const m =
    /(prior to|after) A\.D\. (\d{4})-([A-Z]{3})-(\d{2}) (\d{2}):(\d{2})/.exec(
      message
    );
  if (!m) return null;
  const ms = Date.UTC(+m[2], MONTHS.indexOf(m[3]), +m[4], +m[5], +m[6]);
  return { kind: m[1], ms };
}

for (const [index, c] of cases.entries()) {
  // Une fenêtre que la RÉFÉRENCE ne couvre pas (Horizons sert les centres de planète et les
  // satellites sur des plages bornées) est recadrée sur les bornes que nomme Horizons, et le
  // rapport le dit — plutôt que de perdre toute la ligne.
  let window = c.window;
  let dates;
  let reference;
  const override = c.deep?.substituted
    ? { target: { command: c.deep.command, expect: c.deep.expect } }
    : undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    dates = sampleDates(
      `${c.body}|${window.id}|${c.center}`,
      window.from,
      window.to,
      SAMPLES
    );
    reference = await horizonsVectors(c.body, c.center, dates, override);
    const bound = reference.error ? horizonsBound(reference.error) : null;
    if (!bound) break;
    const from =
      bound.kind === 'prior to'
        ? Math.max(window.from, bound.ms + MS_PER_DAY)
        : window.from;
    const to =
      bound.kind === 'after'
        ? Math.min(window.to, bound.ms - MS_PER_DAY)
        : window.to;
    if (!(to > from) || (from === window.from && to === window.to)) break;
    window = {
      id: `${iso(from).slice(0, 10)}→${iso(to).slice(0, 10)} (recadré sur Horizons, demandé ${c.window.id})`,
      kind: c.window.kind,
      clipped: true,
      from,
      to,
    };
  }
  const label = `[${index + 1}/${cases.length}] ${c.body} · ${c.provider} · ${c.frame} · ${window.id}`;
  const record = {
    body: c.body,
    provider: c.provider,
    frame: c.frame,
    window: window.id,
    // Forme structurée de la fenêtre, pour ce qui publie ces chiffres (`/methodology`) : le
    // libellé `id` est une phrase française, pas une donnée à ré-analyser.
    windowKind: window.kind,
    windowFrom: iso(window.from).slice(0, 10),
    windowTo: iso(window.to).slice(0, 10),
    windowClipped: window.clipped === true,
    // Cible Horizons RÉELLEMENT interrogée : le corps, ou le barycentre qui le remplace aux
    // époques profondes. Sans ce champ, deux lignes de sens différent se ressemblent.
    target: override?.target.command ?? TARGETS[c.body]?.command ?? null,
    center: CENTERS[c.center].id,
    radiusKm: bodyInfo.get(c.body)?.radiusKm ?? null,
    requested: dates.length,
    samples: [],
    uncovered: 0,
    rejected: 0,
    sources: {},
  };
  if (reference.error) {
    record.referenceError = reference.error;
    results.push(record);
    console.log(
      `${label} : référence Horizons indisponible : ${reference.error}`
    );
    continue;
  }

  const inject =
    INJECTING && (!INJECT_PROVIDER || INJECT_PROVIDER === c.provider);
  for (const [i, ms] of dates.entries()) {
    const date = new Date(ms + (inject ? INJECT_SECONDS * 1000 : 0));
    const value = c.async ? await c.compute(date) : c.compute(date);
    if (!value) {
      if (c.raw?.(date)) record.rejected++;
      else record.uncovered++;
      continue;
    }
    if (c.source) {
      const s = c.source(date);
      record.sources[s] = (record.sources[s] ?? 0) + 1;
    }
    const row = reference.rows[i];
    const truth = eclipticKmToScene(row.position);
    const velocity = eclipticKmToScene(row.velocity);
    const galaxy = [
      value.x * KM_PER_AU + (inject ? INJECT_KM : 0),
      value.y * KM_PER_AU,
      value.z * KM_PER_AU,
    ];
    const delta = galaxy.map((v, axis) => v - truth[axis]);
    const errorKm = Math.hypot(...delta);
    const sample = {
      date: iso(ms),
      errorKm,
      deltaKm: delta.map((v) => Math.round(v * 1000) / 1000),
    };
    if (inject && INJECT_SECONDS !== 0)
      sample.predictedKm = Math.hypot(...velocity) * Math.abs(INJECT_SECONDS);
    record.samples.push(sample);
  }

  const km = stats(record.samples.map((s) => s.errorKm));
  record.km = km;
  record.witness = c.witness;
  record.substituted = c.deep?.substituted === true;
  if (record.radiusKm)
    record.radii = Object.fromEntries(
      Object.entries(km).map(([k, v]) => [k, v / record.radiusKm])
    );
  if (record.samples.some((s) => s.predictedKm !== undefined))
    record.predictedKm = stats(record.samples.map((s) => s.predictedKm));
  results.push(record);
  console.log(
    `${label} : n=${record.samples.length} moy ${fmt(km.mean)} km, p95 ${fmt(km.p95)} km, max ${fmt(km.max)} km` +
      (record.predictedKm
        ? ` (prédit moy ${fmt(record.predictedKm.mean)} km)`
        : '')
  );
}

await loader.close();

// ─────────── plancher de la substitution, mesuré par le témoin (lot 39) ───────────
//
// Les deux lignes « témoin-profondeur » d'un corps mesurent la même source aux mêmes dates,
// l'une contre le corps, l'autre contre son barycentre, là où Horizons sert les deux. La plus
// grande différence de leurs écarts EST le plancher : le biais que la substitution introduit
// dans une ligne profonde. Le mesurer sur ce chemin-là, et non sur la distance géométrique
// corps ↔ barycentre, est tout le sujet : pour Uranus et Neptune, les deux ne disent pas du
// tout la même chose, et c'est Horizons qui n'est pas cohérent avec lui-même.
//
// Une ligne profonde n'est publiée que si son plancher reste sous un centième de l'écart
// mesuré : bien en deçà de la résolution des deux chiffres significatifs qu'affiche la fiche.
// Le rayon du corps, lui, n'est PAS un critère de publication — il l'a été une demi-heure, et
// il refusait les millénaires de Pluton (barycentre à 1,8 rayon) alors que leur écart se compte
// en MILLIARDS de km, où deux mille kilomètres ne changent rien. Il reste publié comme un fait :
// le barycentre Pluton-Charon est hors de Pluton, ce qui est aussi la raison pour laquelle
// `HorizonsEphemerisService` retire puis rend son balancement au corps.
const floors = new Map();
for (const body of new Set(
  results.filter((r) => r.witness).map((r) => r.body)
)) {
  const pair = Object.fromEntries(
    results
      .filter((r) => r.witness && r.body === body)
      .map((r) => [r.witness, r])
  );
  if (!pair.corps || !pair.barycentre) continue;
  if (pair.corps.samples.length !== pair.barycentre.samples.length)
    throw new Error(
      `témoin ${body} : les deux lignes n'ont pas le même nombre de dates`
    );
  let floorKm = 0;
  pair.corps.samples.forEach((s, i) => {
    if (s.date !== pair.barycentre.samples[i].date)
      throw new Error(`témoin ${body} : dates désalignées à l'indice ${i}`);
    floorKm = Math.max(
      floorKm,
      Math.abs(s.errorKm - pair.barycentre.samples[i].errorKm)
    );
  });
  const radiusKm = bodyInfo.get(body)?.radiusKm ?? null;
  if (radiusKm && floorKm > ABSURD_FLOOR_RADII * radiusKm)
    throw new Error(
      `témoin ${body} : la substitution par « ${TARGETS[body].deep.expect} » déplace l'écart de ` +
        `${fmt(floorKm)} km, soit ${(floorKm / radiusKm).toFixed(1)} rayons du corps. Un barycentre ` +
        `de système planétaire n'est jamais si loin : c'est le repère ou le centre qui est faux.`
    );
  const separation = await measureSeparation(
    body,
    TARGETS[body].deep,
    pair.corps.samples.map((s) => Date.parse(s.date))
  );
  floors.set(body, {
    km: floorKm,
    radiusKm,
    separation,
    window: `${iso(WITNESS_WINDOW.from).slice(0, 10)}→${iso(WITNESS_WINDOW.to).slice(0, 10)}`,
    n: pair.corps.samples.length,
    insideBody: radiusKm ? floorKm < radiusKm : false,
  });
  console.log(
    `plancher ${body} : la substitution déplace l'écart de ${fmt(floorKm)} km au plus ` +
      `(${radiusKm ? (floorKm / radiusKm).toFixed(2) : '?'} rayon), distance géométrique ` +
      `${fmt(separation.minKm)} à ${fmt(separation.maxKm)} km`
  );
}

// Application de la règle, ligne par ligne. Elle vit ICI et non dans la boucle de mesure :
// le plancher n'existe qu'une fois les deux lignes du témoin mesurées.
for (const record of results) {
  if (!record.substituted || record.witness) continue;
  const floor = floors.get(record.body);
  // PAS de repli silencieux : sans plancher, une ligne substituée serait publiée SANS que la
  // règle du centième s'applique, et rien ne le dirait. Le cas arrive si le témoin d'un corps
  // n'a pas pu être mesuré (Horizons refusant sa fenêtre), c'est-à-dire précisément quand on a
  // le plus besoin de le savoir.
  if (!floor) {
    // Le témoin a-t-il seulement été PLANIFIÉ ? `--providers` peut l'avoir écarté, et un tel
    // lancement ne publie rien. S'il était planifié et n'a pas abouti, on s'arrête.
    if (cases.some((c) => c.witness && c.body === record.body))
      throw new Error(
        `${record.body} ${record.window} : ligne profonde substituée sans plancher mesuré. ` +
          `Le témoin de ce corps n'a pas abouti, donc la règle de publication ne peut pas ` +
          `s'appliquer et cette ligne ne doit pas être publiée.`
      );
    continue;
  }
  record.floor = floor;
  // Un CODE, pas une phrase : ce champ est publié tel quel sur /methodology, qui existe en
  // quatre langues. Une phrase française y apparaissait dans le tableau de la page anglaise.
  // Le détail chiffré reste dans le rapport, qui est un document de travail en français.
  if (!(floor.km <= PUBLISHABLE_FLOOR_FRACTION * record.km.mean)) {
    record.floorRefused = 'floor-over-hundredth';
    record.floorRefusedDetail = `plancher ${fmt(floor.km)} km, soit plus d'un centième de l'écart mesuré (${fmt(record.km.mean)} km)`;
  }
}

// ───────────────────────────── rapport ─────────────────────────────

function fmt(v) {
  if (v === undefined || v === null || !Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e6) return v.toExponential(2);
  // Séparateur de milliers en espace ordinaire : le rapport reste du texte simple.
  if (a >= 100)
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.001) return v.toFixed(4);
  return v.toExponential(1);
}

const PROVIDER_TITLES = {
  'astronomy-engine': 'astronomy-engine (VSOP87 / modèles analytiques)',
  'horizons-binary': 'Binaires Horizons (`public/assets/ephemerides/*.bin`)',
  kepler: 'Éléments képlériens (catalogue, interstellaires)',
  spk: 'SPK SAT441 via la façade de production (`SpkWorkerEphemerisProvider` → Worker)',
  'spk-worker-direct':
    'SPK SAT441, Worker interrogé directement (hors façade : sépare un défaut du noyau d’un refus de la façade)',
  production:
    'Production : règle de priorité de `BodyPositionResolver`, parent composé',
};

const generatedAt = new Date().toISOString();
const lines = [
  '# Validation des positions contre JPL Horizons',
  '',
  `Généré le ${generatedAt} par \`scripts/validate-against-horizons.mjs\`.`,
  '',
  `- Référence : API Horizons, \`EPHEM_TYPE=VECTORS\`, \`REF_PLANE=ECLIPTIC\`, \`REF_SYSTEM=ICRF\`, \`VEC_CORR=NONE\` (géométrique), \`TIME_TYPE=UT\`, centre = corps (\`500@id\`).`,
  `- ${SAMPLES} dates par ligne, stratifiées sur la fenêtre, fraction de jour pseudo-aléatoire (graine = corps + fenêtre + centre).`,
  `- Erreur = norme de (position Galaxy − position Horizons), en km ; « R » = la même en rayons moyens du corps (\`realData.radiusKm\`).`,
  `- p95 = rang le plus proche. « hors couv. » = la source renvoie \`null\` ; « rejetés » = valeur fournie mais refusée par le test de plausibilité.`,
  `- Requêtes API : ${apiCalls}, réponses lues du cache : ${cacheHits}.`,
  `- SPK : ${spkStatus.kernel ? 'noyau `sat441l.bsp` présent localement' : 'noyau absent, non mesuré'} ; actif en production : ${spkStatus.enabledInProduction ? 'oui' : 'non (`VITE_SPK_KERNEL_URL` non défini)'}.`,
];
if (INJECTING)
  lines.push(
    '',
    `> **INJECTION DE FALSIFICATION ACTIVE** : +${INJECT_KM} km sur X scène, date décalée de ${INJECT_SECONDS} s, source ${INJECT_PROVIDER ?? 'toutes'}. Ce rapport ne mesure PAS l'application.`
  );

if (floors.size > 0) {
  lines.push(
    '',
    '## Profondeur du temps : la référence et son plancher',
    '',
    `Avant 1600, l'API Horizons refuse le centre d'une planète (sa théorie de satellites est bornée) et sert son BARYCENTRE, qui vient de DE441 et remonte au 9999-MAR-15 av. J.-C. Les lignes par millénaire comparent donc la position de Galaxy à ce barycentre. Le PLANCHER de cette substitution est mesuré par un témoin : la même source, aux mêmes dates, mesurée contre le corps ET contre son barycentre là où Horizons sert les deux (${[...floors.values()][0].window}, ${[...floors.values()][0].n} dates) ; la plus grande différence de leurs écarts est le biais que la substitution introduit.`,
    '',
    `Une ligne n'est publiée que si son plancher reste sous un centième de l'écart mesuré, bien en deçà de la résolution des deux chiffres significatifs qu'affiche la fiche. La colonne « en rayons du corps » n'est pas un critère : elle dit si le barycentre tombe DANS le corps, ce qui vaut d'être su (celui de Pluton-Charon n'y est pas) sans rien décider.`,
    '',
    '| corps | cible profonde | plancher (chemin réel) | en rayons du corps | distance géométrique corps ↔ barycentre |',
    `|${' --- |'.repeat(5)}`
  );
  for (const [body, f] of floors)
    lines.push(
      `| ${body} | ${TARGETS[body].deep.command} (${TARGETS[body].deep.expect}) | ${fmt(f.km)} km | ${f.radiusKm ? (f.km / f.radiusKm).toFixed(2) : 'n/a'} | ${fmt(f.separation.minKm)} à ${fmt(f.separation.maxKm)} km |`
    );
  const disagreeing = [...floors].filter(
    ([, f]) => f.km > 2 * f.separation.maxKm
  );
  if (disagreeing.length > 0)
    lines.push(
      '',
      `**Les deux dernières colonnes ne disent pas la même chose pour : ${disagreeing.map(([b]) => b).join(', ')}.** Horizons n'est alors pas cohérent avec lui-même : le barycentre qu'il sert comme CIBLE et celui qu'implique l'éphéméride du corps ne sont pas le même point. C'est le plancher du chemin réellement emprunté qui fait foi, et c'est lui qui est appliqué.`
    );
  const refused = results.filter((r) => r.floorRefused);
  lines.push(
    '',
    refused.length === 0
      ? 'Aucune ligne profonde refusée par son plancher.'
      : `Lignes NON publiées : ${[...new Set(refused.map((r) => `${r.body} ${r.window} (${r.floorRefusedDetail})`))].join(' ; ')}.`
  );
}

for (const provider of Object.keys(PROVIDER_TITLES)) {
  const rows = results.filter((r) => r.provider === provider);
  if (rows.length === 0) continue;
  lines.push('', `## ${PROVIDER_TITLES[provider]}`, '');
  const extra = provider === 'production' ? ' source retenue |' : '';
  lines.push(
    `| corps | repère | fenêtre | n | hors couv. | rejetés | moy km | méd km | p95 km | max km | moy R | méd R | p95 R | max R |${extra}${INJECTING ? ' prédit moy km |' : ''}`,
    `|${' --- |'.repeat(14 + (extra ? 1 : 0) + (INJECTING ? 1 : 0))}`
  );
  for (const r of rows) {
    if (r.referenceError) {
      lines.push(
        `| ${r.body} | ${r.frame} | ${r.window} | n/a | n/a | n/a | référence Horizons indisponible : ${r.referenceError.replace(/\|/g, '/')} |`
      );
      continue;
    }
    const k = r.km;
    const R = r.radii ?? {};
    const sources = Object.entries(r.sources)
      .map(([s, n]) => `${s} ${n}`)
      .join(', ');
    lines.push(
      `| ${r.body} | ${r.frame} | ${r.window} | ${r.samples.length} | ${r.uncovered} | ${r.rejected} | ${fmt(k.mean)} | ${fmt(k.median)} | ${fmt(k.p95)} | ${fmt(k.max)} | ${fmt(R.mean)} | ${fmt(R.median)} | ${fmt(R.p95)} | ${fmt(R.max)} |` +
        (extra ? ` ${sources || 'n/a'} |` : '') +
        (INJECTING ? ` ${fmt(r.predictedKm?.mean)} |` : '')
    );
  }
}

mkdirSync(dirname(join(ROOT, OUT)), { recursive: true });
writeFileSync(join(ROOT, `${OUT}.md`), lines.join('\n') + '\n');
writeFileSync(
  join(ROOT, `${OUT}.json`),
  JSON.stringify(
    {
      generatedAt,
      samplesPerCase: SAMPLES,
      spk: spkStatus,
      injection: INJECTING
        ? { km: INJECT_KM, seconds: INJECT_SECONDS, provider: INJECT_PROVIDER }
        : null,
      results,
    },
    null,
    1
  )
);
console.log(
  `\nRapport : ${OUT}.md / ${OUT}.json (API ${apiCalls}, cache ${cacheHits})`
);

// Résumé VERSIONNÉ, lu au build par la page `/methodology` (`src/seo/methodologyPage.ts`).
// `reports/` n'est pas versionné, donc le build de CI ne le voit pas ; ce fichier-ci l'est. Il
// n'est réécrit QUE par une mesure complète et honnête : une injection de falsification, une
// restriction `--only`/`--providers` ou une sortie redirigée publieraient sinon des chiffres
// qui ne mesurent pas l'application, sans que rien ne le signale sur le site.
const SUMMARY_FILE = join(
  ROOT,
  'src',
  'config',
  'horizons-validation-summary.json'
);
if (
  INJECTING ||
  ONLY ||
  PROVIDERS ||
  SAMPLES !== 48 ||
  OUT !== 'reports/horizons-validation'
)
  console.log(
    `Résumé publié NON réécrit : mesure partielle, injectée ou redirigée.`
  );
else {
  /** Quatre chiffres significatifs : assez pour la page, sans bruit de diff à chaque run. */
  const round = (v) => (v == null ? null : Number(v.toPrecision(4)));
  const roundStats = (o) =>
    o
      ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]))
      : null;
  writeFileSync(
    SUMMARY_FILE,
    JSON.stringify(
      {
        generatedAt,
        samplesPerCase: SAMPLES,
        spk: spkStatus,
        // La substitution de référence des époques profondes, corps par corps : ce que la page
        // /methodology publie sans avoir à relire un rapport non versionné.
        deep: {
          witnessFrom: iso(WITNESS_WINDOW.from).slice(0, 10),
          witnessTo: iso(WITNESS_WINDOW.to).slice(0, 10),
          bodies: Object.fromEntries(
            [...floors].map(([body, f]) => [
              body,
              {
                target: TARGETS[body].deep.command,
                targetName: TARGETS[body].deep.expect,
                floorKm: round(f.km),
                separationMaxKm: round(f.separation.maxKm),
                radiusKm: f.radiusKm,
                insideBody: f.insideBody,
              },
            ])
          ),
        },
        rows: results
          .filter(
            (r) =>
              r.provider !== 'spk-worker-direct' &&
              r.provider !== 'témoin-profondeur'
          )
          .map((r) => ({
            body: r.body,
            provider: r.provider,
            windowKind: r.windowKind,
            windowFrom: r.windowFrom,
            windowTo: r.windowTo,
            windowClipped: r.windowClipped,
            target: r.target,
            floorKm: r.floor ? round(r.floor.km) : undefined,
            floorRefused: r.floorRefused || undefined,
            relative: r.frame.startsWith('relatif'),
            radiusKm: r.radiusKm,
            n: r.samples.length,
            uncovered: r.uncovered,
            rejected: r.rejected,
            sources: r.sources,
            referenceError: r.referenceError ? true : undefined,
            km: r.floorRefused ? null : roundStats(r.km),
            radii: r.floorRefused ? null : roundStats(r.radii),
          })),
      },
      null,
      1
    ) + '\n'
  );
  console.log(`Résumé publié : ${SUMMARY_FILE}`);
}
process.exitCode = 0;
