#!/usr/bin/env node
/* global console, fetch, process */
/**
 * CATALOGUE D'ÉTOILES DU CIEL RÉEL : HYG v4.4 (Hipparcos + Yale Bright Star + Gliese), limité à
 * la magnitude de l'œil nu, cuit en un petit JSON livré avec le build.
 *
 *   pnpm stars:generate           # lit le cache .cache/star-catalogue/ sinon télécharge
 *   pnpm stars:generate -- --check  # code 1 si le fichier livré n'est plus celui que ce script écrirait
 *
 * SOURCE. Codeberg, dépôt `astronexus/hyg` (le miroir GitHub est ARCHIVÉ : « No further updates »).
 * Le fichier est en Git LFS : l'adresse `raw/` rend un pointeur de 133 octets, la bonne est `media/`.
 * Le script REFUSE un contenu qui n'est pas du gzip, et un catalogue dont le compte ou le nom
 * d'étoile témoin dérive. LICENCE : CC BY-SA 4.0 (lue dans le `LICENSE` du dépôt et son README le
 * 2026-11-03). Le jeu produit est une adaptation : il est redistribué sous la même licence.
 *
 * FORME. Un tableau par étoile, dans l'ordre de `fields` : ascension droite et déclinaison J2000
 * en degrés, magnitude visuelle, indice B−V, distance en parsecs (100 000 = parallaxe inconnue),
 * mouvement propre en ascension droite (déjà multiplié par cos δ) et en déclinaison en mas/an,
 * vitesse radiale en km/s (0 = inconnue), nom propre. `core/starCatalogue.ts` en tire la position à
 * n'importe quelle date, par mouvement RECTILIGNE UNIFORME : valable sur des siècles, pas des
 * millénaires pour les étoiles proches (le potentiel galactique et les compagnons ne sont pas
 * modélisés).
 */
import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const URL_MEDIA =
  'https://codeberg.org/astronexus/hyg/media/branch/main/data/hyg/CURRENT/hyg_v44.csv.gz';
const CACHE = '.cache/star-catalogue/hyg_v44.csv.gz';
const OUT = 'public/assets/sky/stars.json';
const MAG_LIMIT = 6.5;
const EXPECTED_ROWS = 119614;
/** Témoin : Sirius doit être la plus brillante, magnitude −1,44. */
const WITNESS = { proper: 'Sirius', mag: -1.44 };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function load() {
  if (existsSync(CACHE)) return readFileSync(CACHE);
  const res = await fetch(URL_MEDIA);
  if (!res.ok) throw new Error(`HYG: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] !== 0x1f || buf[1] !== 0x8b)
    throw new Error(
      `HYG: contenu non gzip (${buf.length} o), pointeur Git LFS pris pour le fichier ?`
    );
  mkdirSync('.cache/star-catalogue', { recursive: true });
  writeFileSync(CACHE, buf);
  return buf;
}

const num = (s) => (s === '' || s === undefined ? null : Number(s));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

const rows = parseCsv(gunzipSync(await load()).toString('utf8'));
const head = rows[0];
const col = Object.fromEntries(head.map((n, i) => [n, i]));
for (const n of [
  'id',
  'ra',
  'dec',
  'dist',
  'pmra',
  'pmdec',
  'rv',
  'mag',
  'ci',
  'proper',
])
  if (!(n in col)) throw new Error(`HYG: colonne absente « ${n} »`);
const body = rows.slice(1);
if (body.length !== EXPECTED_ROWS)
  throw new Error(
    `HYG: ${body.length} lignes au lieu de ${EXPECTED_ROWS} : nouvelle version ? relire la source avant de changer ce compte`
  );

const stars = [];
let sirius = null;
for (const r of body) {
  if (r[col.id] === '0') continue; // le Soleil
  const mag = num(r[col.mag]);
  const ra = num(r[col.ra]);
  const dec = num(r[col.dec]);
  if (mag === null || ra === null || dec === null) continue;
  if (r[col.proper] === WITNESS.proper) sirius = mag;
  if (mag > MAG_LIMIT) continue;
  stars.push([
    round(ra * 15, 4),
    round(dec, 4),
    round(mag, 2),
    num(r[col.ci]) === null ? null : round(num(r[col.ci]), 2),
    round(num(r[col.dist]) ?? 100000, 2),
    round(num(r[col.pmra]) ?? 0, 1),
    round(num(r[col.pmdec]) ?? 0, 1),
    round(num(r[col.rv]) ?? 0, 1),
    r[col.proper] || '',
  ]);
}
if (sirius !== WITNESS.mag)
  throw new Error(`HYG: témoin Sirius ${sirius} au lieu de ${WITNESS.mag}`);
stars.sort((a, b) => a[2] - b[2]);

const out = {
  source: {
    id: 'hyg-v44',
    name: 'HYG database v4.4 (Hipparcos, Yale Bright Star, Gliese)',
    url: 'https://codeberg.org/astronexus/hyg',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    rows: EXPECTED_ROWS,
    magnitudeLimit: MAG_LIMIT,
    retrieved: '2026-11-03',
  },
  fields: [
    'raDeg',
    'decDeg',
    'mag',
    'bv',
    'distPc',
    'pmRaMas',
    'pmDecMas',
    'rvKms',
    'proper',
  ],
  count: stars.length,
  stars,
};
const json = JSON.stringify(out) + '\n';
if (process.argv.includes('--check')) {
  const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === json;
  console.log(same ? 'à jour' : 'DÉRIVE : relancer pnpm stars:generate');
  process.exit(same ? 0 : 1);
}
mkdirSync('public/assets/sky', { recursive: true });
writeFileSync(OUT, json);
console.log(`${stars.length} étoiles, ${json.length} o`);
