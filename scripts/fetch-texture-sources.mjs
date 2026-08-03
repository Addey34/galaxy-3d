/* global console, process, fetch, URL */
/**
 * Télécharge des sources de textures validées et produit les LOD JPEG du catalogue.
 *
 * Usage :
 *   pnpm textures:fetch --body=io,europa
 *   pnpm textures:fetch --all --force
 *   pnpm textures:fetch --all --dry-run
 *
 * Les sources brutes restent dans tmp/texture-sources/, déjà ignoré par Git.
 * Le manifeste refuse les projections non équirectangulaires : elles doivent être
 * reprojetées séparément avant d'entrer dans ce pipeline.
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp non trouvé. Installe-le avec : pnpm add -D sharp');
  process.exit(1);
}

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MANIFEST_PATH = resolve(ROOT, 'scripts/texture-sources.json');
const CACHE_DIR = resolve(ROOT, 'tmp/texture-sources');
const TEXTURE_DIR = resolve(ROOT, 'public/assets/textures');
const MAX_DIRECT_SOURCE_BYTES = 8 * 1024 ** 3;
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

const QUALITY_ORDER = ['8k', '4k', '2k', '1k'];
const args = new Set(process.argv.slice(2));
const bodyArg = process.argv
  .find((arg) => arg.startsWith('--body='))
  ?.slice('--body='.length);
const selectedBodies = bodyArg
  ? new Set(
      bodyArg
        .split(',')
        .map((body) => body.trim())
        .filter(Boolean)
    )
  : null;
const dryRun = args.has('--dry-run');
const force = args.has('--force');
const selectAll = args.has('--all') || selectedBodies === null;

function qualityWidth(quality) {
  const width = manifest.qualityWidths[quality];
  if (!width) {
    throw new Error('Résolution inconnue dans le manifeste : ' + quality);
  }
  return width;
}

function sourceExtension(url) {
  const extension = extname(new URL(url).pathname).toLowerCase();
  return extension || '.source';
}

async function download(url, destination) {
  console.log('  ↓ ' + url);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(
      'Téléchargement impossible (' + response.status + ') : ' + url
    );
  }
  mkdirSync(resolve(destination, '..'), { recursive: true });
  const partialPath = destination + '.part';
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  if (totalBytes > MAX_DIRECT_SOURCE_BYTES) {
    await response.body.cancel();
    throw new Error('Source trop volumineuse pour Sharp ; utiliser le pipeline GDAL par tiles.');
  }
  let receivedBytes = 0;
  let nextProgress = 10;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (totalBytes > 0) {
        const percent = Math.floor((receivedBytes / totalBytes) * 100);
        if (percent >= nextProgress) {
          console.log('  ... ' + percent + '%');
          nextProgress += 10;
        }
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    progress,
    createWriteStream(partialPath)
  );
  if (existsSync(destination)) unlinkSync(destination);
  renameSync(partialPath, destination);
}

async function generateLODs(entry, sourcePath) {
  const metadata = await sharp(sourcePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Dimensions introuvables pour ' + sourcePath);
  }

  const ratio = metadata.width / metadata.height;
  if (Math.abs(ratio - 2) > 0.03) {
    throw new Error(
      entry.body +
        '/' +
        entry.layer +
        ': projection non équirectangulaire (' +
        metadata.width +
        'x' +
        metadata.height +
        ')'
    );
  }

  const maxWidth = qualityWidth(entry.maxQuality);
  const outputDirectory = resolve(
    TEXTURE_DIR,
    entry.outputBase.split('/').slice(0, -1).join('/')
  );
  mkdirSync(outputDirectory, { recursive: true });

  for (const quality of QUALITY_ORDER) {
    const width = qualityWidth(quality);
    if (width > maxWidth) continue;

    const outputPath = resolve(
      TEXTURE_DIR,
      entry.outputBase + '_' + quality + '.jpg'
    );
    if (existsSync(outputPath) && !force) {
      console.log(
        '  ✓ déjà présent : ' + entry.outputBase + '_' + quality + '.jpg'
      );
      continue;
    }

    await sharp(sourcePath)
      .resize(width, Math.round(width / 2), {
        fit: 'fill',
        kernel: 'lanczos3',
      })
      .jpeg({ quality: 88, progressive: true })
      .toFile(outputPath);
    console.log('  ✓ écrit : ' + entry.outputBase + '_' + quality + '.jpg');
  }
}

async function processEntry(entry) {
  if (entry.processing === 'gdal-required') {
    console.log('- ' + entry.body + ': traitement GDAL par tiles requis ; aucun téléchargement direct.');
    return;
  }
  if (entry.status !== 'ready') {
    console.log('- ' + entry.body + ': source en attente de validation');
    return;
  }
  if (entry.projection !== 'equirectangular') {
    console.log('- ' + entry.body + ': projection à reprojeter manuellement');
    return;
  }

  const sourcePath = resolve(
    CACHE_DIR,
    entry.body + '-' + entry.layer + sourceExtension(entry.downloadUrl)
  );
  if (!existsSync(sourcePath) || force) {
    if (dryRun) {
      console.log('- ' + entry.body + ': télécharger ' + entry.downloadUrl);
      return;
    }
    await download(entry.downloadUrl, sourcePath);
  } else {
    console.log('  ✓ source en cache : ' + basename(sourcePath));
  }

  if (dryRun) return;
  await generateLODs(entry, sourcePath);
}

const entries = manifest.sources.filter(
  (entry) => selectAll || selectedBodies.has(entry.body)
);
if (entries.length === 0) {
  throw new Error(
    'Aucune source sélectionnée. Utilise --all ou --body=io,europa.'
  );
}

try {
  const failures = [];
  for (const entry of entries) {
    console.log('\n[' + entry.body + '/' + entry.layer + ']');
    try {
      await processEntry(entry);
    } catch (error) {
      failures.push(entry.body);
      console.error('  ✗ échec : ' + error.message);
    }
  }
  if (failures.length > 0) {
    console.error('\nÉchecs : ' + failures.join(', '));
    process.exitCode = 1;
  } else {
    console.log('\nTerminé.');
  }
} catch (error) {
  console.error('\nÉchec : ' + error.message);
  process.exitCode = 1;
}
