/* global console, fetch, process */
/**
 * LES ÉDITIONS ANNUELLES DE SENTINEL-2 SANS NUAGES (lot 50, 2026-10-15), lues chez EOX.
 *
 * EOX publie une mosaïque par ANNÉE, chacune sa couche WMTS (`s2cloudless` pour 2016, puis
 * `s2cloudless-AAAA`). Chaque édition a sa licence ET son attribution exigée, et elles changent
 * selon l'année : 2016 est en CC BY 4.0, 2018 à 2025 en CC BY-NC-SA 4.0. Une fiche par édition,
 * donc, et aucune n'est écrite à la main : ce script lit DEUX documents d'EOX et les croise.
 *
 * - les CAPACITÉS WMTS donnent les couches servies, leur gabarit et leur grille ;
 * - la PAGE DE LICENCE donne, année par année, la licence et l'attribution EXIGÉE. C'est elle qui
 *   fait foi, puisqu'elle dit ce que l'application doit afficher.
 *
 * DEUX DÉSACCORDS MESURÉS le 2026-10-15, et c'est pourquoi le croisement est nécessaire :
 * la couche 2017 est servie (CC BY 4.0 selon ses capacités) mais la page de licence ne la nomme
 * pas, donc elle est ÉCARTÉE avec sa raison ; et l'attribution exigée de 2016 dit « data 2016 &
 * 2017 » là où les capacités disent « data 2016 ». Les années de données viennent de la page de
 * licence, et le désaccord est écrit dans `src/config/eoxEditions.json`.
 *
 * Écrit `src/registry/products/tilesets/earth-eox-s2cloudless-AAAA.json` (une par édition),
 * `src/config/eoxEditions.json` (éditions, écartées, désaccords, dates de lecture) et
 * `src/config/eoxEditionYears.json` (les seules années, pour le réglage du rideau).
 * `--offline` (cache `.cache/eox-editions/`), `--check` (code 1 si un fichier a dérivé).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { cacheKey, stampNow, stampOf } from './fact-source-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'eox-editions');
const TILESETS = join(ROOT, 'src/registry/products/tilesets');
const RECORD = join(ROOT, 'src/config/eoxEditions.json');
/**
 * Les seules années, pour le réglage du rideau (lot 50, pas 2) : il vit au démarrage et ne lit
 * pas les fiches, et le relevé entier y pèserait ses phrases de désaccord pour rien.
 */
const YEARS = join(ROOT, 'src/config/eoxEditionYears.json');
const CAPABILITIES =
  'https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml';
const LICENCE = 'https://cloudless.eox.at/license-non-commercial';
const PRODUCT_LIST = 'https://cloudless.eox.at/documentation/product-list';
/** La grille d'EOX en EPSG:4326, celle de la fiche 2024 du lot 48 (mesurée alors). */
const MATRIX_SET = 'WGS84';
/**
 * Niveaux 5 à 13 : 13 est le dernier que la liste des produits d'EOX publie pour EPSG:4326
 * (« zoom levels 0–13 »), au-delà le service ne fait qu'agrandir ; 5 est celui de la fiche 2024
 * du lot 48. Les mêmes pour toutes les éditions : mesuré le 2026-10-15, chaque année répond 200
 * aux niveaux 0, 5, 13 et 14, avec `Access-Control-Allow-Origin: *`.
 */
const MIN_LEVEL = 5;
const MAX_LEVEL = 13;
/** 10 m par pixel publiés (liste des produits), soit 111 320 m par degré / 10. */
const PUBLISHED_PIXELS_PER_DEGREE = 11132;

const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
const CHECK = argv.includes('--check');

/** Une réponse, depuis le cache ou le réseau, avec sa date de lecture (`fact-source-cache`). */
async function read(url) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${cacheKey(url)}.txt`);
  if (existsSync(path))
    return { text: readFileSync(path, 'utf8'), retrieved: stampOf(path) };
  if (OFFLINE) throw new Error(`hors ligne et absent du cache : ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
  const text = await response.text();
  writeFileSync(path, text);
  return { text, retrieved: stampNow(path) };
}

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** Le texte d'une page HTML, une espace entre deux balises. */
const pageText = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[\u200b\u00a0]/g, ' ')
    .replace(/\s+/g, ' ');

/** Les années de données que nomme une attribution : « data 2017 & 2018 » → [2017, 2018]. */
function dataYears(attribution) {
  const match = /Copernicus Sentinel data (\d{4})(?: & (\d{4}))?\)/.exec(
    attribution
  );
  if (!match) throw new Error(`années de données illisibles : ${attribution}`);
  return match.slice(1).filter(Boolean).map(Number);
}

// ───────────────────────────── les capacités ─────────────────────────────

const capabilities = await read(CAPABILITIES);
const served = [];
for (const [, layer] of capabilities.text.matchAll(
  /<Layer>([\s\S]*?)<\/Layer>/g
)) {
  const id = /<ows:Identifier>([^<]*)/.exec(layer)?.[1];
  if (!id || !/^s2cloudless(-\d{4})?$/.test(id)) continue;
  const title = /<ows:Title>([^<]*)/.exec(layer)[1];
  const year = Number(/layer for (\d{4}) by EOX/.exec(title)?.[1]);
  if (!year) throw new Error(`année illisible dans le titre de ${id}`);
  const sets = [...layer.matchAll(/<TileMatrixSet>([^<]*)/g)].map((m) => m[1]);
  if (!sets.includes(MATRIX_SET))
    throw new Error(`${id} ne sert pas la grille ${MATRIX_SET}`);
  const formats = [...layer.matchAll(/<Format>([^<]*)/g)].map((m) => m[1]);
  if (!formats.includes('image/jpeg'))
    throw new Error(`${id} ne sert pas de JPEG`);
  const template = /template="([^"]*\.jpg)"/.exec(layer)?.[1];
  if (!template) throw new Error(`${id} sans gabarit JPEG`);
  const abstract = decode(
    /<ows:Abstract>([\s\S]*?)<\/ows:Abstract>/.exec(layer)[1]
  );
  served.push({
    id,
    year,
    // Les capacités écrivent `http:` ; le même hôte sert en `https:`, la seule forme que la CSP
    // et le schéma admettent.
    template: template.replace(/^http:/, 'https:'),
    attribution: /^(EOxCloudless[^)]*\))/.exec(abstract)?.[1] ?? null,
  });
}
if (served.length === 0) throw new Error('aucune couche s2cloudless servie');

// ─────────────────────────── la page de licence ───────────────────────────

const licence = await read(LICENCE);
const text = pageText(licence.text);
const LICENCES = [
  [
    'CC-BY-NC-SA-4.0',
    'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0)',
  ],
  [
    'CC-BY-4.0',
    'Creative Commons Attribution 4.0 International License (CC BY 4.0)',
  ],
];
const starts = LICENCES.map(([spdx, heading]) => {
  const at = text.indexOf(heading);
  if (at < 0) throw new Error(`section de licence absente : ${heading}`);
  return { spdx, at };
}).sort((a, b) => a.at - b.at);
const end = text.indexOf('Direct Integration');
if (end < 0) throw new Error('fin des sections de licence introuvable');
const licensed = new Map();
starts.forEach(({ spdx, at }, i) => {
  const section = text.slice(at, starts[i + 1]?.at ?? end);
  for (const [, year, attribution] of section.matchAll(
    /(\d{4}) ["“](EOxCloudless[^"”]+)["”]/g
  )) {
    if (licensed.has(Number(year)))
      throw new Error(`${year} nommée deux fois sur la page de licence`);
    licensed.set(Number(year), { spdx, attribution });
  }
});
if (licensed.size === 0) throw new Error('aucune attribution lue');

// ─────────────────────────────── le croisement ───────────────────────────────

const editions = [];
const excluded = [];
const disagreements = [];
for (const layer of served.sort((a, b) => a.year - b.year)) {
  const terms = licensed.get(layer.year);
  if (!terms) {
    excluded.push({
      layer: layer.id,
      year: layer.year,
      reason: 'licence-page-silent',
    });
    continue;
  }
  if (layer.attribution !== terms.attribution)
    disagreements.push({
      year: layer.year,
      capabilities: layer.attribution,
      licence: terms.attribution,
    });
  editions.push({ ...layer, ...terms, years: dataYears(terms.attribution) });
}
for (const year of licensed.keys())
  if (!served.some((layer) => layer.year === year))
    throw new Error(`${year} a une licence mais aucune couche servie`);

const verified = [capabilities.retrieved, licence.retrieved].sort().at(-1);
const fiche = (edition) => ({
  $schema: '../../schema/product.schema.json',
  id: `earth-eox-s2cloudless-${edition.year}`,
  type: 'tileset',
  body: 'earth',
  title: `EOxCloudless Sentinel-2 cloudless ${edition.year} (${edition.id})`,
  providerId: 'eox-cloudless',
  variant: 'sentinel-2',
  edition: edition.year,
  mission: 'Copernicus Sentinel-2',
  instrument: 'MSI',
  service: {
    template: edition.template,
    style: 'default',
    tileMatrixSet: MATRIX_SET,
    format: 'image/jpeg',
    matrix: { columnsAtLevelZero: 2, rowsAtLevelZero: 1, tileSizePx: 256 },
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
  },
  publishedPixelsPerDegree: PUBLISHED_PIXELS_PER_DEGREE,
  acquired: {
    interval: [
      [
        `${edition.years[0]}-01-01T00:00:00Z`,
        `${edition.years.at(-1)}-12-31T23:59:59Z`,
      ],
    ],
  },
  license: edition.spdx,
  links: [
    { rel: 'license', href: LICENCE },
    { rel: 'describedby', href: CAPABILITIES },
    { rel: 'via', href: PRODUCT_LIST },
  ],
  providers: [
    {
      name: edition.attribution,
      roles: ['producer', 'licensor', 'host'],
      url: 'https://cloudless.eox.at/',
    },
  ],
  verified,
});

const outputs = new Map();
const json = async (value) => format(JSON.stringify(value), { parser: 'json' });
for (const edition of editions)
  outputs.set(
    join(TILESETS, `earth-eox-s2cloudless-${edition.year}.json`),
    await json(fiche(edition))
  );
outputs.set(
  RECORD,
  await json({
    source: { capabilities: CAPABILITIES, licence: LICENCE },
    retrieved: {
      capabilities: capabilities.retrieved,
      licence: licence.retrieved,
    },
    editions: editions.map((e) => e.year),
    excluded,
    disagreements,
  })
);

outputs.set(YEARS, await json(editions.map((e) => e.year)));

// Une édition retirée chez EOX ne doit pas laisser sa fiche derrière elle.
const stale = readdirSync(TILESETS)
  .filter((name) => /^earth-eox-s2cloudless-\d{4}\.json$/.test(name))
  .map((name) => join(TILESETS, name))
  .filter((path) => !outputs.has(path));

if (CHECK) {
  const drift = [
    ...[...outputs].filter(
      ([path, content]) =>
        !existsSync(path) || readFileSync(path, 'utf8') !== content
    ),
    ...stale.map((path) => [path]),
  ].map(([path]) => path.slice(ROOT.length + 1));
  if (drift.length) {
    console.error(`dérive : ${drift.join(', ')}`);
    process.exit(1);
  }
  console.log(`${editions.length} éditions à jour`);
} else {
  for (const [path, content] of outputs) writeFileSync(path, content);
  if (stale.length)
    throw new Error(
      `fiches sans édition servie, à retirer à la main : ${stale.join(', ')}`
    );
  console.log(
    `${editions.length} éditions (${editions.map((e) => e.year).join(', ')}), ` +
      `${excluded.length} écartée(s), ${disagreements.length} désaccord(s)`
  );
}
