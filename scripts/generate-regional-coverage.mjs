/* global console, fetch, process */
/**
 * OÙ UNE IMAGERIE RÉGIONALE PEUT REMPLACER SENTINEL-2 (lot 53, pas 4).
 *
 * Une imagerie nationale (l'orthophoto de l'IGN, 20 cm) est bien plus fine que Sentinel-2
 * (~10 m), mais elle ne couvre que son pays, et hors de lui elle rend du BLANC opaque à fort
 * grossissement (mesuré à Berne et Genève le 2026-10-16). Une tuile à cheval sur la frontière
 * serait donc à moitié blanche. La règle, MESURÉE : une boîte de la grille de Sentinel-2 est
 * retenue si son centre est dans le pays et si elle ne touche AUCUN AUTRE pays, marge comprise.
 * La mer n'est pas exclue : sur la côte, l'IGN couvre aussi la mer proche (le Vieux-Port de
 * Marseille et plusieurs kilomètres au large, lu en image), et c'est le large seul qui est blanc ;
 * au niveau de boîte 12 (~4,4 km), une boîte retenue ne déborde que de ~2 km en mer. Une première
 * version exigeait la boîte entièrement à terre au niveau 10 : elle ôtait tout le littoral.
 *
 * La frontière se LIT dans Natural Earth admin-0 1:10m (domaine public, version épinglée), les
 * régions et leur pays dans `scripts/regional-imagery-targets.json`. Écrit
 * `src/config/regionalCoverage.json`, des plages de colonnes par ligne au niveau de boîte.
 *
 *   node scripts/generate-regional-coverage.mjs [--offline] [--check]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampNow, stampOf } from './fact-source-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = JSON.parse(
  readFileSync(join(ROOT, 'scripts/regional-imagery-targets.json'), 'utf8')
);
const OUT = join(ROOT, 'src/config/regionalCoverage.json');
const CACHE = join(ROOT, '.cache', 'regional-coverage');
const offline = process.argv.includes('--offline');
const check = process.argv.includes('--check');

/** Grille de Sentinel-2 d'EOX : WGS84, 2 colonnes et 1 ligne au niveau 0 (lue dans ses fiches). */
const COLUMNS_AT_ZERO = 2;
const ROWS_AT_ZERO = 1;

async function readBoundaries() {
  const url = TARGETS.naturalEarth;
  const path = join(
    CACHE,
    `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.geojson`
  );
  if (existsSync(path))
    return { text: readFileSync(path, 'utf8'), retrieved: stampOf(path) };
  if (offline) throw new Error(`hors ligne et absent du cache : ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('"FeatureCollection"'))
    throw new Error(`${url} : la réponse n'est pas une FeatureCollection`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, text);
  return { text, retrieved: stampNow(path) };
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Dans un polygone (anneau extérieur moins ses trous). */
function pointInPolygon(x, y, polygon) {
  if (!pointInRing(x, y, polygon[0])) return false;
  for (let k = 1; k < polygon.length; k += 1)
    if (pointInRing(x, y, polygon[k])) return false;
  return true;
}

/** Un segment coupe-t-il un rectangle (bords compris) ? Découpage de Liang-Barsky. */
function segmentHitsBox([x0, y0], [x1, y1], w, s, e, n) {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [
    [-dx, x0 - w],
    [dx, e - x0],
    [-dy, y0 - s],
    [dy, n - y0],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Emprise d'un polygone, calculée une fois. */
function extentOf(polygon) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of polygon[0]) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return { w, s, e, n };
}

/** La boîte touche-t-elle ce polygone (un bord la traverse, ou elle est dedans) ? */
function boxTouches(entry, w, s, e, n) {
  const x = entry.extent;
  if (x.e < w || x.w > e || x.n < s || x.s > n) return false;
  if (pointInPolygon((w + e) / 2, (s + n) / 2, entry.polygon)) return true;
  for (const ring of entry.polygon)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
      if (segmentHitsBox(ring[j], ring[i], w, s, e, n)) return true;
  return false;
}

const { text, retrieved } = await readBoundaries();
const countries = JSON.parse(text).features;
const asEntries = (feature) => {
  const g = feature.geometry;
  return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(
    (polygon) => ({
      polygon,
      extent: extentOf(polygon),
    })
  );
};
const level = TARGETS.boxLevel;
const columns = COLUMNS_AT_ZERO * 2 ** level;
const rows = ROWS_AT_ZERO * 2 ** level;
const step = 360 / columns;
const out = {
  generatedBy: 'scripts/generate-regional-coverage.mjs',
  boundaries: TARGETS.naturalEarth,
  retrieved,
  boxLevel: level,
  // Le côté d'une boîte en degrés : la couverture se lit sans grille (core/regionalImagery.ts).
  boxDeg: step,
  marginKm: TARGETS.marginKm,
  regions: {},
};
for (const region of TARGETS.regions) {
  const polygons = [];
  for (const code of region.countries) {
    const feature = countries.find((f) => f.properties.ADM0_A3 === code);
    if (!feature) throw new Error(`pays ${code} absent de Natural Earth`);
    polygons.push(...asEntries(feature).map((entry) => entry.polygon));
  }
  const foreign = countries
    .filter((f) => !region.countries.includes(f.properties.ADM0_A3))
    .flatMap(asEntries);
  const runs = {};
  let boxes = 0;
  for (const polygon of polygons) {
    let [w0, s0, e0, n0] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of polygon[0]) {
      w0 = Math.min(w0, x);
      e0 = Math.max(e0, x);
      s0 = Math.min(s0, y);
      n0 = Math.max(n0, y);
    }
    const r0 = Math.max(0, Math.floor((90 - n0) / step));
    const r1 = Math.min(rows - 1, Math.floor((90 - s0) / step));
    const c0 = Math.max(0, Math.floor((w0 + 180) / step));
    const c1 = Math.min(columns - 1, Math.floor((e0 + 180) / step));
    for (let r = r0; r <= r1; r += 1) {
      const n = 90 - r * step;
      const s = n - step;
      const marginLat = TARGETS.marginKm / 111.32;
      const marginLon =
        marginLat / Math.max(0.05, Math.cos(((n + s) / 2) * (Math.PI / 180)));
      for (let c = c0; c <= c1; c += 1) {
        const w = -180 + c * step;
        const cx = w + step / 2;
        const cy = (n + s) / 2;
        if (!polygons.some((polygon) => pointInPolygon(cx, cy, polygon)))
          continue;
        const [bw, bs, be, bn] = [
          w - marginLon,
          s - marginLat,
          w + step + marginLon,
          n + marginLat,
        ];
        if (foreign.some((entry) => boxTouches(entry, bw, bs, be, bn)))
          continue;
        (runs[r] ??= new Set()).add(c);
      }
    }
  }
  // Des plages de colonnes contiguës par ligne : la forme compacte que lit l'application.
  const packed = {};
  for (const [r, set] of Object.entries(runs)) {
    const cols = [...set].sort((a, b) => a - b);
    const ranges = [];
    for (const c of cols) {
      const last = ranges.at(-1);
      if (last && c === last[1] + 1) last[1] = c;
      else ranges.push([c, c]);
    }
    packed[r] = ranges;
    boxes += cols.length;
  }
  out.regions[region.tileset] = {
    countries: region.countries,
    boxes,
    rows: packed,
  };
  console.log(
    `${region.tileset} (${region.countries.join(', ')}) : ${boxes} boîtes de niveau ${level}`
  );
}

const textOut = `${JSON.stringify(out)}\n`;
if (check) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== textOut) {
    console.error(`dérive : ${OUT}`);
    process.exit(1);
  }
  console.log('couverture régionale à jour');
} else {
  writeFileSync(OUT, textOut);
  console.log(`écrit ${OUT} : ${textOut.length} octets`);
}
