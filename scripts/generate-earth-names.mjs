/* global console, fetch, process */
/**
 * LES NOMS DE LA TERRE (lot 53, pas 1), lus dans Natural Earth.
 *
 * L'UAI ne nomme pas la Terre : le gazetteer du lot 37 donne leurs formations à 44 corps et
 * AUCUNE à la Terre, seul corps majeur sans un nom affiché. Natural Earth publie, en domaine
 * public (« No permission is needed to use Natural Earth. Crediting the authors is
 * unnecessary. », naturalearthdata.com/about/terms-of-use), les océans et mers, les chaînes,
 * déserts et plateaux, les sommets et les lieux habités, avec leurs noms traduits depuis Wikidata
 * (CC0) et, surtout, le NIVEAU DE ZOOM auquel chaque nom doit paraître sur une carte web
 * (`MIN_ZOOM`, `min_zoom`, `min_label`, et `max_label` pour un nom trop grand vu de près). La
 * règle d'affichage est donc celle de la source (`src/core/earthNames.ts`), jamais une taille
 * inventée pour une ville.
 *
 * La version est ÉPINGLÉE (étiquette `v5.1.2` du dépôt de Natural Earth) : lire `master`
 * changerait le fichier livré sans que personne l'ait décidé.
 *
 * Écrit `public/assets/earth-names/earth.json` (servi à l'approche de la Terre seulement) et
 * `src/config/earthNamesIndex.json` (provenance et comptes, hors démarrage).
 *
 *   node scripts/generate-earth-names.mjs [--offline] [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheKey, stampNow, stampOf } from './fact-source-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'earth-names');
const OUT_NAMES = join(ROOT, 'public', 'assets', 'earth-names', 'earth.json');
const OUT_INDEX = join(ROOT, 'src', 'config', 'earthNamesIndex.json');
const offline = process.argv.includes('--offline');
const check = process.argv.includes('--check');

const RELEASE = 'v5.1.2';
const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${RELEASE}/geojson`;

/**
 * Les couches lues, et où chacune range son nom, ses traductions et son niveau de zoom. Les
 * MAJUSCULES des lieux habités et des régions sont celles de la source, pas un choix.
 */
const LAYERS = [
  {
    file: 'ne_10m_geography_marine_polys',
    en: ['name_en', 'name'],
    minZoom: 'min_label',
    maxZoom: 'max_label',
    kind: 'featurecla',
  },
  {
    file: 'ne_10m_geography_regions_polys',
    en: ['NAME_EN', 'name_en', 'NAME', 'name'],
    minZoom: 'MIN_LABEL',
    maxZoom: 'MAX_LABEL',
    kind: 'FEATURECLA',
  },
  {
    file: 'ne_10m_geography_regions_elevation_points',
    en: ['name_en', 'name'],
    minZoom: 'min_zoom',
    kind: 'featurecla',
  },
  {
    file: 'ne_10m_populated_places',
    en: ['NAME_EN', 'NAME'],
    minZoom: 'MIN_ZOOM',
    kind: 'FEATURECLA',
  },
];

/** Les langues livrées hors anglais, et le champ de Natural Earth qui les porte. */
const TRANSLATIONS = { fr: 'fr', es: 'es', pt: 'pt' };

async function readLayer(file) {
  const url = `${BASE}/${file}.geojson`;
  const path = join(CACHE, `${cacheKey(url)}.geojson`);
  if (existsSync(path))
    return { url, text: readFileSync(path, 'utf8'), retrieved: stampOf(path) };
  if (offline) throw new Error(`hors ligne et absent du cache : ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  const text = await res.text();
  // Un fichier de couche est un FeatureCollection : une page d'erreur servie en 200 serait
  // écrite au cache comme une réponse valide, et y resterait (piège du NSSDCA, § « Pièges »).
  if (!text.includes('"FeatureCollection"'))
    throw new Error(`${url} : la réponse n'est pas une FeatureCollection`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, text);
  return { url, text, retrieved: stampNow(path) };
}

const pick = (props, keys) => {
  for (const key of keys) {
    const value = props[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
};

/** Majuscules de la source (« HIMALAYAS ») ramenées à la casse d'un nom, mot par mot. */
const titleCase = (s) =>
  s === s.toUpperCase() && /[A-Z]/.test(s)
    ? s
        .toLowerCase()
        .replace(/(^|[\s\-'(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
    : s;

/** Aire signée d'un anneau en degrés carrés (formule du lacet). */
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t =
    dx || dy
      ? Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
        )
      : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance signée d'un point au bord d'un polygone (positive dedans). */
function signedDistance(p, polygon) {
  let inside = false;
  let min = Infinity;
  for (const ring of polygon) {
    if (pointInRing(p, ring)) inside = !inside;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
      min = Math.min(min, segmentDistance(p, ring[i], ring[j]));
  }
  return inside ? min : -min;
}

/**
 * Le point d'étiquette d'un polygone : le point intérieur le plus éloigné de son bord (pôle
 * d'inaccessibilité), par grille raffinée. Le centroïde ne convient pas : celui d'un golfe en
 * croissant tombe à terre, et le nom se poserait sur la côte d'en face.
 */
function labelPoint(polygon) {
  const outer = polygon[0];
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  let best = { p: [(minX + maxX) / 2, (minY + maxY) / 2], d: -Infinity };
  let cell = Math.max(maxX - minX, maxY - minY) / 16;
  let cx = (minX + maxX) / 2;
  let cy = (minY + maxY) / 2;
  let span = Math.max(maxX - minX, maxY - minY) / 2;
  for (let round = 0; round < 6; round += 1) {
    for (let x = cx - span; x <= cx + span; x += cell)
      for (let y = cy - span; y <= cy + span; y += cell) {
        const d = signedDistance([x, y], polygon);
        if (d > best.d) best = { p: [x, y], d };
      }
    [cx, cy] = best.p;
    span = cell * 2;
    cell /= 4;
  }
  return best.d > 0 ? best.p : null;
}

function anchor(geometry) {
  if (geometry.type === 'Point') return geometry.coordinates;
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  // Le plus grand morceau porte le nom : celui d'un archipel se pose sur sa plus grande île.
  const largest = polygons.reduce(
    (a, b) => (Math.abs(ringArea(b[0])) > Math.abs(ringArea(a[0])) ? b : a),
    polygons[0]
  );
  return largest ? labelPoint(largest) : null;
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;

const names = [];
const layers = {};
const dates = [];
const dropped = [];
for (const layer of LAYERS) {
  const { text, retrieved } = await readLayer(layer.file);
  dates.push(retrieved);
  const collection = JSON.parse(text);
  let kept = 0;
  for (const feature of collection.features) {
    const p = feature.properties;
    const en = pick(p, layer.en);
    const minZoom = Number(p[layer.minZoom]);
    if (!en || !Number.isFinite(minZoom)) {
      dropped.push(
        `${layer.file} : ${en ?? '(sans nom)'} sans ${layer.minZoom}`
      );
      continue;
    }
    const at = anchor(feature.geometry);
    if (!at) {
      dropped.push(`${layer.file} : ${en} sans point intérieur`);
      continue;
    }
    const entry = {
      name: titleCase(en),
      kind: String(p[layer.kind] ?? '').toLowerCase(),
      lat: round4(at[1]),
      lon: round4(at[0]),
      minZoom,
    };
    const maxZoom = layer.maxZoom ? Number(p[layer.maxZoom]) : NaN;
    if (Number.isFinite(maxZoom)) entry.maxZoom = maxZoom;
    const translated = {};
    for (const [locale, suffix] of Object.entries(TRANSLATIONS)) {
      const value = pick(p, [`name_${suffix}`, `NAME_${suffix.toUpperCase()}`]);
      if (value && titleCase(value) !== entry.name)
        translated[locale] = titleCase(value);
    }
    if (Object.keys(translated).length > 0) entry.names = translated;
    names.push(entry);
    kept += 1;
  }
  layers[layer.file] = kept;
}

// Les plus importants d'abord : la couche tronque à son plafond, et c'est l'ordre qui décide.
names.sort(
  (a, b) => a.minZoom - b.minZoom || a.name.localeCompare(b.name, 'en')
);

const sortedDates = [...new Set(dates)].sort();
const index = {
  provider: {
    publisher: 'Natural Earth',
    title: `Natural Earth 1:10m vectors, ${RELEASE}`,
    url: 'https://www.naturalearthdata.com/',
    source: `https://github.com/nvkelso/natural-earth-vector/tree/${RELEASE}/geojson`,
    rights: 'public-domain',
    rightsStatedAt: 'https://www.naturalearthdata.com/about/terms-of-use/',
    rightsQuote:
      'All versions of Natural Earth raster + vector map data found on this website are in the public domain.',
    translations:
      'Noms traduits par Natural Earth depuis Wikidata (CC0). Le portugais est celui de Wikidata (`pt`), sans variante brésilienne.',
    accessed:
      sortedDates.length === 1
        ? sortedDates[0]
        : `${sortedDates[0]} → ${sortedDates.at(-1)}`,
  },
  count: names.length,
  layers,
};

const namesText = `${JSON.stringify(names)}\n`;
const indexText = `${JSON.stringify(index, null, 2)}\n`;
if (check) {
  const drift = [
    [OUT_NAMES, namesText],
    [OUT_INDEX, indexText],
  ].filter(
    ([path, text]) => !existsSync(path) || readFileSync(path, 'utf8') !== text
  );
  if (drift.length > 0) {
    console.error(`dérive : ${drift.map(([p]) => p).join(', ')}`);
    process.exit(1);
  }
  console.log(`noms de la Terre à jour : ${names.length}`);
} else {
  mkdirSync(dirname(OUT_NAMES), { recursive: true });
  writeFileSync(OUT_NAMES, namesText);
  writeFileSync(OUT_INDEX, indexText);
  console.log(
    `${names.length} noms écrits (${Object.entries(layers)
      .map(([f, n]) => `${f} ${n}`)
      .join(', ')}), ${namesText.length} octets ; écartés : ${dropped.length}`
  );
  for (const d of dropped.slice(0, 10)) console.log(`  ${d}`);
}
