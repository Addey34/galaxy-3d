#!/usr/bin/env node
/* global console, fetch, process */
/**
 * LE CIEL PROFOND : amas, nébuleuses et galaxies brillantes de NGC/IC, instantané d'OpenNGC.
 *
 *   pnpm deepsky:generate             # lit le cache .cache/deepsky/ sinon télécharge au commit épinglé
 *   pnpm deepsky:generate -- --refresh   # télécharge de nouveau (un acte délibéré)
 *   pnpm deepsky:generate -- --check     # code 1 si le fichier livré n'est plus celui que le cache produit
 *
 * SOURCE. OpenNGC (Mattia Verga), `database_files/NGC.csv`, lu à un COMMIT ÉPINGLÉ (jamais `master` :
 * la base est révisée). Licence CC BY-SA 4.0, lue le 2026-11-03 dans `.reuse/dep5` du commit
 * (« License: CC-BY-SA-4.0 ») ; le README du dépôt demande de remercier NED, HyperLEDA, SIMBAD et
 * HEASARC, ce que l'application affiche (aide, /sources, notices tierces). L'empreinte SHA-256 du
 * CSV lu est scellée dans le fichier.
 *
 * SÉLECTION (une règle, écrite ici et dite à l'utilisateur) : les objets de la table qui sont des
 * objets du ciel profond (ni doublon `Dup`, ni `NonEx`, ni étoile `*`/`**`, ni association `*Ass`,
 * ni `Other`), dont la position est connue, ET soit un objet Messier, soit de magnitude V
 * catalogée <= 10. Aucune conversion de magnitude (B vers V) n'est inventée : un objet sans V qui
 * n'est pas Messier est écarté.
 *
 * FORME. Un tableau par objet, dans l'ordre de `fields`. Position J2000 en degrés (le catalogue ne
 * donne ni distance ni mouvement propre utilisables ici : direction seule). Une valeur absente est
 * `null`, jamais 0.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const COMMIT = 'be3cd6c5498806a2fbb2f7e0452ef802dbb02be0';
const RAW = `https://raw.githubusercontent.com/mattiaverga/OpenNGC/${COMMIT}`;
const CSV_URL = `${RAW}/database_files/NGC.csv`;
const CACHE_DIR = '.cache/deepsky';
const CACHE = `${CACHE_DIR}/NGC.csv`;
const OUT = 'public/assets/sky/deepsky.json';
const V_LIMIT = 10;
const SKIPPED_TYPES = new Set(['Dup', 'NonEx', '*', '**', '*Ass', 'Other']);
/** Planchers : la sélection n'a jamais compté moins (494 objets, 13 970 lignes lues le 2026-11-03). */
const MIN_ROWS = 13000;
const MIN_OBJECTS = 450;

async function load() {
  if (process.argv.includes('--refresh') || !existsSync(CACHE)) {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} pour ${CSV_URL}`);
    const text = await res.text();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE, text);
    return text;
  }
  return readFileSync(CACHE, 'utf8');
}

/** CSV à séparateur « ; » avec champs entre guillemets (un champ de notes peut contenir « ; »). */
function parseCsv(text) {
  const out = [];
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
    else if (c === ';') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') out.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

const text = await load();
const table = parseCsv(text);
const head = table[0];
const col = Object.fromEntries(head.map((n, i) => [n, i]));
for (const n of [
  'Name',
  'Type',
  'RA',
  'Dec',
  'Const',
  'MajAx',
  'V-Mag',
  'M',
  'Common names',
])
  if (!(n in col)) throw new Error(`colonne absente « ${n} »`);
const rows = table.slice(1);
rows.forEach((f, i) => {
  if (f.length !== head.length)
    throw new Error(
      `ligne ${i + 2} : ${f.length} champs au lieu de ${head.length}`
    );
});
if (rows.length < MIN_ROWS)
  throw new Error(`${rows.length} lignes, moins que le plancher ${MIN_ROWS}`);

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const number = (s, d) => {
  if (s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? round(v, d) : null;
};
/** « HH:MM:SS.SS » vers degrés. */
function raDeg(s) {
  const m = /^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  return round(
    (Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600) * 15,
    4
  );
}
/** « +DD:MM:SS.S » vers degrés. */
function decDeg(s) {
  const m = /^([+-])(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
  return round(m[1] === '-' ? -v : v, 4);
}
/** « NGC0224 » vers « NGC 224 ». */
function designation(name) {
  const m = /^(NGC|IC)(\d+)([A-Za-z]*)$/.exec(name);
  if (!m) throw new Error(`désignation inattendue « ${name} »`);
  return `${m[1]} ${Number(m[2])}${m[3]}`;
}

const objects = [];
for (const f of rows) {
  const type = f[col.Type];
  if (SKIPPED_TYPES.has(type)) continue;
  const ra = raDeg(f[col.RA]);
  const dec = decDeg(f[col.Dec]);
  if (ra === null || dec === null) continue;
  const messier = f[col.M] === '' ? null : Number(f[col.M]);
  if (messier !== null && !Number.isInteger(messier))
    throw new Error(
      `numéro de Messier illisible « ${f[col.M]} » (${f[col.Name]})`
    );
  const vmag = number(f[col['V-Mag']], 2);
  if (messier === null && !(vmag !== null && vmag <= V_LIMIT)) continue;
  objects.push([
    designation(f[col.Name]),
    messier,
    f[col['Common names']].split(',')[0].trim() || null,
    type,
    f[col.Const] || null,
    ra,
    dec,
    vmag,
    number(f[col.MajAx], 2),
  ]);
}
objects.sort((a, b) => (a[7] ?? 99) - (b[7] ?? 99) || a[0].localeCompare(b[0]));
if (objects.length < MIN_OBJECTS)
  throw new Error(
    `${objects.length} objets, moins que le plancher ${MIN_OBJECTS}`
  );

/** Témoins : des objets dont la position est connue et ne peut pas avoir changé de plus d'un degré. */
const witness = (name, ra, dec) => {
  const o = objects.find((x) => x[0] === name);
  if (!o) throw new Error(`témoin ${name} absent de la sélection`);
  if (Math.abs(o[5] - ra) > 1 || Math.abs(o[6] - dec) > 1)
    throw new Error(
      `témoin ${name} : ${o[5]}, ${o[6]} au lieu de ~${ra}, ${dec}`
    );
};
witness('NGC 224', 10.68, 41.27); // M31, Andromède
witness('NGC 1976', 83.82, -5.39); // M42, Orion
witness('NGC 5139', 201.7, -47.48); // Omega du Centaure
witness('NGC 6205', 250.42, 36.46); // M13
if (objects.filter((o) => o[1] !== null).length < 100)
  throw new Error(
    'moins de 100 objets Messier : la sélection a perdu la liste'
  );

const out = {
  source: {
    id: 'openngc',
    name: 'OpenNGC (NGC/IC), Mattia Verga',
    url: 'https://github.com/mattiaverga/OpenNGC',
    commit: COMMIT,
    license: 'CC-BY-SA-4.0',
    licenseUrl: `https://github.com/mattiaverga/OpenNGC/blob/${COMMIT}/LICENSES/CC-BY-SA-4.0.txt`,
    retrieved: '2026-11-03',
    csvSha256: createHash('sha256').update(text).digest('hex'),
    rows: rows.length,
    vLimit: V_LIMIT,
  },
  fields: [
    'designation',
    'messier',
    'commonName',
    'type',
    'constellation',
    'raDeg',
    'decDeg',
    'vmag',
    'majorAxisArcmin',
  ],
  count: objects.length,
  objects,
};
const json = JSON.stringify(out) + '\n';
if (process.argv.includes('--check')) {
  const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === json;
  console.log(same ? 'à jour' : 'DÉRIVE : relancer pnpm deepsky:generate');
  process.exit(same ? 0 : 1);
}
mkdirSync('public/assets/sky', { recursive: true });
writeFileSync(OUT, json);
console.log(
  `${objects.length} objets (dont ${objects.filter((o) => o[1] !== null).length} Messier) sur ${rows.length} lignes, ${json.length} o`
);
