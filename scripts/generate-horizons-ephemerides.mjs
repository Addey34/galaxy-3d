/* global Buffer, URLSearchParams, fetch, process */
/** Génère les vecteurs binaires NASA/JPL Horizons consommés par l'application. */
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = resolve(ROOT, 'public/assets/ephemerides');
const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const START_TIME = '1900-01-01';
const STOP_TIME = '2101-01-01';
const STEP_DAYS = 4;
const CENTER_IDS = {
  sun: '10',
  mars: '499',
  jupiter: '599',
  saturn: '699',
  uranus: '799',
  neptune: '899',
  pluto: '999',
};
// IMPORTANT — le point-virgule final sur COMMAND force Horizons à chercher dans la base des
// PETITS corps (astéroïdes/comètes) plutôt que dans la table des corps majeurs/satellites.
// C'est correct et nécessaire pour désambiguïser un numéro de petit corps (ex. Cérès = astéroïde
// 1 — sans ';' Horizons pourrait matcher autre chose). C'est en revanche une erreur silencieuse
// pour un ID de planète/satellite majeur (ex. 699 = Saturne) : '699;' matche l'astéroïde 699 Hela
// au lieu de Saturne — un bug réel qui a affecté cette liste (voir fetchBody : la vérification
// du nom de cible sert de garde-fou définitif contre toute régression de ce type).
const BODIES = [
  { name: 'ceres', target: '1;', expectedName: 'ceres', center: 'sun' },
  { name: 'eris', target: '136199;', expectedName: 'eris', center: 'sun' },
  { name: 'haumea', target: '136108;', expectedName: 'haumea', center: 'sun' },
  {
    name: 'makemake',
    target: '136472;',
    expectedName: 'makemake',
    center: 'sun',
  },
  { name: 'saturn', target: '699', expectedName: 'saturn', center: 'sun' },
  {
    name: 'enceladus',
    target: '602',
    expectedName: 'enceladus',
    center: 'saturn',
  },
  { name: 'rhea', target: '605', expectedName: 'rhea', center: 'saturn' },
  { name: 'titan', target: '606', expectedName: 'titan', center: 'saturn' },
  {
    name: 'iapetus',
    target: '608',
    expectedName: 'iapetus',
    center: 'saturn',
  },
  { name: 'mars', target: '499', expectedName: 'mars', center: 'sun' },
  { name: 'phobos', target: '401', expectedName: 'phobos', center: 'mars' },
  { name: 'deimos', target: '402', expectedName: 'deimos', center: 'mars' },
  { name: 'neptune', target: '899', expectedName: 'neptune', center: 'sun' },
  {
    name: 'triton',
    target: '801',
    expectedName: 'triton',
    center: 'neptune',
  },
  { name: 'pluto', target: '999', expectedName: 'pluto', center: 'sun' },
  { name: 'charon', target: '901', expectedName: 'charon', center: 'pluto' },
  {
    name: 'mimas',
    target: '601',
    expectedName: 'mimas',
    center: 'saturn',
  },
  {
    name: 'tethys',
    target: '603',
    expectedName: 'tethys',
    center: 'saturn',
  },
  { name: 'dione', target: '604', expectedName: 'dione', center: 'saturn' },
  {
    name: 'hyperion',
    target: '607',
    expectedName: 'hyperion',
    center: 'saturn',
  },
  {
    name: 'miranda',
    target: '705',
    expectedName: 'miranda',
    center: 'uranus',
  },
  { name: 'ariel', target: '701', expectedName: 'ariel', center: 'uranus' },
  {
    name: 'umbriel',
    target: '702',
    expectedName: 'umbriel',
    center: 'uranus',
  },
  {
    name: 'titania',
    target: '703',
    expectedName: 'titania',
    center: 'uranus',
  },
  {
    name: 'oberon',
    target: '704',
    expectedName: 'oberon',
    center: 'uranus',
  },
  {
    name: 'amalthea',
    target: '505',
    expectedName: 'amalthea',
    center: 'jupiter',
  },
  {
    name: 'proteus',
    target: '808',
    expectedName: 'proteus',
    center: 'neptune',
  },
  {
    name: 'nereid',
    target: '802',
    expectedName: 'nereid',
    center: 'neptune',
  },
  { name: 'styx', target: '905', expectedName: 'styx', center: 'pluto' },
  { name: 'nix', target: '902', expectedName: 'nix', center: 'pluto' },
  {
    name: 'kerberos',
    target: '904',
    expectedName: 'kerberos',
    center: 'pluto',
  },
  { name: 'hydra', target: '903', expectedName: 'hydra', center: 'pluto' },
  // Sondes spatiales — cibles JPL Horizons par ID négatif, pas de ';' final (contrairement aux
  // numéros de petits corps ambigus, ces IDs sont déjà uniques). `startTime` par corps évite de
  // demander des décennies de non-données à Horizons avant le lancement réel.
  {
    name: 'voyager1',
    target: '-31',
    expectedName: 'voyager 1',
    center: 'sun',
    // +1 jour après le lancement réel : Horizons n'a pas de vecteur au tout premier instant
    // (état initial encore indéterminé), une marge d'un jour tombe dans la couverture réelle.
    // `stopTime` : la solution de trajectoire Horizons pour une sonde est bornée dans le temps
    // (contrairement à la théorie planétaire) — au-delà, Horizons répond une erreur, pas des
    // données tronquées silencieusement. Bornes vérifiées une à une contre l'API réelle.
    startTime: '1977-09-06',
    stopTime: '2099-12-31',
  },
  {
    name: 'voyager2',
    target: '-32',
    expectedName: 'voyager 2',
    center: 'sun',
    startTime: '1977-08-21',
    stopTime: '2099-12-31',
  },
  {
    name: 'parker-solar-probe',
    target: '-96',
    expectedName: 'parker solar probe',
    center: 'sun',
    startTime: '2018-08-13',
    stopTime: '2029-12-31',
  },
  {
    name: 'jwst',
    target: '-170',
    // Horizons résout au nom complet "James Webb Space Telescope", pas au sigle.
    expectedName: 'james webb',
    center: 'sun',
    startTime: '2021-12-26',
    stopTime: '2031-08-23',
  },
];

function buildUrl(
  target,
  center,
  startTime = START_TIME,
  stopTime = STOP_TIME
) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${target}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: `500@${CENTER_IDS[center]}`,
    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,
    STEP_SIZE: `'${STEP_DAYS} d'`,
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF',
    OUT_UNITS: 'AU-D',
    VEC_TABLE: '2',
    VEC_CORR: 'NONE',
    CSV_FORMAT: 'YES',
    TIME_DIGITS: 'FRACSEC',
    CAL_TYPE: 'GREGORIAN',
  });
  return `${API_URL}?${params}`;
}

function parseVectors(result, name) {
  const start = result.indexOf('$$SOE');
  const end = result.indexOf('$$EOE');
  if (start < 0 || end <= start)
    throw new Error(`${name}: missing ephemeris block`);

  const rows = result
    .slice(start + 5, end)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(',').map((field) => field.trim());
      const jd = Number(fields[0]);
      const state = fields.slice(2, 8).map(Number);
      if (
        !Number.isFinite(jd) ||
        state.some((value) => !Number.isFinite(value))
      )
        throw new Error(`${name}: malformed row`);
      return { jd, state };
    });
  if (rows.length < 2) throw new Error(`${name}: not enough samples`);
  const stepDays = rows[1].jd - rows[0].jd;
  for (let i = 1; i < rows.length; i++) {
    if (Math.abs(rows[i].jd - rows[i - 1].jd - stepDays) > 1e-9)
      throw new Error(`${name}: non-uniform step at ${i}`);
  }
  return { rows, stepDays };
}

function encodeBinary(rows) {
  const buffer = Buffer.allocUnsafe(rows.length * 6 * 8);
  let offset = 0;
  for (const { state } of rows) {
    for (const value of state) {
      buffer.writeDoubleLE(value, offset);
      offset += 8;
    }
  }
  return buffer;
}

/**
 * Vérifie que Horizons a bien résolu la cible attendue plutôt qu'un homonyme numérique dans
 * une autre base (le bug qui a motivé cette fonction : '699;' matchait l'astéroïde 699 Hela
 * au lieu de Saturne — un résultat silencieusement plausible, jamais une erreur HTTP).
 */
function assertResolvedTarget(result, body) {
  const match = result.match(/Target body name:\s*([^\n{]+)/);
  const resolvedName = match?.[1]?.trim().toLowerCase() ?? '';
  if (!resolvedName.includes(body.expectedName)) {
    throw new Error(
      `${body.name}: Horizons resolved target "${body.target}" to "${resolvedName || 'UNKNOWN'}", expected a name containing "${body.expectedName}" — wrong COMMAND/CENTER, not a network error`
    );
  }
}

async function fetchBody(body) {
  process.stdout.write(`Fetching ${body.name}... `);
  const response = await fetch(
    buildUrl(body.target, body.center, body.startTime, body.stopTime),
    { headers: { 'User-Agent': 'Galaxy-Ephemeris-Generator/1.0' } }
  );
  if (!response.ok) throw new Error(`${body.name}: HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload.result !== 'string')
    throw new Error(`${body.name}: invalid Horizons response`);
  assertResolvedTarget(payload.result, body);

  const { rows, stepDays } = parseVectors(payload.result, body.name);
  const binary = encodeBinary(rows);
  const hash = createHash('sha256').update(binary).digest('hex').slice(0, 12);
  const file = `${body.name}.${hash}.bin`;
  await writeFile(resolve(OUTPUT_DIR, file), binary);
  process.stdout.write(`${rows.length} samples\n`);
  return {
    file,
    target: body.target,
    center: body.center,
    startJdTdb: rows[0].jd,
    stepDays,
    sampleCount: rows.length,
  };
}

await mkdir(OUTPUT_DIR, { recursive: true });
const manifest = {
  version: 1,
  source: 'NASA/JPL Horizons',
  generatedAt: new Date().toISOString(),
  frame: 'ECLIPTIC_J2000',
  center: 'SUN',
  units: 'AU-D',
  coverage: { start: START_TIME, stop: STOP_TIME },
  bodies: {},
};

for (const body of BODIES) manifest.bodies[body.name] = await fetchBody(body);

const activeFiles = new Set(
  Object.values(manifest.bodies).map((body) => body.file)
);
for (const file of await readdir(OUTPUT_DIR)) {
  if (file.endsWith('.bin') && !activeFiles.has(file))
    await unlink(resolve(OUTPUT_DIR, file));
}

await writeFile(
  resolve(OUTPUT_DIR, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
);
process.stdout.write(`Wrote ${OUTPUT_DIR}\n`);
