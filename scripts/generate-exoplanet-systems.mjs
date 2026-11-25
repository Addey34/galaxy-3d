#!/usr/bin/env node
/* global console, fetch, process, URLSearchParams */
/**
 * L'ARCHITECTURE DES SYSTÈMES D'EXOPLANÈTES (GAL-UNIVERSE-006) : instantané daté de la NASA Exoplanet
 * Archive, avec ce que la vue d'un système doit pouvoir dire et la PROVENANCE de chaque valeur.
 *
 *   pnpm exoplanets:systems              # lit le cache .cache/exoplanet-systems/ sinon interroge l'archive
 *   pnpm exoplanets:systems -- --refresh # interroge de nouveau l'archive (un acte délibéré)
 *   pnpm exoplanets:systems -- --check   # code 1 si les fichiers livrés ne sont plus ceux que le cache produit
 *
 * SOURCE. La même table que `exoplanets.json` (`pscomppars`, « Planetary Systems Composite Parameters »,
 * service TAP de l'archive) et le même remerciement exigé (voir `generate-exoplanets.mjs`). Ce fichier
 * NE REMPLACE PAS `exoplanets.json` (couche du ciel, fiche, visite) : il en est un complément, lu
 * seulement quand on explore un système, et il porte sa propre date de lecture.
 *
 * PROVENANCE. La table composite remplit certains trous par un CALCUL de l'archive (relation
 * masse-rayon pour le rayon d'une planète vue en vitesse radiale, troisième loi de Kepler pour un
 * demi-grand axe…) ; la colonne `<paramètre>_reflink` le dit alors (« Calculated Value »). Chaque
 * valeur est donc suivie d'un drapeau : 1 = calculée par l'archive, 0 = tirée d'une publication. Mesuré
 * le 2026-11-25 sur les 47 planètes à moins de 5,5 pc : les 47 rayons sont calculés, aucun n'est mesuré.
 * Une valeur absente est `null`, jamais 0.
 *
 * DÉCOUPAGE. Les systèmes sont répartis en `BUCKETS` fichiers par le hachage FNV-1a du nom d'hôte
 * (`core/exoplanetSystems.bucketOf`, le même calcul) : explorer un système ne télécharge que son paquet.
 */
import { Buffer } from 'node:buffer';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { sameIgnoringReadDates } from './drift-compare.mjs';

const TAP = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
const COLUMNS = [
  'pl_name',
  'hostname',
  'ra',
  'dec',
  'sy_dist',
  'sy_snum',
  'sy_pnum',
  'cb_flag',
  'pl_controv_flag',
  'pl_orbper',
  'pl_orbper_reflink',
  'pl_orbsmax',
  'pl_orbsmax_reflink',
  'pl_orbeccen',
  'pl_orbeccen_reflink',
  'pl_orbincl',
  'pl_orbincl_reflink',
  'pl_rade',
  'pl_rade_reflink',
  'pl_bmasse',
  'pl_bmasse_reflink',
  'pl_bmassprov',
  'disc_year',
  'discoverymethod',
  'st_spectype',
  'st_teff',
  'st_teff_reflink',
  'st_rad',
  'st_rad_reflink',
  'st_mass',
  'st_mass_reflink',
];
const QUERY = `select ${COLUMNS.join(',')} from pscomppars order by hostname,pl_name`;
const CACHE_DIR = '.cache/exoplanet-systems';
const CACHE = `${CACHE_DIR}/pscomppars.csv`;
const OUT_DIR = 'public/assets/sky/systems';
/** Nombre de paquets : doit être celui de `core/exoplanetSystems.ts` (un test le vérifie). */
const BUCKETS = 32;
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

/** FNV-1a 32 bits sur les unités UTF-16 du nom : identique à `core/exoplanetSystems.bucketOf`. */
function bucketOf(host) {
  let h = 0x811c9dc5;
  for (let i = 0; i < host.length; i++) {
    h ^= host.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % BUCKETS;
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
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE, text);
  const retrieved = new Date().toISOString().slice(0, 10);
  writeFileSync(`${CACHE_DIR}/retrieved.txt`, retrieved);
  return { text, retrieved };
}
function readRetrieved() {
  const f = `${CACHE_DIR}/retrieved.txt`;
  if (!existsSync(f)) throw new Error(`${f} absent : relancer avec --refresh`);
  return readFileSync(f, 'utf8').trim();
}

const num = (s, d) => {
  if (s === '' || s === undefined) return null;
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;
};
/** 1 quand l'archive a CALCULÉ la valeur, 0 quand elle vient d'une publication, null sans valeur. */
const calc = (value, reflink) =>
  value === null ? null : /Calculated Value/i.test(reflink ?? '') ? 1 : 0;

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
  const v = (name) => r[col[name]];
  const host = v('hostname');
  const ra = num(v('ra'), 5);
  const dec = num(v('dec'), 5);
  if (!host || ra === null || dec === null)
    throw new Error(`planète sans étoile ou sans position : ${v('pl_name')}`);
  let h = hosts.get(host);
  if (!h) {
    const teff = num(v('st_teff'), 0);
    const rad = num(v('st_rad'), 3);
    const mass = num(v('st_mass'), 3);
    h = {
      row: [
        host,
        ra,
        dec,
        num(v('sy_dist'), 3),
        num(v('sy_snum'), 0),
        num(v('sy_pnum'), 0),
        v('st_spectype') || null,
        teff,
        calc(teff, v('st_teff_reflink')),
        rad,
        calc(rad, v('st_rad_reflink')),
        mass,
        calc(mass, v('st_mass_reflink')),
      ],
      planets: [],
    };
    hosts.set(host, h);
  }
  const period = num(v('pl_orbper'), 5);
  const axis = num(v('pl_orbsmax'), 5);
  const ecc = num(v('pl_orbeccen'), 4);
  const incl = num(v('pl_orbincl'), 2);
  const radius = num(v('pl_rade'), 3);
  const massE = num(v('pl_bmasse'), 4);
  h.planets.push([
    v('pl_name'),
    period,
    calc(period, v('pl_orbper_reflink')),
    axis,
    calc(axis, v('pl_orbsmax_reflink')),
    ecc,
    calc(ecc, v('pl_orbeccen_reflink')),
    incl,
    calc(incl, v('pl_orbincl_reflink')),
    radius,
    calc(radius, v('pl_rade_reflink')),
    massE,
    calc(massE, v('pl_bmasse_reflink')),
    massE === null ? null : v('pl_bmassprov') || null,
    num(v('disc_year'), 0),
    v('discoverymethod') || null,
    v('pl_controv_flag') === '1' ? 1 : 0,
    v('cb_flag') === '1' ? 1 : 0,
  ]);
}
if (hosts.size < MIN_SYSTEMS)
  throw new Error(
    `${hosts.size} systèmes, moins que le plancher ${MIN_SYSTEMS}`
  );

/** Témoins : des systèmes connus, qui ne peuvent plus perdre de planètes. */
const witness = (name, planets) => {
  const h = hosts.get(name);
  if (!h || h.planets.length < planets)
    throw new Error(
      `témoin ${name} : ${h?.planets.length ?? 0} planètes, attendu ${planets} au moins`
    );
};
witness('TRAPPIST-1', 7);
witness('Proxima Cen', 2);
witness("Barnard's star", 4);

const source = {
  id: 'nasa-exoplanet-archive',
  name: 'NASA Exoplanet Archive, Planetary Systems Composite Parameters',
  url: 'https://exoplanetarchive.ipac.caltech.edu/',
  table: 'pscomppars',
  acknowledgementUrl:
    'https://exoplanetarchive.ipac.caltech.edu/docs/acknowledge.html',
  citation:
    'Christiansen et al. (2025), Planetary Science Journal, NASA Exoplanet Archive',
  retrieved,
  planets: body.length,
  systems: hosts.size,
};
const fields = [
  'host',
  'raDeg',
  'decDeg',
  'distPc',
  'stars',
  'planetCount',
  'spectral',
  'teffK',
  'teffCalc',
  'radiusSun',
  'radiusCalc',
  'massSun',
  'massCalc',
];
const planetFields = [
  'name',
  'periodDays',
  'periodCalc',
  'semiMajorAxisAu',
  'semiMajorAxisCalc',
  'eccentricity',
  'eccentricityCalc',
  'inclinationDeg',
  'inclinationCalc',
  'radiusEarth',
  'radiusCalc',
  'massEarth',
  'massCalc',
  'massKind',
  'discoveryYear',
  'method',
  'controversial',
  'circumbinary',
];
const buckets = Array.from({ length: BUCKETS }, () => []);
for (const h of hosts.values())
  buckets[bucketOf(h.row[0])].push([...h.row, h.planets]);
const files = buckets.map((systems, i) => ({
  name: `${String(i).padStart(2, '0')}.json`,
  json:
    JSON.stringify({
      source,
      bucket: i,
      buckets: BUCKETS,
      fields: [...fields, 'planets'],
      planetFields,
      count: systems.length,
      systems,
    }) + '\n',
}));

if (process.argv.includes('--check')) {
  const stale = files.filter(
    (f) =>
      !existsSync(`${OUT_DIR}/${f.name}`) ||
      !sameIgnoringReadDates(
        readFileSync(`${OUT_DIR}/${f.name}`, 'utf8'),
        f.json
      )
  );
  const extra = existsSync(OUT_DIR)
    ? readdirSync(OUT_DIR).filter((n) => !files.some((f) => f.name === n))
    : [];
  const same = stale.length === 0 && extra.length === 0;
  console.log(
    same
      ? 'à jour'
      : `DÉRIVE : relancer pnpm exoplanets:systems (${[...stale.map((f) => f.name), ...extra].join(', ')})`
  );
  process.exit(same ? 0 : 1);
}
mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
for (const f of files) {
  writeFileSync(`${OUT_DIR}/${f.name}`, f.json);
  total += f.json.length;
}
console.log(
  `${hosts.size} systèmes, ${body.length} planètes, ${BUCKETS} paquets, ${total} o (relevé du ${retrieved})`
);
