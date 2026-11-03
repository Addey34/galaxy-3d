#!/usr/bin/env node
/* global console, fetch, process, URLSearchParams */
/**
 * LES EXOPLANÈTES CONFIRMÉES, groupées par ÉTOILE HÔTE : instantané daté de la NASA Exoplanet Archive.
 *
 *   pnpm exoplanets:generate             # lit le cache .cache/exoplanets/ sinon interroge l'archive
 *   pnpm exoplanets:generate -- --refresh   # interroge de nouveau l'archive (un acte délibéré)
 *   pnpm exoplanets:generate -- --check     # code 1 si le fichier livré n'est plus celui que le cache produit
 *
 * SOURCE. Table `pscomppars` (« Planetary Systems Composite Parameters ») du service TAP de la
 * NASA Exoplanet Archive : une ligne par planète confirmée, avec un jeu de paramètres composite
 * choisi par l'archive. L'archive change CHAQUE JOUR : le fichier est un instantané, et il porte
 * la date de la requête ET le compte lu. `--check` relit le cache, jamais le réseau.
 *
 * REMERCIEMENT EXIGÉ par la NASA (page « Acknowledging the NASA Exoplanet Archive », lue le
 * 2026-11-03) : « This research has made use of the NASA Exoplanet Archive, which is operated by
 * the California Institute of Technology, under contract with the National Aeronautics and Space
 * Administration under the Exoplanet Exploration Program. » et la citation de Christiansen et al.
 * (2025). L'application l'affiche (aide, /sources).
 *
 * FORME. Un tableau par étoile hôte, dans l'ordre de `fields` ; `planets` liste, par planète : nom,
 * période orbitale (jours), rayon (rayons terrestres), demi-grand axe (UA), année de découverte,
 * méthode. Une valeur absente est `null`, jamais 0. Position en degrés J2000 (ICRS), distance en
 * parsecs, mouvement propre en mas/an : `core/starCatalogue.ts` en tire la position à une date.
 */
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const TAP = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
const COLUMNS = [
  'pl_name',
  'hostname',
  'ra',
  'dec',
  'sy_dist',
  'sy_vmag',
  'sy_pmra',
  'sy_pmdec',
  'pl_orbper',
  'pl_rade',
  'pl_orbsmax',
  'disc_year',
  'discoverymethod',
];
const QUERY = `select ${COLUMNS.join(',')} from pscomppars order by hostname,pl_name`;
const CACHE = '.cache/exoplanets/pscomppars.csv';
const OUT = 'public/assets/sky/exoplanets.json';
/** Planchers : l'archive n'a jamais compté moins (6 451 le 2026-11-03). */
const MIN_PLANETS = 6000;
const MIN_SYSTEMS = 4500;

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
  if (existsSync(CACHE) && !process.argv.includes('--refresh'))
    return { text: readFileSync(CACHE, 'utf8'), retrieved: readRetrieved() };
  const url = `${TAP}?${new URLSearchParams({ query: QUERY, format: 'csv' })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NASA Exoplanet Archive: HTTP ${res.status}`);
  const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
  if (!text.startsWith('pl_name,'))
    throw new Error(
      `NASA Exoplanet Archive: réponse qui n'est pas du CSV attendu (${text.slice(0, 80)})`
    );
  mkdirSync('.cache/exoplanets', { recursive: true });
  writeFileSync(CACHE, text);
  const retrieved = new Date().toISOString().slice(0, 10);
  writeFileSync('.cache/exoplanets/retrieved.txt', retrieved);
  return { text, retrieved };
}
function readRetrieved() {
  const f = '.cache/exoplanets/retrieved.txt';
  if (!existsSync(f)) throw new Error(`${f} absent : relancer avec --refresh`);
  return readFileSync(f, 'utf8').trim();
}

const num = (s, d) => {
  if (s === '' || s === undefined) return null;
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;
};

const { text, retrieved } = await load();
const rows = parseCsv(text);
const head = rows[0];
const col = Object.fromEntries(head.map((n, i) => [n, i]));
for (const n of COLUMNS)
  if (!(n in col)) throw new Error(`colonne absente « ${n} »`);
const body = rows.slice(1);
if (body.length < MIN_PLANETS)
  throw new Error(
    `${body.length} planètes, moins que le plancher ${MIN_PLANETS}`
  );

const hosts = new Map();
for (const r of body) {
  const host = r[col.hostname];
  const ra = num(r[col.ra], 5);
  const dec = num(r[col.dec], 5);
  if (!host || ra === null || dec === null)
    throw new Error(`planète sans étoile ou sans position : ${r[col.pl_name]}`);
  let h = hosts.get(host);
  if (!h) {
    h = {
      host,
      ra,
      dec,
      distPc: num(r[col.sy_dist], 2),
      vmag: num(r[col.sy_vmag], 2),
      pmRa: num(r[col.sy_pmra], 1),
      pmDec: num(r[col.sy_pmdec], 1),
      planets: [],
    };
    hosts.set(host, h);
  }
  h.planets.push([
    r[col.pl_name],
    num(r[col.pl_orbper], 4),
    num(r[col.pl_rade], 2),
    num(r[col.pl_orbsmax], 4),
    num(r[col.disc_year], 0),
    r[col.discoverymethod] || null,
  ]);
}
if (hosts.size < MIN_SYSTEMS)
  throw new Error(
    `${hosts.size} systèmes, moins que le plancher ${MIN_SYSTEMS}`
  );

/** Témoins : des systèmes dont le contenu est connu et ne peut plus diminuer. */
const witness = (name, planets) => {
  const h = hosts.get(name);
  if (!h || h.planets.length < planets)
    throw new Error(
      `témoin ${name} : ${h?.planets.length ?? 0} planètes, attendu ${planets} au moins`
    );
};
witness('TRAPPIST-1', 7);
witness('Proxima Cen', 1);
// L'archive range les huit planètes de Kepler-90 sous l'hôte « KOI-351 » (la huitième s'y nomme
// « Kepler-90 i ») : lu dans la table le 2026-11-03, le nom d'hôte est celui de l'archive.
witness('KOI-351', 8);

const systems = [...hosts.values()].map((h) => [
  h.host,
  h.ra,
  h.dec,
  h.distPc,
  h.vmag,
  h.pmRa,
  h.pmDec,
  h.planets,
]);
const out = {
  source: {
    id: 'nasa-exoplanet-archive',
    name: 'NASA Exoplanet Archive, Planetary Systems Composite Parameters',
    url: 'https://exoplanetarchive.ipac.caltech.edu/',
    table: 'pscomppars',
    license: 'remerciement exigé par l’archive (voir acknowledgementUrl)',
    acknowledgementUrl:
      'https://exoplanetarchive.ipac.caltech.edu/docs/acknowledge.html',
    citation:
      'Christiansen et al. (2025), Planetary Science Journal, NASA Exoplanet Archive',
    retrieved,
    planets: body.length,
  },
  fields: [
    'host',
    'raDeg',
    'decDeg',
    'distPc',
    'vmag',
    'pmRaMas',
    'pmDecMas',
    'planets',
  ],
  planetFields: [
    'name',
    'periodDays',
    'radiusEarth',
    'semiMajorAxisAu',
    'discoveryYear',
    'method',
  ],
  count: systems.length,
  systems,
};
const json = JSON.stringify(out) + '\n';
if (process.argv.includes('--check')) {
  const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === json;
  console.log(same ? 'à jour' : 'DÉRIVE : relancer pnpm exoplanets:generate');
  process.exit(same ? 0 : 1);
}
mkdirSync('public/assets/sky', { recursive: true });
writeFileSync(OUT, json);
console.log(
  `${systems.length} systèmes, ${body.length} planètes, ${json.length} o (relevé du ${retrieved})`
);
