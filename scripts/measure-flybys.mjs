#!/usr/bin/env node
/* global console, process, fetch, setTimeout, URLSearchParams */
/**
 * L'ÉCART DES SONDES PENDANT LEURS RENCONTRES PLANÉTAIRES (ligne 45.10, 2026-10-11).
 *
 * POURQUOI CET OUTIL EXISTE. `pnpm ephemeris:validate` tire 48 dates par sonde sur toute sa
 * couverture, et aucune ne tombe sur un survol, qui dure quelques heures : il annonçait 0,1 à
 * 19 km pour des sondes que l'application plaçait à 59 000 km de leur vraie position au survol
 * de la Terre (JUICE, 2024-08-20). Une validation à dates fixes ne voit pas un événement
 * rapide. Celui-ci mesure là où l'interpolation casse, c'est-à-dire dans la sphère d'influence
 * d'une planète, où la trajectoire tourne en quelques heures autour d'elle.
 *
 * TROIS TEMPS, sans aucune date saisie :
 *   1. DÉTECTION. La trajectoire VRAIE de chaque sonde (Horizons, pas de 6 h, toute la
 *      couverture du binaire livré) est confrontée à chaque planète ; une RENCONTRE est un
 *      intervalle passé dans sa sphère d'influence de Laplace, a·(m/M☉)^(2/5), masses et
 *      distances lues au catalogue. Détecter sur la vérité et non sur l'interpolation livrée,
 *      c'est ne pas manquer une rencontre que l'application rate justement.
 *   2. MESURE. Sur chaque rencontre élargie d'un jour de part et d'autre, Horizons au pas de
 *      10 min (60 min au-delà de 20 jours, c'est-à-dire les années de Juno et de Cassini en
 *      orbite) contre la position que le service de PRODUCTION sert (`getHeliocentricAU`, qui
 *      compose un segment quand il y en a un). L'écart se rapporte à la distance VRAIE de la
 *      sonde à la planète, parce que c'est ce qui se voit : 10 000 km d'écart ne se voient
 *      pas à 2 millions de km de Jupiter, ils mettent la sonde de l'autre côté de la Terre.
 *   3. TÉMOIN. Aux NŒUDS du binaire livré, l'écart doit être nul (au plancher de l'arrondi) :
 *      un écart non nul y dénoncerait un défaut de MESURE (repère, centre, échelle de temps),
 *      pas d'interpolation. C'est ce témoin qui a démasqué la première mesure de la ligne
 *      45.10, fausse d'une unité astronomique (repère de scène contre écliptique).
 *
 * Écrit `src/config/flybyEncounters.json` (`--write`) : la liste des rencontres, ce qui a été
 * mesuré sur chacune, et des vecteurs de référence que `src/config/flybyAccuracy.test.ts`
 * confronte au service réel dans `pnpm verify`, sans réseau. Le générateur
 * (`pnpm ephemeris:generate`) y LIT les rencontres pour lesquelles il écrit un segment.
 *
 * Réponses Horizons en cache dans `.cache/flyby-accuracy/` ; `--offline` refuse le réseau.
 * `--only <sonde,…>` limite la mesure (et interdit `--write`, qui écrirait une liste partielle).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'flyby-accuracy');
const OUT = join(ROOT, 'src/config/flybyEncounters.json');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const KM_PER_AU = 149_597_870.7;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2440587.5;
/** Masse du Soleil (kg), pour la sphère d'influence de Laplace : seul RAPPORT de masses. */
const SUN_MASS_KG = 1.98847e30;

/** Pas de la détection : un survol passe au moins une demi-journée dans la sphère. */
const DETECT_STEP_MINUTES = 360;
/** Pas de la mesure, et au-delà de quelle durée de rencontre on passe au pas long. */
const FINE_STEP_MINUTES = 10;
const LONG_STEP_MINUTES = 30;
const LONG_ENCOUNTER_DAYS = 20;
/**
 * Pas candidats d'un segment, du plus grossier au plus fin. Le générateur n'accepte qu'un
 * entier de minutes (`stepSize`), ce que sont tous ceux-ci.
 */
const SEGMENT_STEPS_MINUTES = [720, 360, 240, 180, 120, 60, 30, 20, 10];
/**
 * Au-delà, l'intervalle à couvrir n'est plus un survol mais une phase EN ORBITE (Juno autour
 * de Jupiter, Cassini autour de Saturne : des années, des périapses toutes les quelques
 * semaines). Son segment se planifie de même, mais ses pas candidats s'arrêtent à 3 h : en
 * dessous il coûterait des mégaoctets, et le terme J2 de la propagation (pas 2, 2026-10-11)
 * est ce qui le rend possible.
 */
const ORBITAL_PHASE_DAYS = 60;
const ORBITAL_STEPS_MINUTES = [720, 360, 240, 180];
/** Vecteurs de référence gardés par rencontre pour la garde hors ligne. */
const MAX_REFERENCES = 12;
/** Marge de chaque côté d'une rencontre, en jours. */
const MARGIN_DAYS = 1;
/** Horizons plafonne une réponse vers 90 000 lignes ; on reste loin dessous. */
const MAX_ROWS = 40_000;
/**
 * La borne : écart sous 1 % de la distance vraie à la planète, à chaque instant mesuré. À
 * 1 %, une sonde à 13 000 km du centre de la Terre est placée à 130 km près, soit moins
 * qu'un pixel pour un globe qui remplit l'écran.
 */
const MAX_SHARE = 0.01;
/**
 * Ce que le pas d'un segment doit tenir, en SIMULATION : la moitié de la borne. La marge couvre
 * ce que le relevé ne voit pas (les instants entre ses échantillons de 10 min, une solution
 * d'Horizons raffinée depuis), et c'est ce chiffre que les pages publient.
 */
const SEGMENT_SHARE = MAX_SHARE / 2;

const argv = process.argv.slice(2);
const option = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
};
const ONLY = option('--only')?.split(',').filter(Boolean) ?? null;
const OFFLINE = argv.includes('--offline');
const WRITE = argv.includes('--write');
if (WRITE && ONLY)
  throw new Error(
    '--write avec --only écrirait une liste partielle des rencontres'
  );

const manifest = JSON.parse(
  readFileSync(join(ROOT, 'public/assets/ephemerides/manifest.json'), 'utf8')
);
const order = JSON.parse(
  readFileSync(join(ROOT, 'src/registry/spacecraft/order.json'), 'utf8')
).order;
const { targets, centers } = JSON.parse(
  readFileSync(join(ROOT, 'scripts/validation-targets.json'), 'utf8')
);

// ─────────────────────────── Horizons, avec cache disque ───────────────────────────

let apiCalls = 0;
let cacheHits = 0;

const isoOfJd = (jd) =>
  new Date((jd - UNIX_EPOCH_JD) * MS_PER_DAY)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');

async function horizonsText(params, label) {
  const url = `${API}?${new URLSearchParams({ format: 'text', ...params })}`;
  const key = createHash('sha256').update(url).digest('hex').slice(0, 32);
  const file = join(CACHE_DIR, `${key}.txt`);
  if (existsSync(file)) {
    cacheHits++;
    return readFileSync(file, 'utf8');
  }
  if (OFFLINE)
    throw new Error(`--offline : réponse absente du cache (${label})`);
  let text = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url);
    text = await response.text();
    // Une fin de couverture est une réponse, pas une panne : inutile d'insister.
    if (
      response.ok &&
      (text.includes('$$SOE') || text.includes('No ephemeris for target'))
    )
      break;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  apiCalls++;
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, text);
  return text;
}

/** Vecteurs héliocentriques en km, écliptique J2000, dates UT (comme l'application). */
async function truth(
  command,
  expect,
  startJd,
  stopJd,
  stepMinutes,
  timeList,
  centerId = '10'
) {
  const params = {
    COMMAND: `'${command}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'500@${centerId}'`,
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF',
    OUT_UNITS: 'KM-S',
    VEC_TABLE: '1',
    VEC_CORR: 'NONE',
    CSV_FORMAT: 'YES',
    TIME_DIGITS: 'FRACSEC',
  };
  if (timeList) {
    // Les nœuds du binaire sont datés en TDB : on les demande en TDB, sans conversion.
    Object.assign(params, {
      TIME_TYPE: 'TDB',
      TLIST: timeList.map((jd) => jd.toFixed(9)).join(' '),
      TLIST_TYPE: 'JD',
    });
  } else {
    Object.assign(params, {
      TIME_TYPE: 'UT',
      START_TIME: `'${isoOfJd(startJd)}'`,
      STOP_TIME: `'${isoOfJd(stopJd)}'`,
      STEP_SIZE: `'${stepMinutes} m'`,
    });
  }
  const text = await horizonsText(params, `${command} ${isoOfJd(startJd)}`);
  // La couverture qu'Horizons sert AUJOURD'HUI peut être plus courte que celle du binaire
  // livré (Juno : fichier jusqu'au 2028-09-29, Horizons jusqu'au 2028-09-02 le 2026-10-11).
  const bound =
    /No ephemeris for target "[^"]*" (after|prior to) A\.D\. (\d{4})-([A-Z]{3})-(\d{2}) (\d{2}):(\d{2})/.exec(
      text
    );
  if (bound) {
    const [, side, y, mon, d, h, mi] = bound;
    const month = 'JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(mon) / 3;
    const ms = Date.UTC(Number(y), month, Number(d), Number(h), Number(mi));
    throw Object.assign(
      new Error(
        `couverture Horizons ${side} ${isoOfJd(ms / MS_PER_DAY + UNIX_EPOCH_JD)}`
      ),
      {
        coverage: { side, jd: ms / MS_PER_DAY + UNIX_EPOCH_JD },
      }
    );
  }
  // Horizons sert ses refus en HTTP 200 : le nom rendu se vérifie, comme au générateur.
  const name = /Target body name:\s*([^{\n]+)/.exec(text)?.[1]?.trim() ?? '';
  if (!name.toLowerCase().includes(expect.toLowerCase()))
    throw new Error(
      `cible « ${command} » résolue en « ${name || 'rien'} », attendu « ${expect} »`
    );
  const soe = text.indexOf('$$SOE');
  const eoe = text.indexOf('$$EOE');
  if (soe < 0 || eoe <= soe)
    throw new Error(
      `bloc d'éphéméride absent pour « ${command} » (${isoOfJd(startJd)})`
    );
  return text
    .slice(soe + 5, eoe)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(',').map((s) => s.trim()))
    .map((c) => ({
      jd: Number(c[0]),
      km: [Number(c[2]), Number(c[3]), Number(c[4])],
    }));
}

/** La même chose, découpée en tranches que Horizons accepte, raccords non dupliqués. */
/** Fins de couverture rencontrées, par commande Horizons : publiées dans le relevé. */
const coverageClips = {};

async function truthChunked(
  command,
  expect,
  startJd,
  stopJd,
  stepMinutes,
  centerId = '10'
) {
  const span = (MAX_ROWS * stepMinutes) / 1440;
  const rows = [];
  for (let from = startJd; from < stopJd; from += span) {
    let to = Math.min(stopJd, from + span);
    let part;
    try {
      part = await truth(
        command,
        expect,
        from,
        to,
        stepMinutes,
        null,
        centerId
      );
    } catch (error) {
      if (error.coverage?.side !== 'after') throw error;
      // On s'arrête une minute avant la fin servie, et on le DIT.
      to = error.coverage.jd - 1 / 1440;
      coverageClips[command] = isoOfJd(error.coverage.jd);
      if (to <= from) break;
      part = await truth(
        command,
        expect,
        from,
        to,
        stepMinutes,
        null,
        centerId
      );
      stopJd = to;
    }
    rows.push(
      ...(rows.length ? part.filter((r) => r.jd > rows.at(-1).jd + 1e-9) : part)
    );
  }
  return rows;
}

// ─────────────────────────── le service de PRODUCTION ───────────────────────────

const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': join(ROOT, 'src') } },
  root: ROOT,
});
const load = (p) => loader.ssrLoadModule(p);
const { CELESTIAL_CONFIG } = await load('/src/config/bodies.ts');
const { flattenBodies } = await load('/src/config/catalog.ts');
const { eclipticToScene } = await load('/src/core/frames.ts');
const { jdTdbFromDate } = await load('/src/core/timeScale.ts');
const { horizonsServiceFromDisk } = await load(
  '/src/core/horizonsTestFixture.ts'
);
const { bodyDynamics } = await load('/src/config/gravity.ts');
const { oblatenessOf } = await load('/src/core/HorizonsEphemerisService.ts');
const { twoBodyResiduals } = await load('/src/core/impulseDetection.ts');

const catalogue = new Map(flattenBodies(CELESTIAL_CONFIG));
const service = horizonsServiceFromDisk();

/** Les planètes, dérivées du catalogue et non listées : `kind === 'planet'`. */
const planets = [...catalogue]
  .filter(([, cfg]) => cfg.kind === 'planet')
  .map(([name, cfg]) => ({
    name,
    radiusKm: cfg.realData.radiusKm,
    soiAU:
      cfg.realData.distanceAU *
      Math.pow(cfg.realData.massKg / SUN_MASS_KG, 0.4),
  }));

// Toutes les dates demandées tombent sur une minute entière : on rend la seconde exacte que
// les 9 décimales du JD arrondissent (« 00:13:59.999 »).
const dateOfUtJd = (jd) =>
  new Date(Math.round(((jd - UNIX_EPOCH_JD) * MS_PER_DAY) / 1000) * 1000);
const sceneOfKm = ([x, y, z]) =>
  eclipticToScene(x / KM_PER_AU, y / KM_PER_AU, z / KM_PER_AU);

/** Une `Date` dont le JD TDB vaut `jdTdb`, par l'échelle de temps de l'application. */
function dateOfTdbJd(jdTdb) {
  let date = dateOfUtJd(jdTdb);
  for (let i = 0; i < 4; i++)
    date = new Date(
      date.getTime() - (jdTdbFromDate(date) - jdTdb) * MS_PER_DAY
    );
  return date;
}

// ─────────────────────────────────── la mesure ───────────────────────────────────

const encounters = [];
const probes = ONLY ?? order;

for (const probe of probes) {
  const entry = manifest.bodies[probe];
  const target = targets[probe];
  if (!entry) throw new Error(`« ${probe} » n'a pas de binaire au manifeste`);
  if (!target)
    throw new Error(`« ${probe} » absent de scripts/validation-targets.json`);
  const startJd = entry.startJdTdb;
  const stopJd = entry.startJdTdb + (entry.sampleCount - 1) * entry.stepDays;

  // 1. Détection sur la vérité.
  const coarse = await truthChunked(
    target.command,
    target.expect,
    startJd + 0.01,
    stopJd - 0.01,
    DETECT_STEP_MINUTES
  );
  for (const planet of planets) {
    let open = null;
    let last = null;
    const close = () => {
      if (open === null) return;
      encounters.push({
        probe,
        planet: planet.name,
        fromJd: Math.max(startJd + 0.01, open - MARGIN_DAYS),
        toJd: Math.min(stopJd - 0.01, last + MARGIN_DAYS),
      });
      open = null;
    };
    for (const row of coarse) {
      const p = service.getHeliocentricAU(planet.name, dateOfUtJd(row.jd));
      if (!p) continue;
      const inside = sceneOfKm(row.km).distanceTo(p) < planet.soiAU;
      if (inside) {
        // Deux passages séparés de moins de deux marges se mesurent ensemble.
        if (open !== null && row.jd - last > 2 * MARGIN_DAYS) close();
        if (open === null) open = row.jd;
        last = row.jd;
      }
    }
    close();
  }
}
encounters.sort(
  (a, b) => a.probe.localeCompare(b.probe) || a.fromJd - b.fromJd
);

/** Les segments déjà livrés hors survols (BepiColombo autour de Mercure) : une rencontre qu'ils couvrent n'en reçoit pas d'autre. */
const shippedSegments = Object.entries(manifest.bodies).filter(
  ([name, e]) =>
    e.segmentOf !== undefined && !name.startsWith(`${e.segmentOf}--`)
);
const gridEnd = (e) => e.startJdTdb + (e.sampleCount - 1) * e.stepDays;

/** Le nom du segment d'une rencontre : sonde, planète, jour du passage au plus près. */
const segmentName = (enc, closestIso) =>
  `${enc.probe}--${enc.planet}-${closestIso.slice(0, 10)}`;

/** Une date UT arrondie à l'heure, au format qu'Horizons et le générateur lisent. */
const hourIso = (jd, round) => {
  // Un JD ne tient pas une heure exacte en binaire : sans la tolérance, 22:00 sortait 21:59.
  const hours = Math.round((jd - UNIX_EPOCH_JD) * 24 * 1e6) / 1e6;
  return new Date(round(hours) * 3_600_000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
};

/**
 * Les états que le GÉNÉRATEUR demandera pour ce segment, par la même requête que son
 * `buildUrl` (temps TDB par défaut, UA et UA/jour, table 2) : la simulation porte donc sur le
 * fichier qui sera livré, nœud pour nœud, et non sur une approximation.
 */
async function segmentStates(
  command,
  expect,
  centerId,
  startIso,
  stopIso,
  stepMinutes
) {
  const text = await horizonsText(
    {
      COMMAND: `'${command}'`,
      OBJ_DATA: 'NO',
      MAKE_EPHEM: 'YES',
      EPHEM_TYPE: 'VECTORS',
      CENTER: `500@${centerId}`,
      START_TIME: `'${startIso}'`,
      STOP_TIME: `'${stopIso}'`,
      STEP_SIZE: `'${stepMinutes} m'`,
      REF_PLANE: 'ECLIPTIC',
      REF_SYSTEM: 'ICRF',
      OUT_UNITS: 'AU-D',
      VEC_TABLE: '2',
      VEC_CORR: 'NONE',
      CSV_FORMAT: 'YES',
      TIME_DIGITS: 'FRACSEC',
      CAL_TYPE: 'GREGORIAN',
    },
    `${command} segment ${startIso} ${stepMinutes} min`
  );
  const name = /Target body name:\s*([^{\n]+)/.exec(text)?.[1]?.trim() ?? '';
  if (!name.toLowerCase().includes(expect.toLowerCase()))
    throw new Error(
      `segment : cible « ${command} » résolue en « ${name || 'rien'} »`
    );
  const soe = text.indexOf('$$SOE');
  const eoe = text.indexOf('$$EOE');
  if (soe < 0 || eoe <= soe)
    throw new Error(`segment : bloc absent (${command} ${startIso})`);
  const rows = text
    .slice(soe + 5, eoe)
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(',').map((f) => f.trim()));
  const samples = new Float64Array(rows.length * 6);
  rows.forEach((c, i) => {
    for (let k = 0; k < 6; k++) samples[i * 6 + k] = Number(c[2 + k]);
  });
  return {
    startJdTdb: Number(rows[0][0]),
    stepDays: stepMinutes / 1440,
    samples,
  };
}

/** Écart relatif à la planète dessinée, sur les échantillons vrais d'une rencontre. */
function measure(enc, samples, position) {
  let worst = { share: 0, errKm: 0, jd: samples[0].jd };
  for (const sample of samples) {
    const date = dateOfUtJd(sample.jd);
    const planetPos = service.getHeliocentricAU(enc.planet, date);
    const served = position(date);
    if (!planetPos || !served)
      return { share: Infinity, errKm: Infinity, jd: sample.jd };
    const errKm = served.sub(planetPos).distanceTo(sample.rel) * KM_PER_AU;
    const share = errKm / sample.rKm;
    if (share > worst.share) worst = { share, errKm, jd: sample.jd };
  }
  return worst;
}

const dynamicsByBody = bodyDynamics();

/** Au-delà, on ne cherche pas de poussées : ce n'est plus une mise en orbite, c'est le pas. */
const MAX_IMPULSES = 4;
/** Pas du tirage fin où une poussée se lit. */
const IMPULSE_PROBE_MINUTES = 10;

/**
 * LES POUSSÉES D'UN SEGMENT SIMULÉ, cherchées là seulement où il déborde. Chaque groupe
 * d'intervalles fautifs est relu au pas de 10 min ; l'état de chaque ligne est propagé jusqu'à
 * la suivante sous la MÊME dynamique que le service (gravité et J2), et la poussée est le
 * barycentre des résidus de l'épisode le plus fort (au-dessus du quart de son pic). Mesuré sur
 * Juno le 2026-10-11 : 35 à 49 km par intervalle de 10 min pendant la mise en orbite, 0,2 km au
 * 95ᵉ centile ailleurs, 7,7 km au plus au ras de Jupiter (les harmoniques au-delà de J2).
 */
async function findImpulses(enc, samples, segment, centerId, dynamics) {
  const m = segment.manifest;
  const intervals = new Set();
  for (const sample of samples) {
    const date = dateOfUtJd(sample.jd);
    const planetPos = service.getHeliocentricAU(enc.planet, date);
    const p = service.getHeliocentricAU(enc.probe, date);
    if (!planetPos || !p) continue;
    if (
      p.sub(planetPos).distanceTo(sample.rel) * KM_PER_AU <=
      SEGMENT_SHARE * sample.rKm
    )
      continue;
    intervals.add(
      Math.floor((jdTdbFromDate(date) - m.startJdTdb) / m.stepDays)
    );
  }
  // Intervalles contigus regroupés : une poussée déborde souvent sur ses deux voisins.
  const sorted = [...intervals].sort((a, b) => a - b);
  const groups = [];
  for (const k of sorted) {
    if (groups.length && k - groups.at(-1).at(-1) <= 1) groups.at(-1).push(k);
    else groups.push([k]);
  }
  if (groups.length === 0 || groups.length > MAX_IMPULSES) return [];
  const target = targets[enc.probe];
  const found = [];
  for (const group of groups) {
    const fromJd = m.startJdTdb + (group[0] - 1) * m.stepDays;
    const toJd = m.startJdTdb + (group.at(-1) + 2) * m.stepDays;
    const fine = await segmentStates(
      target.command,
      target.expect,
      centerId,
      `JD ${fromJd.toFixed(6)}`,
      `JD ${toJd.toFixed(6)}`,
      IMPULSE_PROBE_MINUTES
    );
    const rows = [];
    for (let i = 0; i < fine.samples.length / 6; i++)
      rows.push({
        jd: fine.startJdTdb + (i * IMPULSE_PROBE_MINUTES) / 1440,
        state: Array.from(fine.samples.subarray(i * 6, i * 6 + 6)),
      });
    const residuals = twoBodyResiduals(rows, dynamics.mu, dynamics.oblateness);
    let peak = 0;
    for (let k = 1; k < residuals.length; k++)
      if (residuals[k] > residuals[peak]) peak = k;
    let a = peak;
    let b = peak;
    while (a > 0 && residuals[a - 1] > residuals[peak] / 4) a--;
    while (b + 1 < residuals.length && residuals[b + 1] > residuals[peak] / 4)
      b++;
    let weight = 0;
    let moment = 0;
    for (let k = a; k <= b; k++) {
      weight += residuals[k];
      moment += (residuals[k] * (rows[k].jd + rows[k + 1].jd)) / 2;
    }
    let jd = moment / weight;
    // Jamais SUR une ancre : le service propage d'un côté ou de l'autre de l'instant.
    const u = (jd - m.startJdTdb) / m.stepDays;
    if (Math.abs(u - Math.round(u)) < 1e-4) jd += 1 / 1440;
    found.push(Number(jd.toFixed(6)));
    console.log(
      `  poussée de ${enc.probe} vers JD ${jd.toFixed(4)} (${dateOfUtJd(jd).toISOString().slice(0, 16)} TDB) : ` +
        `pic ${residuals[peak].toFixed(1)} km sur ${IMPULSE_PROBE_MINUTES} min, épisode de ${(b - a + 1) * IMPULSE_PROBE_MINUTES} min`
    );
  }
  return found;
}
const segments = [];

for (const enc of encounters) {
  const target = targets[enc.probe];
  const planet = planets.find((p) => p.name === enc.planet);
  const long = enc.toJd - enc.fromJd > LONG_ENCOUNTER_DAYS + 2 * MARGIN_DAYS;
  const step = long ? LONG_STEP_MINUTES : FINE_STEP_MINUTES;
  // La vérité RELATIVE à la planète (son centre), comparée à ce que la scène sert relativement
  // à la planète qu'elle DESSINE. C'est ce qui se voit, et c'est la seule comparaison juste pour
  // la Terre, dessinée au barycentre Terre-Lune (4 700 km du centre) comme toute sa famille :
  // la Lune y est placée par son vecteur géocentrique, et une sonde doit l'être de même.
  const center = centers[enc.planet];
  if (!center)
    throw new Error(
      `identifiant Horizons de « ${enc.planet} » absent de validation-targets.json`
    );
  const rows = await truthChunked(
    target.command,
    target.expect,
    enc.fromJd,
    enc.toJd,
    step,
    center.id
  );
  const samples = rows.map((row) => {
    const rel = sceneOfKm(row.km);
    return { jd: row.jd, km: row.km, rel, rKm: rel.length() * KM_PER_AU };
  });
  const closest = samples.reduce((a, b) => (b.rKm < a.rKm ? b : a));
  const closestIso = dateOfUtJd(closest.jd).toISOString();

  // Ce que la scène sert AUJOURD'HUI (segments livrés compris), et ce que le seul fichier
  // héliocentrique servirait : c'est lui qui dit OÙ un segment est nécessaire, et il ne change
  // pas quand un segment est ajouté, donc le plan ne dépend pas de l'état qu'il produit.
  const served = measure(enc, samples, (d) =>
    service.getHeliocentricAU(enc.probe, d)
  );
  const helio = service.bodies.get(enc.probe);
  const baseline = (d) => service._samplePosition(helio, d);
  const failing = samples.filter((sample) => {
    const date = dateOfUtJd(sample.jd);
    const planetPos = service.getHeliocentricAU(enc.planet, date);
    const p = baseline(date);
    if (!planetPos || !p) return false;
    return (
      p.sub(planetPos).distanceTo(sample.rel) * KM_PER_AU >
      SEGMENT_SHARE * sample.rKm
    );
  });

  // 3. Témoin aux nœuds du binaire héliocentrique (deux nœuds de la rencontre).
  const entry = manifest.bodies[enc.probe];
  const k = Math.ceil((enc.fromJd - entry.startJdTdb) / entry.stepDays);
  const first = Math.min(k, entry.sampleCount - 2);
  const nodes = [first, first + 1].map(
    (i) => entry.startJdTdb + i * entry.stepDays
  );
  const witness = await truth(
    target.command,
    target.expect,
    nodes[0],
    nodes[0],
    0,
    nodes
  );
  let witnessKm = 0;
  for (const row of witness)
    witnessKm = Math.max(
      witnessKm,
      baseline(dateOfTdbJd(row.jd)).distanceTo(sceneOfKm(row.km)) * KM_PER_AU
    );
  if (witnessKm > 1)
    throw new Error(
      `${enc.probe} / ${enc.planet} : témoin aux nœuds à ${witnessKm.toFixed(3)} km, ` +
        'la MESURE est fausse (repère, centre ou échelle de temps), pas l’interpolation'
    );

  // 2 bis. Le segment : sur l'intervalle où le fichier héliocentrique échoue, élargi de 6 h et
  // arrondi à l'heure, le pas le plus GROSSIER dont la simulation tient la moitié de la borne.
  let plan = null;
  let note = '';
  if (failing.length > 0) {
    const needFrom = failing[0].jd - 0.25;
    const needTo = failing.at(-1).jd + 0.25;
    const covering = shippedSegments.find(
      ([, e]) =>
        e.segmentOf === enc.probe &&
        e.startJdTdb < needTo &&
        gridEnd(e) > needFrom
    );
    if (covering) {
      note = `couverte par le segment livré ${covering[0]}`;
    } else {
      const orbital = needTo - needFrom > ORBITAL_PHASE_DAYS;
      const startIso = hourIso(Math.max(needFrom, entry.startJdTdb), Math.ceil);
      // La fin se pose sur la GRILLE du segment, arrondie vers le haut : arrondie à l'heure
      // seulement, le dernier nœud tombait jusqu'à un pas AVANT la fin voulue, et ces heures
      // retombaient sur le fichier héliocentrique (Juno le 2028-08-28 : 21 000 km au pas de 12 h).
      // Les deux chaînes sont lues par Horizons dans la même échelle, donc leur écart en est un.
      const lastJd = Math.min(needTo, gridEnd(entry));
      const startMs = Date.parse(`${startIso.replace(' ', 'T')}:00Z`);
      const stopOnGrid = (stepMinutes) => {
        const step = stepMinutes * 60_000;
        const wanted = (lastJd - UNIX_EPOCH_JD) * MS_PER_DAY;
        const limit = (gridEnd(entry) - UNIX_EPOCH_JD) * MS_PER_DAY;
        let n = Math.ceil((wanted - startMs) / step);
        while (n > 0 && startMs + n * step > limit) n--;
        return new Date(startMs + n * step)
          .toISOString()
          .slice(0, 16)
          .replace('T', ' ');
      };
      const mu = dynamicsByBody[enc.planet]?.attractorMu;
      if (!(mu > 0))
        throw new Error(`aucune masse au catalogue pour ${enc.planet}`);
      const name = segmentName(enc, closestIso);
      // La même dynamique que le service : la gravité de la planète, et son aplatissement
      // quand le manifeste le publie (`pnpm ephemeris:oblateness`).
      const flat = manifest.bodies[enc.planet]?.oblateness;
      const dynamics = {
        mu,
        ...(flat ? { oblateness: oblatenessOf(flat) } : {}),
      };
      for (const stepMinutes of orbital
        ? ORBITAL_STEPS_MINUTES
        : SEGMENT_STEPS_MINUTES) {
        const stopIso = stopOnGrid(stepMinutes);
        const states = await segmentStates(
          target.command,
          target.expect,
          center.id,
          startIso,
          stopIso,
          stepMinutes
        );
        const sampleCount = states.samples.length / 6;
        if (sampleCount < 3) continue;
        service.bodies.set(name, {
          manifest: {
            file: 'simulation',
            target: target.command,
            center: enc.planet,
            startJdTdb: states.startJdTdb,
            stepDays: states.stepDays,
            sampleCount,
            segmentOf: enc.probe,
          },
          samples: states.samples,
          dynamics,
        });
        const served = (d) => service.getHeliocentricAU(enc.probe, d);
        let simulated = measure(enc, samples, served);
        // Une POUSSÉE (la mise en orbite) casse la propagation d'un intervalle : on la cherche
        // là où la simulation déborde, et on la publie pour être propagée d'un seul côté.
        let impulses = [];
        if (simulated.share > SEGMENT_SHARE) {
          impulses = await findImpulses(
            enc,
            samples,
            service.bodies.get(name),
            center.id,
            dynamics
          );
          if (impulses.length > 0) {
            service.bodies.get(name).manifest.impulses = impulses;
            simulated = measure(enc, samples, served);
          }
        }
        service.bodies.delete(name);
        if (simulated.share <= SEGMENT_SHARE) {
          plan = {
            name,
            kind: orbital ? 'orbit' : 'flyby',
            from: startIso,
            to: stopIso,
            stepMinutes,
            bytes: sampleCount * 48,
            simulatedKm: simulated.errKm,
            simulatedShare: simulated.share,
            ...(impulses.length > 0 ? { impulses } : {}),
          };
          break;
        }
      }
      if (!plan)
        note = `aucun pas jusqu'à ${(orbital ? ORBITAL_STEPS_MINUTES : SEGMENT_STEPS_MINUTES).at(-1)} min ne tient la borne`;
    }
  }
  if (plan) segments.push(plan);

  // Vecteurs de référence pour la garde hors ligne : chaque périapse (minimum local de la
  // distance) et ses voisins à ±2 h, plus le pire écart servi ce jour.
  // Une rencontre que ce relevé ne corrige pas (couverte par un segment livré et sa propre
  // garde, ou phase en orbite) n'en porte aucun : la garde n'aurait rien à y tenir.
  const picks = new Set();
  if (!note) {
    const periapses = [];
    const per2h = Math.round(120 / step);
    for (let i = 1; i < samples.length - 1; i++) {
      if (
        samples[i].rKm <= samples[i - 1].rKm &&
        samples[i].rKm < samples[i + 1].rKm
      )
        for (const j of [i - per2h, i, i + per2h])
          if (samples[j]) periapses.push(j);
    }
    // Au plus MAX_REFERENCES par survol, répartis sur toute la liste ; TOUS les périapses d'une
    // phase en orbite, sans quoi la garde ne voit pas ce qui la fait tenir (sans le terme J2,
    // Juno restait à 0,87 % sur 12 références, le 2026-10-11).
    const every =
      plan?.kind === 'orbit'
        ? 1
        : Math.max(1, Math.ceil(periapses.length / MAX_REFERENCES));
    periapses.filter((_, i) => i % every === 0).forEach((j) => picks.add(j));
    const worstIndex = samples.findIndex((s) => s.jd === served.jd);
    if (worstIndex >= 0) picks.add(worstIndex);
    picks.add(samples.indexOf(closest));
  }
  Object.assign(enc, {
    closestKm: Math.round(closest.rKm),
    closestAt: closestIso,
    planetRadii: closest.rKm / planet.radiusKm,
    served,
    witnessKm,
    plan,
    note,
    reference: [...picks]
      .sort((a, b) => a - b)
      .map((i) => ({
        date: dateOfUtJd(samples[i].jd).toISOString(),
        km: samples[i].km.map((v) => Number(v.toFixed(3))),
      })),
  });
  const verdict = served.share <= MAX_SHARE ? 'tenu' : 'HORS BORNE';
  console.log(
    `${enc.probe.padEnd(19)} ${enc.planet.padEnd(8)} ${closestIso.slice(0, 10)} ` +
      `au plus près ${String(enc.closestKm).padStart(9)} km ; servi ${served.errKm.toFixed(0).padStart(7)} km ` +
      `(${(served.share * 100).toFixed(2)} %) : ${verdict.padEnd(10)} ; témoin ${witnessKm.toFixed(3)} km ; ` +
      (plan
        ? `segment ${plan.from} → ${plan.to} au pas de ${plan.stepMinutes} min, ${plan.bytes} o, ` +
          `simulé ${plan.simulatedKm.toFixed(1)} km (${(plan.simulatedShare * 100).toFixed(3)} %)`
        : note || 'aucun segment nécessaire')
  );
}

for (const [command, at] of Object.entries(coverageClips))
  console.log(
    `Horizons ne sert ${command} que jusqu'au ${at} UT : la mesure s'arrête là`
  );
const outside = encounters.filter((e) => e.served.share > MAX_SHARE);
// Une rencontre hors borne n'est un ÉCHEC que sans raison écrite : couverte par un segment
// livré qui a sa propre garde, ou phase en orbite qui se traite à part (ligne 45.10, pas 2).
const unexplained = outside.filter((e) => !e.note);
console.log(
  `\n${encounters.length} rencontres, ${outside.length} hors de la borne de ${MAX_SHARE * 100} % ` +
    `(${unexplained.length} sans raison écrite) ; ` +
    `${segments.length} segments planifiés, ${segments.reduce((a, s) => a + s.bytes, 0)} octets ` +
    `(${apiCalls} appels Horizons, ${cacheHits} réponses en cache)`
);

if (WRITE) {
  const document = {
    $comment:
      'Écrit par `pnpm ephemeris:flybys --write` (scripts/measure-flybys.mjs), jamais à la main. ' +
      'Rencontres DÉTECTÉES sur la trajectoire vraie (Horizons) : séjour dans la sphère d’influence de Laplace ' +
      'd’une planète, élargi d’un jour de chaque côté. `segment` : le plan que `pnpm ephemeris:generate` lit. ' +
      'Vecteurs de référence RELATIFS au centre de la planète, écliptique J2000, km, dates UT.',
    source:
      'NASA/JPL Horizons, CENTER 500@<planète>, ECLIPTIC J2000, VEC_CORR NONE, UT',
    maxShare: MAX_SHARE,
    segmentShare: SEGMENT_SHARE,
    files: Object.fromEntries(
      [...new Set(encounters.map((e) => e.probe))].map((p) => [
        p,
        manifest.bodies[p].file,
      ])
    ),
    encounters: encounters.map((e) => ({
      probe: e.probe,
      planet: e.planet,
      from: dateOfUtJd(e.fromJd).toISOString(),
      to: dateOfUtJd(e.toJd).toISOString(),
      closestKm: e.closestKm,
      closestAt: e.closestAt,
      ...(e.plan
        ? {
            segment: {
              name: e.plan.name,
              kind: e.plan.kind,
              from: e.plan.from,
              to: e.plan.to,
              stepMinutes: e.plan.stepMinutes,
              ...(e.plan.impulses ? { impulses: e.plan.impulses } : {}),
            },
          }
        : {}),
      ...(e.note ? { note: e.note } : {}),
      reference: e.reference,
    })),
  };
  // Un vecteur par ligne : le fichier se relit, et un diff de régénération reste lisible.
  const text = JSON.stringify(document, null, 1).replace(
    /\[\n\s*(-?[\d.e+-]+),\n\s*(-?[\d.e+-]+),\n\s*(-?[\d.e+-]+)\n\s*\]/g,
    '[$1, $2, $3]'
  );
  writeFileSync(OUT, `${text}\n`);
  console.log(`écrit ${OUT}`);
}

await loader.close();
process.exitCode = unexplained.length > 0 ? 1 : 0;
