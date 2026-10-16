/* global console, fetch, process */
/**
 * LE RELIEF À 30 M DES MONTAGNES DE LA TERRE, TIRÉ UNE FOIS ET RÉDUIT À 5″ (lot 53, pas 3).
 *
 * Le Copernicus DEM GLO-30 (1″, ~30 m) n'a pas d'en-tête CORS : il se cuit hors ligne, comme
 * ETOPO. Mais il pèse ~30 à 45 Mo par degré carré en montagne, et la cuisson de la Terre réécrit
 * tout le jeu à chaque passage : ce tirage est donc SÉPARÉ et REPRENABLE (patron de
 * `places:pull`). Chaque degré est lu, réduit à 5″ par MOYENNE DE SURFACE (720 échantillons par
 * degré, l'anti-crénelage juste pour le niveau 9 de la grille de Sentinel-2, ~4,9″ par
 * échantillon), rangé en entiers 16 bits (mètres, altitude EGM2008 comme la source), puis
 * l'original est jeté. La cuisson lit ces fichiers, sans réseau.
 *
 * Pourquoi 5″ et pas 1″ : mesuré le 2026-10-16 sur trois degrés témoins, 5″ ne perd que 10 à
 * 13 m RMS contre 1″ (47 à 62 m pour les ~20″ livrés), pour ~12 Go de tuiles au lieu de ~196 ; le
 * détail se lit dans `docs/private/TERRE_LOT53.md`.
 *
 * LA LISTE DES DEGRÉS SE DÉRIVE du manifeste livré : les boîtes de montagne déjà cuites au niveau 7
 * sur la grille de Sentinel-2 (`public/assets/height-tiles/earth-trek/manifest.json`). Un degré
 * tout en mer n'existe pas dans GLO-30 (HTTP 404), et il est NOTÉ, pas réessayé.
 *
 * Licence lue à la source (dataspace.copernicus.eu, page COP-DEM, 2026-10-16) : libre pour le
 * grand public, mention obligatoire de la donnée modifiée (`GLO30_NOTICE`, affichée par le badge
 * du relief).
 *
 *   node scripts/pull-glo30.mjs [--plan] [--jobs 4] [--only N45E006]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFloatCog } from './cog-reader.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.cache', 'glo30-5s');
const MANIFEST = join(
  ROOT,
  'public/assets/height-tiles/earth-trek/manifest.json'
);
/** Échantillons par degré du fichier réduit : 5″. */
export const GLO30_REDUCED_PER_DEGREE = 720;
/** La valeur d'un échantillon sans donnée (mer, vide de la source). */
export const GLO30_NO_DATA = -32768;
export const GLO30_NOTICE =
  'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

/** Nom d'un degré par son coin SUD-OUEST, comme les tuiles de GLO-30 (N45E006). */
export const cellName = (south, west) =>
  `${south >= 0 ? 'N' : 'S'}${String(Math.abs(south)).padStart(2, '0')}` +
  `${west >= 0 ? 'E' : 'W'}${String(Math.abs(west)).padStart(3, '0')}`;

const sourceUrl = (south, west) => {
  const lat = `${south >= 0 ? 'N' : 'S'}${String(Math.abs(south)).padStart(2, '0')}_00`;
  const lon = `${west >= 0 ? 'E' : 'W'}${String(Math.abs(west)).padStart(3, '0')}_00`;
  const name = `Copernicus_DSM_COG_10_${lat}_${lon}_DEM`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
};

/** Les degrés à tirer : ceux que touchent les boîtes de montagne du manifeste livré. */
export function plannedCells(manifest) {
  const cells = new Map();
  for (const entry of manifest.coverage ?? []) {
    if (!entry.bounds || !entry.levels?.includes(7)) continue;
    const b = entry.bounds;
    for (let s = Math.floor(b.south); s < Math.ceil(b.north); s += 1)
      for (let w = Math.floor(b.west); w < Math.ceil(b.east); w += 1)
        cells.set(cellName(s, w), [s, w]);
  }
  return [...cells.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Réduit un degré de GLO-30 à 720 × 720 échantillons par moyenne de surface. Les échantillons de
 * la source sont rattachés au point (`pixelIsPoint`) ; chaque case de 5″ prend la moyenne de ceux
 * dont le centre y tombe. Une case sans aucune valeur valide vaut `GLO30_NO_DATA`.
 */
export function reduceCell(cog, south, west) {
  const n = GLO30_REDUCED_PER_DEGREE;
  const sum = new Float64Array(n * n);
  const count = new Uint32Array(n * n);
  const half = cog.pixelIsPoint ? 0 : 0.5;
  for (let y = 0; y < cog.height; y += 1) {
    const lat = cog.northDeg - (y + half) * cog.stepLatDeg;
    const row = Math.floor((south + 1 - lat) * n);
    if (row < 0 || row >= n) continue;
    for (let x = 0; x < cog.width; x += 1) {
      const lon = cog.westDeg + (x + half) * cog.stepLonDeg;
      const column = Math.floor((lon - west) * n);
      if (column < 0 || column >= n) continue;
      const v = cog.values[y * cog.width + x];
      if (!Number.isFinite(v) || v === cog.noData || v < -1000) continue;
      sum[row * n + column] += v;
      count[row * n + column] += 1;
    }
  }
  const out = new Int16Array(n * n);
  for (let i = 0; i < n * n; i += 1)
    out[i] = count[i] > 0 ? Math.round(sum[i] / count[i]) : GLO30_NO_DATA;
  return out;
}

async function pullCell(name, south, west) {
  const path = join(OUT, `${name}.i16`);
  if (existsSync(path)) return 'cached';
  const url = sourceUrl(south, west);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return 'absent';
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const reduced = reduceCell(readFloatCog(bytes, name), south, west);
      writeFileSync(path, Buffer.from(reduced.buffer));
      return 'pulled';
    } catch (error) {
      if (attempt === 4) throw new Error(`${name} : ${String(error)}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  return 'failed';
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  let cells = plannedCells(manifest);
  const only = value('--only');
  if (only) cells = cells.filter(([name]) => name === only);
  mkdirSync(OUT, { recursive: true });
  const absentPath = join(OUT, 'absent.json');
  const absent = new Set(
    existsSync(absentPath) ? JSON.parse(readFileSync(absentPath, 'utf8')) : []
  );
  const todo = cells.filter(
    ([name]) => !absent.has(name) && !existsSync(join(OUT, `${name}.i16`))
  );
  console.log(
    `${cells.length} degrés prévus, ${cells.length - todo.length} déjà tirés ou absents, ${todo.length} à tirer`
  );
  if (flag('--plan')) return;
  const jobs = Number(value('--jobs', '4'));
  let done = 0;
  let next = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < todo.length) {
      const [name, [south, west]] = todo[next++];
      const outcome = await pullCell(name, south, west);
      if (outcome === 'absent') {
        absent.add(name);
        writeFileSync(absentPath, JSON.stringify([...absent].sort()));
      }
      done += 1;
      if (done % 25 === 0 || done === todo.length) {
        const rate = done / ((Date.now() - started) / 3_600_000);
        console.log(
          `${new Date().toISOString()} ${done}/${todo.length} (${absent.size} absents), ${rate.toFixed(0)} degrés/h`
        );
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  console.log('tirage terminé');
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
