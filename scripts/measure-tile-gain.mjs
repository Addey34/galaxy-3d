#!/usr/bin/env node
/* global console, process, fetch, Buffer */
/**
 * LE GAIN DE LUMINOSITÉ DE CHAQUE MOSAÏQUE STREAMÉE, MESURÉ SUR ELLE (2026-10-30).
 *
 *   node scripts/measure-tile-gain.mjs           relevé imprimé, rien d'écrit
 *   node scripts/measure-tile-gain.mjs --write   écrit src/config/tileGain.json
 *   node scripts/measure-tile-gain.mjs --only mercury,moon
 *
 * Le gain d'affichage d'un corps (`displayAlbedo.json`) est calibré sur SA TEXTURE LIVRÉE. Un
 * carreau streamé est une autre image, avec sa propre luminosité : lui appliquer le gain de la
 * base le laissait 3 fois plus sombre sur Mercure (moyenne 72 contre 131 sur 255 pour la base),
 * et un îlot de carreaux s'y détachait en rectangles sombres sur la texture livrée. Même règle
 * que pour la base (`core/displayAlbedo.ts`, luminance linéaire moyenne = 0,5 × albédo publié),
 * appliquée cette fois à la luminance MESURÉE des carreaux : un gain par mosaïque.
 *
 * La mesure : le premier niveau dont la largeur dépasse 2 048 px (au plus 96 carreaux), tous les
 * carreaux de la matrice, luminance linéaire pondérée par cos(latitude). Les pixels exactement
 * noirs (absence de données) sont écartés et comptés ; un carreau que le service refuse (404)
 * est compté aussi, et la mesure porte alors sur la surface couverte.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/config/tileGain.json');
const CACHE = join(ROOT, '.cache/tile-gain');
const write = process.argv.includes('--write');
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? process.argv[onlyArg + 1].split(',') : null;

const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': join(ROOT, 'src') } },
});
const load = (path) => loader.ssrLoadModule(path);
const { SURFACE_TILESETS } = await load('/src/config/surfaceTilesets.ts');
const { tileUrl } = await load('/src/core/tileUrl.ts');
const { tileMatrix, tileBounds } = await load('/src/core/tilePyramid.ts');
const { srgbByteToLinear } = await load('/src/core/srgb.ts');
const rule = await load('/src/core/displayAlbedo.ts');
await loader.close();

const shipped = JSON.parse(
  readFileSync(join(ROOT, 'src/config/displayAlbedo.json'), 'utf8')
);
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;

const LUT = Array.from({ length: 256 }, (_, c) => srgbByteToLinear(c));
const MAX_TILES = 96;
const MIN_WIDTH_PX = 2048;

mkdirSync(CACHE, { recursive: true });

async function fetchTile(url) {
  const file = join(CACHE, createHash('sha1').update(url).digest('hex'));
  if (existsSync(file)) return readFileSync(file);
  const response = await fetch(url);
  if (!response.ok) return response.status;
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(file, bytes);
  return bytes;
}

async function measure(tileset) {
  let level = tileset.minLevel;
  const width = (l) => {
    const m = tileMatrix(l, tileset.matrix);
    return m.columns * tileset.matrix.tileSizePx;
  };
  while (level < tileset.maxLevel && width(level) < MIN_WIDTH_PX) level += 1;
  const matrix = tileMatrix(level, tileset.matrix);
  if (matrix.columns * matrix.rows > MAX_TILES)
    throw new Error(
      `${tileset.id} : ${matrix.columns * matrix.rows} carreaux au niveau ${level}`
    );
  let sum = 0;
  let area = 0;
  let missing = 0;
  let blackPixels = 0;
  let pixels = 0;
  for (let row = 0; row < matrix.rows; row += 1)
    for (let column = 0; column < matrix.columns; column += 1) {
      const index = { level, row, column };
      const bytes = await fetchTile(tileUrl(tileset.service, index));
      if (typeof bytes === 'number') {
        missing += 1;
        continue;
      }
      const { data, info } = await sharp(bytes)
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      const bounds = tileBounds(index, tileset.matrix);
      for (let y = 0; y < info.height; y += 1) {
        const lat =
          bounds.north -
          ((y + 0.5) / info.height) * (bounds.north - bounds.south);
        const w = Math.cos((lat * Math.PI) / 180);
        for (let x = 0; x < info.width; x += 1) {
          const i = (y * info.width + x) * info.channels;
          pixels += 1;
          const r = data[i];
          const g = info.channels > 1 ? data[i + 1] : r;
          const b = info.channels > 2 ? data[i + 2] : r;
          if (r === 0 && g === 0 && b === 0) {
            blackPixels += 1;
            continue;
          }
          sum += w * (0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b]);
          area += w;
        }
      }
    }
  if (!(area > 0)) throw new Error(`${tileset.id} : aucune donnée mesurable`);
  return {
    level,
    tiles: matrix.columns * matrix.rows,
    missingTiles: missing,
    blackFraction: Math.round((blackPixels / pixels) * 1e4) / 1e4,
    mean: sum / area,
  };
}

const round = (x) => Math.round(x * 1e5) / 1e5;
const rows = [];
for (const [body, tileset] of SURFACE_TILESETS) {
  if (only && !only.includes(body)) continue;
  const albedo = shipped.albedos[body];
  if (albedo === undefined) continue; // hors de la règle : la mosaïque garde sa luminosité
  try {
    const m = await measure(tileset);
    const row = {
      body,
      tileset: tileset.id,
      albedo,
      level: m.level,
      tiles: m.tiles,
      missingTiles: m.missingTiles,
      blackFraction: m.blackFraction,
      tileMeanLuminance: round(m.mean),
      gain: round(rule.displayGain(albedo, m.mean)),
      baseGain: shipped.gains[body],
    };
    rows.push(row);
    console.log(
      body.padEnd(12),
      `niv ${row.level}  ${row.tiles} carreaux (${row.missingTiles} absents)  noir ${row.blackFraction}  moyenne ${row.tileMeanLuminance}  gain ${row.gain}  (base ${row.baseGain})`
    );
  } catch (error) {
    console.error(body, 'ÉCHEC', error.message);
    rows.push({ body, tileset: tileset.id, reason: String(error.message) });
  }
}

if (write) {
  const kept =
    only && previous ? previous.rows.filter((r) => !only.includes(r.body)) : [];
  const all = [...kept, ...rows].sort((a, b) => a.body.localeCompare(b.body));
  const table = {
    $comment:
      'Écrit par `node scripts/measure-tile-gain.mjs --write`. Ne pas éditer à la main. Règle : `src/core/displayAlbedo.ts`, appliquée à la luminance mesurée des carreaux.',
    luminancePerAlbedo: rule.DISPLAY_LUMINANCE_PER_ALBEDO,
    // Ce que l'application lit, SEUL : gain absolu de la mosaïque d'un corps.
    gains: Object.fromEntries(
      all.filter((r) => r.gain !== undefined).map((r) => [r.body, r.gain])
    ),
    rows: all,
  };
  writeFileSync(OUT, `${JSON.stringify(table, null, 2)}\n`);
  console.log(
    `\nécrit : ${all.length} mosaïques dans src/config/tileGain.json`
  );
}
