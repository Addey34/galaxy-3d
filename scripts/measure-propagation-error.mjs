/* global console, process, fetch, URLSearchParams */
/**
 * L'ÉCART D'UN SATELLITE EN FONCTION DE L'ARC PROPAGÉ — la mesure qui manquait aux satellites.
 *
 * POURQUOI CET OUTIL EXISTE. Le lot 11 a posé la règle « le pas le plus grossier qui tient
 * l'écart visé », et il l'a mesurée par DÉCIMATION de vecteurs Horizons au pas d'UN JOUR. Cette
 * méthode ne peut pas atteindre un satellite dont la période est plus courte qu'un jour : la
 * référence elle-même replie l'orbite (Amalthée fait 2,0 tours par jour, Phobos 3,1). Les
 * binaires sous-échantillonnés du catalogue n'ont donc JAMAIS été mesurés par la règle qui a
 * servi à tous les autres corps, et c'est exactement ce que la règle de parité de l'utilisateur
 * interdit : « une optimisation mise en place s'applique à TOUT, pas au seul dernier ajout ».
 *
 * CE QU'IL MESURE, et pourquoi c'est l'ARC et non la date. Sous le seuil d'Hermite le service
 * propage une conique à deux corps depuis l'échantillon encadrant
 * (`HorizonsEphemerisService._keplerianBetweenSamples`). L'écart ne dépend donc pas de QUAND on
 * regarde, mais de la durée propagée depuis le nœud le plus proche. Mesuré sur Amalthée le
 * 2026-09-28, c'est sans ambiguïté :
 *
 *     0 à 0,005 j du nœud      12,7 km        <- le plancher : l'échantillon lui-même
 *     0,01 à 0,02 j           263 km
 *     0,04 à 0,08 j           851 km
 *     au-delà de 0,125 j    ~1 100 km         <- SATURÉ, soit un quart de révolution
 *
 * Deux régimes, donc, et c'est ce qui explique qu'un pas SEIZE fois plus fin (4 j vers 6 h)
 * n'ait divisé l'écart que par deux : 6 h propage encore jusqu'à 0,125 jour, soit toujours dans
 * la saturation. Seul un pas qui maintient l'arc dans le régime LINÉAIRE achète quelque chose.
 *
 * ET CE N'EST PAS UN RÉGLAGE DE TEMPS. Le facteur `meanMotionScale` a été balayé sur Amalthée :
 * 1,0060 rend 1 181 km, 1,0069219 (la valeur publiée) 1 100, 1,0081 1 225. La valeur publiée est
 * l'optimum et le plancher de cette famille de correctifs est à 1 100 km : aucun facteur ne
 * remplace des échantillons.
 *
 * CE QU'IL N'EST PAS. Il ne remplace pas `pnpm ephemeris:validate`, qui compare ce que
 * l'application SERT à des dates tirées sur toute la couverture. Celui-ci éclaire la CAUSE, sur
 * deux intervalles, pour rendre le pas nécessaire CALCULABLE au lieu d'être cherché à tâtons.
 *
 * Réponses Horizons mises en cache dans `.cache/propagation-error/` : une reprise ne redemande
 * rien, et `--offline` refuse de sortir du cache au lieu d'appeler le réseau.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'propagation-error');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const KM_PER_AU = 149_597_870.7;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2440587.5;

/** Écliptique Horizons vers les axes de la scène, comme `validate-against-horizons.mjs`. */
const eclipticKmToScene = ([x, y, z]) => [x, z, -y];

const argv = process.argv.slice(2);
const option = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i === -1 ? fallback : argv[i + 1];
};
const ONLY =
  option('--only')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? null;
const OFFLINE = argv.includes('--offline');
const TARGET_RADII = Number(option('--target', '1'));
/**
 * Points de sonde par RÉVOLUTION, et non par intervalle du binaire : c'est la période qui
 * gouverne le phénomène. Calé sur l'intervalle, le régime linéaire (arcs sous un dixième de
 * révolution) se retrouvait VIDE pour Amalthée, dont un intervalle vaut huit tours.
 */
const POINTS_PER_REV = Number(option('--points', '120'));
/** Date d'ancrage FIXE : une mesure qui dépend du jour où elle tourne ne se compare pas. */
const ANCHOR = option('--anchor', '2025-01-05');

const manifest = JSON.parse(
  readFileSync(join(ROOT, 'public/assets/ephemerides/manifest.json'), 'utf8')
);
const { targets, centers } = JSON.parse(
  readFileSync(join(ROOT, 'scripts/validation-targets.json'), 'utf8')
);

// ─────────────────────────── Horizons, avec cache disque ───────────────────────────

let apiCalls = 0;
let cacheHits = 0;

async function vectors(
  command,
  centerId,
  startIso,
  stopIso,
  stepMinutes,
  expect
) {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${command}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'500@${centerId}'`,
    START_TIME: `'${startIso}'`,
    STOP_TIME: `'${stopIso}'`,
    STEP_SIZE: `'${stepMinutes} m'`,
    TIME_TYPE: 'UT',
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF',
    OUT_UNITS: 'KM-S',
    VEC_TABLE: '2',
    VEC_CORR: 'NONE',
    CSV_FORMAT: 'YES',
    TIME_DIGITS: 'FRACSEC',
  });
  const url = `${API}?${params}`;
  const key = createHash('sha256').update(url).digest('hex').slice(0, 32);
  const file = join(CACHE_DIR, `${key}.txt`);
  let text;
  if (existsSync(file)) {
    text = readFileSync(file, 'utf8');
    cacheHits++;
  } else {
    if (OFFLINE)
      throw new Error(
        `--offline : réponse absente du cache pour « ${command} » (${startIso}). ` +
          'Relancer une fois sans --offline.'
      );
    const response = await fetch(url);
    text = await response.text();
    apiCalls++;
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, text);
  }
  // Une cible mal résolue produit une « erreur » parfaitement plausible, et Horizons sert ses
  // refus en HTTP 200 : le nom rendu est donc vérifié, comme dans le générateur.
  const name = /Target body name:\s*([^{\n]+)/.exec(text)?.[1]?.trim() ?? '';
  if (!name.toLowerCase().includes(expect.toLowerCase()))
    throw new Error(
      `cible « ${command} » résolue en « ${name || 'rien'} », attendu « ${expect} » : ` +
        "ce n'est pas une panne réseau"
    );
  const soe = text.indexOf('$$SOE');
  const eoe = text.indexOf('$$EOE');
  if (soe < 0 || eoe <= soe)
    throw new Error(`bloc d'éphéméride absent pour « ${command} »`);
  return text
    .slice(soe + 5, eoe)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(',').map((s) => s.trim()))
    .map((c) => ({
      jd: Number(c[0]),
      pos: [Number(c[2]), Number(c[3]), Number(c[4])],
    }));
}

// ─────────────────────────── le résolveur de PRODUCTION ───────────────────────────

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
const { EphemerisService } = await load('/src/core/EphemerisService.ts');
const { OrbitalElementsService } = await load(
  '/src/core/OrbitalElementsService.ts'
);
const { OrbitalMechanics } = await load('/src/core/OrbitalMechanics.ts');
const { SimulationClock } = await load('/src/core/SimulationClock.ts');
const { horizonsServiceFromDisk } = await load(
  '/src/core/horizonsTestFixture.ts'
);

const catalogue = new Map(flattenBodies(CELESTIAL_CONFIG));
const mechanics = new OrbitalMechanics(
  new SimulationClock(),
  new EphemerisService(),
  new OrbitalElementsService(),
  horizonsServiceFromDisk(),
  CELESTIAL_CONFIG,
  {}
);
const resolver = mechanics._positions;
if (!resolver)
  throw new Error(
    'OrbitalMechanics._positions introuvable : le résolveur a changé de nom'
  );

// ─────────────────────────────────── la mesure ───────────────────────────────────

/** Les corps que le pas livré ne résout pas : moins de 2 échantillons par révolution. */
function underSampled() {
  const out = [];
  for (const [name, entry] of Object.entries(manifest.bodies)) {
    const cfg = catalogue.get(name);
    const period = cfg?.realData?.orbitPeriodDays;
    if (!period || !entry.center || entry.center === 'sun') continue;
    if (period / entry.stepDays >= 2) continue;
    out.push(name);
  }
  return out;
}

const bodies = ONLY ?? underSampled();
const rows = [];

for (const name of bodies) {
  const entry = manifest.bodies[name];
  const cfg = catalogue.get(name);
  if (!entry) throw new Error(`« ${name} » n'a pas de binaire au manifeste`);
  if (!cfg) throw new Error(`« ${name} » n'est pas au catalogue`);
  const center = centers[entry.center];
  const target = targets[name];
  if (!center || !target)
    throw new Error(
      `identifiant Horizons manquant pour « ${name} » ou « ${entry.center} »`
    );

  const period = cfg.realData.orbitPeriodDays;
  const radiusKm = cfg.realData.radiusKm;
  const step = entry.stepDays;

  // DEUX intervalles entiers du binaire, ancrés sur ses nœuds : sans cet ancrage l'écart au
  // nœud ne vaut pas 0 et la courbe ne dit plus rien.
  const anchorJd =
    Date.parse(`${ANCHOR}T00:00:00Z`) / MS_PER_DAY + UNIX_EPOCH_JD;
  const k = Math.round((anchorJd - entry.startJdTdb) / step);
  const startJd = entry.startJdTdb + k * step;
  const stopJd = startJd + 2 * step;
  const iso = (jd) =>
    new Date((jd - UNIX_EPOCH_JD) * MS_PER_DAY)
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');
  // Horizons n'accepte qu'un ENTIER d'unités : le pas de sonde s'exprime en minutes entières.
  // C'est d'ailleurs la limite du GÉNÉRATEUR, pas de l'API : `buildUrl` arrondit en heures.
  const stepMinutes = Math.max(1, Math.round((period * 1440) / POINTS_PER_REV));

  const truth = await vectors(
    target.command,
    center.id,
    iso(startJd),
    iso(stopJd),
    stepMinutes,
    name
  );

  const samples = [];
  for (const t of truth) {
    const value = resolver.precise(
      name,
      cfg,
      new Date((t.jd - UNIX_EPOCH_JD) * MS_PER_DAY)
    );
    if (!value) continue;
    const truthScene = eclipticKmToScene(t.pos);
    const errKm = Math.hypot(
      value.x * KM_PER_AU - truthScene[0],
      value.y * KM_PER_AU - truthScene[1],
      value.z * KM_PER_AU - truthScene[2]
    );
    // Arc propagé : la distance au nœud le plus proche, en jours.
    const u = (((t.jd - entry.startJdTdb) / step) % 1) + 1;
    const phase = u % 1;
    samples.push({ arcDays: Math.min(phase, 1 - phase) * step, errKm });
  }
  if (samples.length < 20)
    throw new Error(`« ${name} » : ${samples.length} point(s) seulement`);

  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  /** « Au nœud » = au plus un pas de sonde : c'est le plancher que la donnée elle-même impose. */
  const nodeArc = stepMinutes / 1440;
  const atNode = samples.filter((s) => s.arcDays <= nodeArc);
  const floorKm = atNode.length ? mean(atNode.map((s) => s.errKm)) : null;
  // Régime LINÉAIRE : au-delà du plancher et sous un dixième de révolution.
  const linear = samples.filter(
    (s) => s.arcDays > nodeArc && s.arcDays < period / 10
  );
  const rateKmPerDay = linear.length
    ? mean(linear.map((s) => s.errKm / s.arcDays))
    : null;
  const saturated = samples.filter((s) => s.arcDays > period / 4);
  const saturationKm = saturated.length
    ? mean(saturated.map((s) => s.errKm))
    : null;
  // L'arc MAXIMAL vaut la moitié du pas, d'où le facteur 2.
  //
  // DEUX BORNES, parce qu'un modèle extrapolé hors de son domaine ment avec aplomb. Sans elles
  // Triton sortait « 1 899 664 min », soit un pas de 3,6 ANS, ce qui n'a aucun sens : son écart
  // sature déjà à 0,04 rayon, donc il tient la cible à n'importe quel pas.
  //   - si la cible est AU-DESSUS de la saturation, le corps la tient déjà : rien à faire ;
  //   - sinon le pas visé n'est valide que s'il reste dans le régime linéaire, c'est-à-dire
  //     sous un dixième de révolution ; au-delà, on ne sait pas, et on le DIT.
  const targetKm = TARGET_RADII * radiusKm;
  const alreadyMet = saturationKm !== null && saturationKm <= targetKm;
  let neededStepDays = null;
  let neededBeyondModel = false;
  if (!alreadyMet && rateKmPerDay) {
    const candidate = (2 * targetKm) / rateKmPerDay;
    neededBeyondModel = candidate / 2 > period / 10;
    neededStepDays = neededBeyondModel ? null : candidate;
  }

  rows.push({
    name,
    periodDays: period,
    radiusKm,
    stepDays: step,
    samplesPerRev: period / step,
    points: samples.length,
    probeStepMinutes: stepMinutes,
    pointsPerRev: POINTS_PER_REV,
    linearPoints: linear.length,
    floorKm,
    floorRadii: floorKm === null ? null : floorKm / radiusKm,
    rateKmPerDay,
    saturationKm,
    saturationRadii: saturationKm === null ? null : saturationKm / radiusKm,
    alreadyMet,
    neededBeyondModel,
    neededStepDays,
    neededStepMinutes: neededStepDays === null ? null : neededStepDays * 1440,
  });
}

await loader.close();

const n = (v, d = 1) => (v === null || v === undefined ? 'n/a' : v.toFixed(d));
console.log(
  `\nÉcart en fonction de l'arc propagé — cible ${TARGET_RADII} rayon(s), ancrage ${ANCHOR}`
);
console.log(
  `${apiCalls} requête(s) Horizons, ${cacheHits} réponse(s) lue(s) du cache\n`
);
console.log(
  'corps        pas     éch/rév  plancher km   taux km/j   saturé km (R)    pas visé'
);
for (const r of rows) {
  console.log(
    r.name.padEnd(12),
    `${r.stepDays} j`.padEnd(7),
    n(r.samplesPerRev, 2).padStart(7),
    n(r.floorKm).padStart(12),
    n(r.rateKmPerDay, 0).padStart(11),
    `${n(r.saturationKm, 0)} (${n(r.saturationRadii, 1)})`.padStart(16),
    (r.alreadyMet
      ? 'déjà tenu'
      : r.neededBeyondModel
        ? 'hors modèle'
        : `${n(r.neededStepMinutes, 0)} min`
    ).padStart(12)
  );
}

const out = option('--out');
if (out) {
  writeFileSync(
    out,
    JSON.stringify({ anchor: ANCHOR, targetRadii: TARGET_RADII, rows }, null, 2)
  );
  console.log(`\nÉcrit : ${out}`);
}
