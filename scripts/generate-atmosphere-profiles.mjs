#!/usr/bin/env node
/* global console, process, fetch */
/**
 * LE PROFIL MESURÉ DE L'ATMOSPHÈRE D'UNE GÉANTE (lot 51, pas 3, 2026-10-15).
 *
 * Une seule géante a été traversée par un instrument : Jupiter, par la sonde de Galileo, le
 * 1995-12-07. Son Atmosphere Structure Instrument (ASI) a laissé deux tables réduites par
 * l'équipe, archivées au Planetary Data System : l'ENTRÉE (`upperatm`, de 1 028 km au-dessus du
 * niveau de 1 bar jusqu'à 23 km) et la DESCENTE (`descent`, de 17 km à −132 km sous ce niveau).
 * Ce script les lit dans le PAQUET PDS4 `urn:nasa:pds:gp`, le produit citable (DOI), dont les
 * tables sont identiques octet pour octet à celles du volume PDS3 `gp_0001` (mesuré le
 * 2026-10-15), et écrit `public/assets/atmosphere-profiles/jupiter.json`.
 *
 * TROIS RÈGLES, chacune payée ailleurs dans ce dépôt :
 *   - les COLONNES et leurs UNITÉS se lisent dans l'étiquette XML de chaque table, jamais
 *     supposées : l'entrée écrit sa pression en MILLIBARS, la descente en BARS ;
 *   - la descente n'est PAS une liste de points mesurés, et c'est la source qui le dit
 *     (`asiinfo.txt` : « derived using the dry adiabat which fits the data ») ; la phrase est
 *     exigée mot pour mot dans la réponse servie, puis publiée avec le profil ;
 *   - le profil est LOCAL (un seul point du globe), et la latitude publiée est lue dans la
 *     colonne LATITUDE de l'entrée, pas recopiée.
 *
 * Les autres géantes : `src/config/atmosphereProfileIndex.json` dit, pour chacune, combien de
 * collections le registre du PDS rattache à la planète au jour de la lecture. Aucune n'est un
 * profil de la basse atmosphère (lu à la main le 2026-10-15, `docs/private/GEANTES_LOT51.md`
 * § 5) ; si ce compte bouge, `--check` sort en code 1 pour qu'on relise. La requête porte un
 * TÉMOIN : sur Jupiter, elle doit rendre la collection de l'ASI, sinon elle serait muette et
 * l'absence ne voudrait rien dire. La liste des géantes se DÉRIVE du relevé des faits : celles
 * dont la pression de « surface » est une borne inférieure (« >>1000 bars »).
 *
 *   node scripts/generate-atmosphere-profiles.mjs [--offline] [--check]
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CACHE_DIR,
  cacheKey,
  stampNow,
  stampOf,
} from './fact-source-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, CACHE_DIR);
const OUT_DIR = join(ROOT, 'public', 'assets', 'atmosphere-profiles');
const INDEX = join(ROOT, 'src', 'config', 'atmosphereProfileIndex.json');
const SNAPSHOT = join(ROOT, 'src', 'config', 'factSources.snapshot.json');

const offline = process.argv.includes('--offline');
const check = process.argv.includes('--check');

const BUNDLE = 'https://atmos.nmsu.edu/PDS/data/PDS4/galileo_probe_bundle';
const BUNDLE_LID = 'urn:nasa:pds:gp';
const ASI_COLLECTION = 'urn:nasa:pds:gp:data_asi';
const SEARCH = 'https://pds.mcp.nasa.gov/api/search/1';
const ADIABAT_QUOTE =
  'These profiles are not a list of measured points, but is derived using the dry adiabat which fits the data';

/** Une réponse, en cache sinon lue, avec SA date de lecture (`fact-source-cache.mjs`). */
async function get(url, valid) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${cacheKey(url)}.json`);
  if (existsSync(path)) {
    const body = readFileSync(path, 'utf8');
    const why = valid?.(body);
    if (why) {
      unlinkSync(path);
      throw new Error(
        `réponse refusée pour ${url} : ${why} (retirée du cache)`
      );
    }
    return { body, retrieved: stampOf(path) };
  }
  if (offline) throw new Error(`absent du cache et --offline demandé : ${url}`);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.text();
  if (!res.ok)
    throw new Error(`HTTP ${res.status} sur ${url} : ${body.slice(0, 200)}`);
  const why = valid?.(body);
  if (why) throw new Error(`réponse refusée pour ${url} : ${why}`);
  writeFileSync(path, body);
  return { body, retrieved: stampNow(path) };
}

/** Les champs d'une table PDS4 : nom et unité, dans l'ordre, lus dans son étiquette. */
function fieldsOf(xml) {
  const fields = [];
  for (const m of xml.matchAll(
    /<Field_(?:Character|Delimited)>([\s\S]*?)<\/Field_(?:Character|Delimited)>/g
  )) {
    const name = /<name>([^<]+)<\/name>/.exec(m[1])?.[1]?.trim();
    const unit = /<unit>([^<]+)<\/unit>/.exec(m[1])?.[1]?.trim() ?? null;
    if (!name) throw new Error('champ sans nom dans une étiquette');
    fields.push({ name, unit });
  }
  if (fields.length === 0) throw new Error('étiquette sans champ');
  return fields;
}

/** Les lignes numériques d'une table, en colonnes. */
function rowsOf(table, width) {
  const rows = [];
  for (const line of table.split(/\r?\n/)) {
    const cells = line.trim().split(/\s+/);
    if (cells.length !== width) continue;
    const numbers = cells.map(Number);
    if (numbers.every(Number.isFinite)) rows.push(numbers);
  }
  return rows;
}

const PRESSURE_TO_BAR = { MILLIBARS: 1e-3, BARS: 1 };

/** Une table de l'ASI : altitude (km), pression (bar), température (K), avec latitude si publiée. */
async function asiTable(product) {
  const label = await get(`${BUNDLE}/data_asi/${product}.xml`, (b) =>
    b.includes(
      `<logical_identifier>${ASI_COLLECTION}:${product}</logical_identifier>`
    )
      ? null
      : 'identifiant logique absent'
  );
  const table = await get(`${BUNDLE}/data_asi/${product}.tab`);
  const fields = fieldsOf(label.body);
  const col = (name) => {
    const i = fields.findIndex((f) => f.name === name);
    if (i < 0)
      throw new Error(`${product} : colonne ${name} absente de l'étiquette`);
    return i;
  };
  const alt = col('ALTITUDE');
  const pressure = col('PRESSURE');
  const temperature = col('TEMPERATURE');
  if (fields[alt].unit !== 'KM')
    throw new Error(`${product} : altitude en ${fields[alt].unit}`);
  if (fields[temperature].unit !== 'KELVINS')
    throw new Error(`${product} : température en ${fields[temperature].unit}`);
  const toBar = PRESSURE_TO_BAR[fields[pressure].unit];
  if (!toBar)
    throw new Error(`${product} : pression en ${fields[pressure].unit}`);
  const latitude = fields.findIndex((f) => f.name === 'LATITUDE');
  // L'intervalle de temps que l'étiquette DÉCLARE, ou `null` quand elle le dit inconnu (la
  // descente porte `nilReason="unknown"`) : on ne le complète pas.
  const time = (tag) =>
    new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(label.body)?.[1] ?? null;
  const rows = rowsOf(table.body, fields.length);
  if (rows.length < 100)
    throw new Error(`${product} : ${rows.length} lignes seulement`);
  const samples = rows
    .map((r) => [
      r[alt],
      Number((r[pressure] * toBar).toPrecision(6)),
      r[temperature],
    ])
    .sort((a, b) => b[0] - a[0]);
  return {
    product: `${ASI_COLLECTION}:${product}`,
    url: `${BUNDLE}/data_asi/${product}.tab`,
    retrieved: [label.retrieved, table.retrieved].sort().at(-1),
    start: time('start_date_time'),
    stop: time('stop_date_time'),
    samples,
    latitudes: latitude < 0 ? [] : rows.map((r) => r[latitude]),
  };
}

/** Le paquet : sa citation et son DOI, lus dans le registre (jamais recopiés). */
async function bundleCitation() {
  const url =
    `${SEARCH}/classes/bundle?q=${encodeURIComponent(`lid eq "${BUNDLE_LID}"`)}` +
    '&fields=lid,title,pds:Citation_Information.pds:doi,pds:Citation_Information.pds:author_list,' +
    'pds:Citation_Information.pds:publication_year';
  const { body, retrieved } = await get(url);
  const p = JSON.parse(body).data?.[0]?.properties;
  const first = (k) => {
    const v = p?.[k]?.[0];
    // L'API rend la CHAÎNE « null » pour un champ absent (CLAUDE.md § Pièges).
    if (v === undefined || v === 'null')
      throw new Error(`paquet ${BUNDLE_LID} : ${k} absent`);
    return v;
  };
  return {
    lid: BUNDLE_LID,
    title: first('title'),
    authors: first('pds:Citation_Information.pds:author_list'),
    year: Number(
      first('pds:Citation_Information.pds:publication_year').slice(0, 4)
    ),
    doi: first('pds:Citation_Information.pds:doi'),
    retrieved,
  };
}

/** Les collections que le registre rattache à une planète. */
async function collectionsOf(body) {
  const url = `${SEARCH}/classes/collection?q=${encodeURIComponent(
    `ref_lid_target eq "urn:nasa:pds:context:target:planet.${body}"`
  )}&limit=2000&fields=lid`;
  const { body: text, retrieved } = await get(url);
  const d = JSON.parse(text);
  if (d.summary.hits > d.data.length)
    throw new Error(
      `${body} : ${d.summary.hits} collections, ${d.data.length} rendues`
    );
  return { lids: d.data.map((x) => x.id.split('::')[0]), retrieved };
}

// ── Titan : le profil mesuré par HASI, l'instrument de la sonde Huygens (2026-10-28) ──────────
const HASI_BUNDLE =
  'https://atmos.nmsu.edu/PDS/data/PDS4/Huygens/hphasi_bundle';
const HASI_LID = 'urn:nasa:pds:hp_hasi';
const HASI_COLLECTION = 'urn:nasa:pds:hp_hasi:data_raw';
const DTWG_BUNDLE =
  'https://atmos.nmsu.edu/PDS/data/PDS4/Huygens/hpdtwg_bundle';
const DTWG_LID = 'urn:nasa:pds:hp_dtwg';

/** Les cellules d'une table délimitée (point-virgule), guillemets retirés. */
function delimitedRows(table, width) {
  const rows = [];
  for (const line of table.split(/\r?\n/)) {
    const cells = line.split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length >= width) rows.push(cells);
  }
  return rows;
}

/** L'indice d'une colonne de l'étiquette, et son unité EXIGÉE : jamais supposée. */
function column(fields, product, name, unit) {
  const i = fields.findIndex((f) => f.name === name);
  if (i < 0)
    throw new Error(`${product} : colonne ${name} absente de l'étiquette`);
  if (unit !== undefined && fields[i].unit !== unit)
    throw new Error(`${product} : ${name} en ${fields[i].unit}, pas ${unit}`);
  return i;
}

/** Un produit de HASI : son étiquette (identifiant logique vérifié) et sa table. */
async function hasiProduct(directory, product) {
  const label = await get(
    `${HASI_BUNDLE}/DATA/${directory}/${product}.xml`,
    (b) =>
      /<logical_identifier>urn:nasa:pds:hp_hasi:[^<]*<\/logical_identifier>/.test(
        b
      )
        ? null
        : 'identifiant logique absent'
  );
  const table = await get(`${HASI_BUNDLE}/DATA/${directory}/${product}.TAB`);
  return {
    url: `${HASI_BUNDLE}/DATA/${directory}/${product}.TAB`,
    fields: fieldsOf(label.body),
    rows: delimitedRows(table.body, 3),
    start: /<start_date_time>([^<]+)</.exec(label.body)?.[1] ?? null,
    stop: /<stop_date_time>([^<]+)</.exec(label.body)?.[1] ?? null,
    retrieved: [label.retrieved, table.retrieved].sort().at(-1),
  };
}

/** Un segment de profil : altitude (km), pression (bar), température (K), de haut en bas. */
async function hasiSegment(kind, product) {
  const t = await hasiProduct('PROFILES', product);
  const alt = column(t.fields, product, 'Altitude', 'm');
  const pressure = column(t.fields, product, 'Pressure', 'Pa');
  const temperature = column(t.fields, product, 'Temperature', 'K');
  const samples = t.rows
    .map((r) => [
      Number(r[alt]) / 1000,
      Number(r[pressure]) / 1e5,
      Number(r[temperature]),
    ])
    .filter((r) => r.every(Number.isFinite))
    .map(([a, p, k]) => [a, Number(p.toPrecision(6)), k])
    .sort((a, b) => b[0] - a[0]);
  if (samples.length < 100)
    throw new Error(`${product} : ${samples.length} lignes seulement`);
  return {
    kind,
    product: `${HASI_COLLECTION}:${product.toLowerCase()}`,
    url: t.url,
    retrieved: t.retrieved,
    start: t.start,
    stop: t.stop,
    samples,
  };
}

/**
 * LE POINT DE SURFACE : la PREMIÈRE ligne à altitude 0 de la pression (PPI) et de la température
 * (TEM), les deux tables de la phase « surface » de HASI, avec la dispersion des lignes de cette
 * phase (la sonde y est restée plus d'une heure), écrite et non lissée.
 */
async function hasiSurface() {
  const ppi = await hasiProduct('PPI', 'HASI_L4_PPI_PRESSURE_VEL');
  const tem = await hasiProduct('TEM', 'HASI_L4_TEM_TEMPERATURE');
  const pName = 'HASI_L4_PPI_PRESSURE_VEL';
  const tName = 'HASI_L4_TEM_TEMPERATURE';
  const pAlt = column(ppi.fields, pName, 'Altitude', 'm');
  const pAmbient = column(ppi.fields, pName, 'Ambient pressure', 'Pa');
  const tAlt = column(tem.fields, tName, 'Altitude', 'm');
  const tTemp = column(tem.fields, tName, 'Temperature', 'K');
  const tSigma = column(tem.fields, tName, 'Temperature uncertainty', 'K');
  const ground = (t, alt) => t.rows.filter((r) => Number(r[alt]) === 0);
  const pRows = ground(ppi, pAlt);
  const tRows = ground(tem, tAlt);
  if (pRows.length === 0 || tRows.length === 0)
    throw new Error('HASI : aucune ligne à altitude 0');
  const pressures = pRows.map((r) => Number(r[pAmbient]));
  const temperatures = tRows.map((r) => Number(r[tTemp]));
  const range = (v) => [Math.min(...v), Math.max(...v)];
  return {
    altitudeKm: 0,
    pressureBar: Number((pressures[0] / 1e5).toPrecision(6)),
    pressureRangeBar: range(pressures).map((p) =>
      Number((p / 1e5).toPrecision(6))
    ),
    pressureSamples: pressures.length,
    temperatureK: temperatures[0],
    temperatureSigmaK: Number(tRows[0][tSigma]),
    temperatureRangeK: range(temperatures),
    temperatureSamples: temperatures.length,
    products: [
      {
        product: `${HASI_COLLECTION}:${pName.toLowerCase()}`,
        url: ppi.url,
        retrieved: ppi.retrieved,
      },
      {
        product: `${HASI_COLLECTION}:${tName.toLowerCase()}`,
        url: tem.url,
        retrieved: tem.retrieved,
      },
    ],
  };
}

/** La latitude de la sonde pendant la descente, dans la trajectoire reconstruite (paquet DTWG). */
async function dtwgLatitude() {
  const product = 'HUY_DTWG_DESCENT_POS';
  const label = await get(`${DTWG_BUNDLE}/DATA/${product}.xml`, (b) =>
    b.includes('urn:nasa:pds:hp_dtwg:data_derived:huy_dtwg_descent_pos')
      ? null
      : 'identifiant logique absent'
  );
  const table = await get(`${DTWG_BUNDLE}/DATA/${product}.TAB`);
  const fields = fieldsOf(label.body);
  const lat = fields.findIndex((f) => f.name === 'LAT');
  if (lat < 0) throw new Error(`${product} : colonne LAT absente`);
  const values = [];
  for (const line of table.body.split(/\r?\n/)) {
    const cells = line.trim().split(/\s+/);
    if (cells.length !== fields.length) continue;
    const v = Number(cells[lat]);
    if (Number.isFinite(v)) values.push(v);
  }
  if (values.length < 1000)
    throw new Error(`${product} : ${values.length} latitudes`);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    url: `${DTWG_BUNDLE}/DATA/${product}.TAB`,
    retrieved: [label.retrieved, table.retrieved].sort().at(-1),
  };
}

/** La citation d'un paquet PDS4 du registre : titre, auteurs, année, DOI. */
async function bundleCitationOf(lid) {
  const url =
    `${SEARCH}/classes/bundle?q=${encodeURIComponent(`lid eq "${lid}"`)}` +
    '&fields=lid,title,pds:Citation_Information.pds:doi,pds:Citation_Information.pds:author_list,' +
    'pds:Citation_Information.pds:publication_year';
  const { body, retrieved } = await get(url);
  const p = JSON.parse(body).data?.[0]?.properties;
  const first = (k) => {
    const v = p?.[k]?.[0];
    if (v === undefined || v === 'null')
      throw new Error(`paquet ${lid} : ${k} absent`);
    return v;
  };
  return {
    lid,
    title: first('title'),
    authors: first('pds:Citation_Information.pds:author_list'),
    year: Number(
      first('pds:Citation_Information.pds:publication_year').slice(0, 4)
    ),
    doi: first('pds:Citation_Information.pds:doi'),
    retrieved,
  };
}

async function titanProfile() {
  const bundle = await bundleCitationOf(HASI_LID);
  const trajectory = await bundleCitationOf(DTWG_LID);
  const refCat = await get(`${HASI_BUNDLE}/CATALOG/REFERENCE.CAT`);
  const refMatch =
    /REFERENCE_KEY_ID\s*=\s*"FULCHIGNONIETAL2005"\s*REFERENCE_DESC\s*=\s*"([^"]+)"/.exec(
      refCat.body
    );
  if (!refMatch)
    throw new Error('référence FULCHIGNONIETAL2005 absente de REFERENCE.CAT');
  const latitude = await dtwgLatitude();
  const segments = [
    await hasiSegment('entry', 'HASI_L4_ATMO_PROFILE_ENTRY'),
    await hasiSegment('descent', 'HASI_L4_ATMO_PROFILE_DESCEN'),
  ];
  const surface = await hasiSurface();
  return {
    $comment:
      'Écrit par `pnpm atmosphere:generate` depuis le paquet PDS4 de HASI, l’instrument de la sonde Huygens. Ne pas éditer à la main.',
    body: 'titan',
    instrument: 'Huygens Atmospheric Structure Instrument (HASI)',
    altitudeReference: 'surface',
    bundle,
    reference: {
      text: refMatch[1].replace(/\s+/g, ' ').trim(),
      retrieved: refCat.retrieved,
    },
    latitudeDeg: { min: latitude.min, max: latitude.max },
    latitudeSource: {
      lid: trajectory.lid,
      title: trajectory.title,
      doi: trajectory.doi,
      url: latitude.url,
      retrieved: latitude.retrieved,
    },
    segments,
    surface,
  };
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const giants = Object.entries(snapshot.nssdca.bodies)
  .filter(([, b]) => b.surfacePressure?.lowerBound === true)
  .map(([id]) => id)
  .sort();
if (giants.length !== 4)
  throw new Error(`${giants.length} géantes dans le relevé`);

const info = await get(`${BUNDLE}/data_asi/asiinfo.txt`);
if (!info.body.replace(/\s+/g, ' ').includes(ADIABAT_QUOTE))
  throw new Error(
    'la phrase de méthode de la descente est absente de asiinfo.txt'
  );
const entry = await asiTable('upperatm');
const descent = await asiTable('descent');
const citation = await bundleCitation();
// L'article que le jeu cite pour cette réduction, lu dans son catalogue de références (le PDS4
// n'en porte que la clé).
const refCat = await get(
  'https://atmos.nmsu.edu/PDS/data/gp_0001/catalog/REF.CAT'
);
const refMatch =
  /REFERENCE_KEY_ID\s*=\s*"SEIFFETAL1998"\s*REFERENCE_DESC\s*=\s*"([^"]+)"/.exec(
    refCat.body
  );
if (!refMatch) throw new Error('référence SEIFFETAL1998 absente de REF.CAT');
const reference = {
  text: refMatch[1].replace(/\s+/g, ' ').trim(),
  retrieved: refCat.retrieved,
};

const lat = entry.latitudes;
const profile = {
  $comment:
    'Écrit par `pnpm atmosphere:generate` depuis le paquet PDS4 de la sonde Galileo. Ne pas éditer à la main.',
  body: 'jupiter',
  instrument: 'Galileo Probe Atmospheric Structure Instrument (ASI)',
  bundle: citation,
  reference,
  latitudeDeg: { min: Math.min(...lat), max: Math.max(...lat) },
  segments: [
    {
      kind: 'entry',
      product: entry.product,
      url: entry.url,
      retrieved: entry.retrieved,
      start: entry.start,
      stop: entry.stop,
      samples: entry.samples,
    },
    {
      kind: 'descent',
      product: descent.product,
      url: descent.url,
      retrieved: descent.retrieved,
      start: descent.start,
      stop: descent.stop,
      method: ADIABAT_QUOTE,
      methodSource: info.retrieved,
      samples: descent.samples,
    },
  ],
};

const titan = await titanProfile();
// TÉMOIN de Titan : le registre rattache la collection de HASI à la cible. Une recherche muette
// ne prouverait rien sur l'absence d'un autre profil ; celle-ci doit répondre.
const titanRegistry = await (async () => {
  const url = `${SEARCH}/classes/collection?q=${encodeURIComponent(
    'ref_lid_target eq "urn:nasa:pds:context:target:satellite.saturn.titan"'
  )}&limit=2000&fields=lid`;
  const { body: text, retrieved } = await get(url);
  const d = JSON.parse(text);
  if (d.summary.hits > d.data.length)
    throw new Error(
      `titan : ${d.summary.hits} collections, ${d.data.length} rendues`
    );
  const lids = d.data.map((x) => x.id.split('::')[0]);
  if (!lids.includes(HASI_COLLECTION))
    throw new Error(
      `TÉMOIN : le registre ne rend pas ${HASI_COLLECTION} pour Titan`
    );
  return { collections: lids.length, retrieved };
})();
const witness = await collectionsOf('jupiter');
if (!witness.lids.includes(ASI_COLLECTION))
  throw new Error(
    `TÉMOIN : la recherche ne rend pas ${ASI_COLLECTION} pour Jupiter`
  );
const absent = {};
for (const giant of giants) {
  if (giant === 'jupiter') continue;
  const { lids, retrieved } = await collectionsOf(giant);
  absent[giant] = { collections: lids.length, retrieved };
}
const index = {
  $comment:
    'Écrit par `pnpm atmosphere:generate`. Les géantes sans profil : collections rattachées par le registre du PDS au jour de la lecture, aucune n’étant un profil de la basse atmosphère (lu le 2026-10-15). Un compte qui bouge se relit.',
  // La provenance que `/sources` publie (`src/seo/cardBlockSources.ts`), LUE et non recopiée :
  // le titre et le DOI viennent du registre, l'adresse est celle qui a servi les tables.
  providers: {
    jupiter: {
      publisher: 'NASA Planetary Data System, Atmospheres Node',
      title: citation.title,
      url: `${BUNDLE}/`,
      doi: citation.doi,
    },
    titan: {
      publisher: 'NASA Planetary Data System, Atmospheres Node',
      title: titan.bundle.title,
      url: `${HASI_BUNDLE}/`,
      doi: titan.bundle.doi,
    },
  },
  retrieved: [
    entry.retrieved,
    descent.retrieved,
    citation.retrieved,
    titan.bundle.retrieved,
    ...titan.segments.map((x) => x.retrieved),
    ...titan.surface.products.map((x) => x.retrieved),
    titan.latitudeSource.retrieved,
  ]
    .sort()
    .at(-1),
  profiles: {
    jupiter: { samples: entry.samples.length + descent.samples.length },
    titan: {
      samples: titan.segments.reduce((n, x) => n + x.samples.length, 0),
    },
  },
  titanRegistry,
  witness: {
    jupiter: ASI_COLLECTION,
    collections: witness.lids.length,
    retrieved: witness.retrieved,
  },
  absent,
};

const outFile = join(OUT_DIR, 'jupiter.json');
const write = [
  [outFile, `${JSON.stringify(profile, null, 1)}\n`],
  [join(OUT_DIR, 'titan.json'), `${JSON.stringify(titan, null, 1)}\n`],
  [INDEX, `${JSON.stringify(index, null, 2)}\n`],
];
if (check) {
  const drift = write.filter(
    ([f, text]) => !existsSync(f) || readFileSync(f, 'utf8') !== text
  );
  for (const [f] of drift) console.error(`dérive : ${f}`);
  process.exit(drift.length ? 1 : 0);
}
mkdirSync(OUT_DIR, { recursive: true });
for (const [f, text] of write) writeFileSync(f, text);
console.log(
  `titan : ${titan.segments.map((x) => x.samples.length).join(' + ')} échantillons, surface ${titan.surface.pressureBar} bar, ${titan.surface.temperatureK} K, latitude ${titan.latitudeDeg.min} à ${titan.latitudeDeg.max}°\n` +
    `jupiter : ${entry.samples.length} + ${descent.samples.length} échantillons, ` +
    `latitude ${profile.latitudeDeg.min} à ${profile.latitudeDeg.max}° ; sans profil : ${Object.keys(absent).join(', ')}`
);
