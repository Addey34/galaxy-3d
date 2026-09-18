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
 */
async function horizonsVectors(targetKey, centerKey, datesMs) {
  const target = TARGETS[targetKey];
  const center = CENTERS[centerKey];
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
  return { rows, targetName, centerName };
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

  // astronomy-engine — les trois branches réellement appelées par `resolve()`.
  if (cfg.relativeEphemeris?.kind === 'jupiterMoon') {
    const moon = cfg.relativeEphemeris.moon;
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
  for (let attempt = 0; attempt < 3; attempt++) {
    dates = sampleDates(
      `${c.body}|${window.id}|${c.center}`,
      window.from,
      window.to,
      SAMPLES
    );
    reference = await horizonsVectors(c.body, c.center, dates);
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
        rows: results
          .filter((r) => r.provider !== 'spk-worker-direct')
          .map((r) => ({
            body: r.body,
            provider: r.provider,
            windowKind: r.windowKind,
            windowFrom: r.windowFrom,
            windowTo: r.windowTo,
            windowClipped: r.windowClipped,
            relative: r.frame.startsWith('relatif'),
            radiusKm: r.radiusKm,
            n: r.samples.length,
            uncovered: r.uncovered,
            rejected: r.rejected,
            sources: r.sources,
            referenceError: r.referenceError ? true : undefined,
            km: roundStats(r.km),
            radii: roundStats(r.radii),
          })),
      },
      null,
      1
    ) + '\n'
  );
  console.log(`Résumé publié : ${SUMMARY_FILE}`);
}
process.exitCode = 0;
