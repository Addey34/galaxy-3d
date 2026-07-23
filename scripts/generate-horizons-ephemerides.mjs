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
const BODIES = [
  { name: 'ceres', target: '1;' },
  { name: 'eris', target: '136199;' },
  { name: 'haumea', target: '136108;' },
  { name: 'makemake', target: '136472;' },
];

function buildUrl(target) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${target}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: '500@10',
    START_TIME: `'${START_TIME}'`,
    STOP_TIME: `'${STOP_TIME}'`,
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

async function fetchBody(body) {
  process.stdout.write(`Fetching ${body.name}... `);
  const response = await fetch(buildUrl(body.target), {
    headers: { 'User-Agent': 'Galaxy-Ephemeris-Generator/1.0' },
  });
  if (!response.ok) throw new Error(`${body.name}: HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload.result !== 'string')
    throw new Error(`${body.name}: invalid Horizons response`);

  const { rows, stepDays } = parseVectors(payload.result, body.name);
  const binary = encodeBinary(rows);
  const hash = createHash('sha256').update(binary).digest('hex').slice(0, 12);
  const file = `${body.name}.${hash}.bin`;
  await writeFile(resolve(OUTPUT_DIR, file), binary);
  process.stdout.write(`${rows.length} samples\n`);
  return {
    file,
    target: body.target,
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
