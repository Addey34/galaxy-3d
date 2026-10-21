/* global console, process, fetch, Buffer, URL */
/**
 * LE CUISEUR DES MOSAIQUES EN TUILES (lot 66) : lit un fichier d'imagerie publie (GeoTIFF equirectangulaire
 * en une bande), le ROULE si sa carte est centree sur 180 degres, et ecrit une pyramide de tuiles
 * JPEG sur la matrice 2 x 1 que lit le moteur d'imagerie (`core/tilePyramid.ts`, niveau, LIGNE,
 * colonne). Cibles dans `scripts/imagery-tile-targets.json`, jamais ici.
 *
 *   node scripts/bake-imagery-tiles.mjs [--only <id>] [--dry-run]
 *
 * Ecrit les tuiles dans `.cache/galaxy-data/assets/imagery/<id>/<hachage>/default/galaxy-eq2x1/<z>/<ligne>/<colonne>.jpg`
 * (a televerser sur le service de donnees, cf. `services/galaxy-data/README.md`) et le manifeste
 * dans `public/assets/imagery/<id>/manifest.json`, qui nomme le repertoire hache : televerser les
 * tuiles AVANT de livrer un manifeste ou une fiche qui les nomme. Le chemin `default/galaxy-eq2x1/`
 * imite le WMTS RESTful, pour que la fiche et ses gardes restent celles d'un service WMTS.
 *
 * La source est telechargee une fois dans `.cache/imagery-bake/`, sa taille CONFRONTEE a la recette
 * (un fichier remplace chez l'editeur ne se cuit pas en silence) et son SHA-256 ecrit au manifeste.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECIPE = join(ROOT, 'scripts', 'imagery-tile-targets.json');
const SOURCE_CACHE = join(ROOT, '.cache', 'imagery-bake');
const TILE_OUT = join(ROOT, '.cache', 'galaxy-data', 'assets', 'imagery');
const MANIFEST_OUT = join(ROOT, 'public', 'assets', 'imagery');
const TILE_PATH = 'default/galaxy-eq2x1';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const DRY_RUN = args.includes('--dry-run');

const recipe = JSON.parse(readFileSync(RECIPE, 'utf8'));
const ids = Object.keys(recipe.targets).filter((id) => !only || id === only);
if (ids.length === 0) {
  console.error(`aucune cible${only ? ` nommee ${only}` : ''}`);
  process.exit(1);
}

async function download(url, bytes) {
  mkdirSync(SOURCE_CACHE, { recursive: true });
  const file = join(SOURCE_CACHE, basename(new URL(url).pathname));
  if (existsSync(file) && statSync(file).size === bytes) return file;
  console.log(`telechargement ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length !== bytes)
    throw new Error(
      `${url} : ${body.length} octets, la recette en attend ${bytes}`
    );
  writeFileSync(file, body);
  return file;
}

/** Roule la carte d'une demi-largeur : la colonne 0 de la source est a 0 degre, pas a -180. */
function rollHalf(raw, width, height) {
  const half = width / 2;
  const out = Buffer.allocUnsafe(raw.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    raw.copy(out, row, row + half, row + width);
    raw.copy(out, row + half, row, row + half);
  }
  return out;
}

async function bake(id, target) {
  const { source, tileSizePx, maxLevel, jpegQuality } = target;
  if (source.width % 2 !== 0) throw new Error(`${id} : largeur impaire`);
  const file = await download(source.url, source.bytes);
  const sourceSha256 = createHash('sha256')
    .update(readFileSync(file))
    .digest('hex');

  const meta = await sharp(file, { limitInputPixels: false }).metadata();
  if (
    meta.width !== source.width ||
    meta.height !== source.height ||
    meta.channels !== source.channels
  )
    throw new Error(
      `${id} : la source mesure ${meta.width}x${meta.height}x${meta.channels}, ` +
        `la recette ${source.width}x${source.height}x${source.channels}`
    );

  // Une image a UNE bande sort de sharp en TROIS canaux des qu'elle est brute (piege mesure au lot
  // 61) : `extractChannel(0)` apres le controle `channels === 1` ci-dessus.
  let raw = await sharp(file, { limitInputPixels: false })
    .extractChannel(0)
    .raw()
    .toBuffer();
  if (raw.length !== source.width * source.height)
    throw new Error(
      `${id} : ${raw.length} octets lus pour ${source.width * source.height} pixels`
    );
  if (target.centerLongitude === 180)
    raw = rollHalf(raw, source.width, source.height);

  const staging = join(TILE_OUT, id, '.baking');
  rmSync(staging, { recursive: true, force: true });
  const hash = createHash('sha256');
  let tileCount = 0;
  let totalBytes = 0;

  for (let level = 0; level <= maxLevel; level++) {
    const columns = 2 ** (level + 1);
    const rows = 2 ** level;
    const width = tileSizePx * columns;
    const height = tileSizePx * rows;
    // Chaque niveau est reduit (ou, au plus fin, etire) DEPUIS la source entiere, jamais du niveau
    // precedent : un niveau ne porte pas l'erreur de ceux qu'il surmonte.
    const level_ = await sharp(raw, {
      raw: { width: source.width, height: source.height, channels: 1 },
      limitInputPixels: false,
    })
      .resize(width, height, { fit: 'fill' })
      .extractChannel(0)
      .raw()
      .toBuffer();
    if (level_.length !== width * height)
      throw new Error(
        `${id} niveau ${level} : ${level_.length} octets pour ${width * height} pixels`
      );

    const jobs = [];
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) jobs.push([row, column]);

    for (let i = 0; i < jobs.length; i += 64) {
      const batch = await Promise.all(
        jobs.slice(i, i + 64).map(async ([row, column]) => {
          const tile = Buffer.allocUnsafe(tileSizePx * tileSizePx);
          for (let y = 0; y < tileSizePx; y++) {
            const start = (row * tileSizePx + y) * width + column * tileSizePx;
            level_.copy(tile, y * tileSizePx, start, start + tileSizePx);
          }
          const jpeg = await sharp(tile, {
            raw: { width: tileSizePx, height: tileSizePx, channels: 1 },
          })
            .jpeg({ quality: jpegQuality, mozjpeg: true })
            .toBuffer();
          return { row, column, jpeg };
        })
      );
      for (const { row, column, jpeg } of batch) {
        const rel = `${TILE_PATH}/${level}/${row}/${column}.jpg`;
        if (!DRY_RUN) {
          const path = join(staging, rel);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, jpeg);
        }
        hash.update(rel).update(jpeg);
        tileCount++;
        totalBytes += jpeg.length;
      }
    }
    console.log(`${id} niveau ${level} : ${jobs.length} tuiles`);
  }

  const digest = hash.digest('hex').slice(0, 12);
  const manifest = {
    id,
    body: target.body,
    source: {
      url: source.url,
      bytes: source.bytes,
      sha256: sourceSha256,
      width: source.width,
      height: source.height,
      centerLongitude: target.centerLongitude ?? 0,
    },
    matrix: { columnsAtLevelZero: 2, rowsAtLevelZero: 1, tileSizePx },
    maxLevel,
    format: 'image/jpeg',
    jpegQuality,
    path: TILE_PATH,
    hash: digest,
    tileCount,
    totalBytes,
  };

  if (DRY_RUN) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  const final = join(TILE_OUT, id, digest);
  rmSync(final, { recursive: true, force: true });
  renameSync(staging, final);
  mkdirSync(join(MANIFEST_OUT, id), { recursive: true });
  writeFileSync(
    join(MANIFEST_OUT, id, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  console.log(
    `${id} : ${tileCount} tuiles, ${totalBytes} octets, hachage ${digest} -> ${final}`
  );
  // Les repertoires d'une cuisson precedente restent (un visiteur peut tenir l'ancien manifeste) :
  // ils se retirent a la main une fois le nouveau livre.
  const others = readdirSync(join(TILE_OUT, id)).filter((d) => d !== digest);
  if (others.length)
    console.log(
      `anciennes cuissons a retirer plus tard : ${others.join(', ')}`
    );
}

for (const id of ids) await bake(id, recipe.targets[id]);
