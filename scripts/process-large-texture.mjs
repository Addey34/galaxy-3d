/* global console, process, URL */
/**
 * Prepares a very large scientific raster without downloading it or loading it
 * entirely in Sharp. GDAL performs the windowed reprojection/resampling; Sharp
 * only receives the bounded intermediate raster.
 *
 * Dry-run by default:
 *   pnpm textures:process-large --body=venus --source=D:\sources\venus.tif
 * Apply explicitly after review:
 *   pnpm textures:process-large --body=venus --source=D:\sources\venus.tif --apply --force
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(
  require('node:fs').readFileSync(resolve(ROOT, 'scripts/texture-sources.json'), 'utf8')
);
const widths = manifest.qualityWidths;
const args = process.argv.slice(2);
const body = args.find((arg) => arg.startsWith('--body='))?.slice('--body='.length);
const sourceArg = args.find((arg) => arg.startsWith('--source='))?.slice('--source='.length);
const maxQuality = args.find((arg) => arg.startsWith('--max-quality='))?.slice('--max-quality='.length) ?? '8k';
const apply = args.includes('--apply');
const force = args.includes('--force');

function fail(message) {
  console.error(`Large texture processing aborted: ${message}`);
  process.exitCode = 1;
}

const entry = manifest.reviews.find(
  (review) => review.body === body && review.layer === 'surface'
);
const source = sourceArg ? resolve(sourceArg) : undefined;
const outputRoot = resolve(ROOT, 'tmp/texture-processing', body ?? 'unknown');
const textureRoot = resolve(ROOT, 'public/assets/textures', body ?? 'unknown');
const publicRoot = resolve(ROOT, 'public');

if (!body || !/^[a-z0-9-]+$/.test(body)) {
  fail('provide --body=<lowercase-body>.');
} else if (!source || !existsSync(source)) {
  fail('provide an existing local --source=<path>; no source is downloaded.');
} else if (relative(publicRoot, source) && !relative(publicRoot, source).startsWith('..')) {
  fail('the raw source must stay outside public/.');
} else if (!entry || entry.processing !== 'gdal-required') {
  fail(`${body} is not registered as a GDAL-required source in the manifest.`);
} else if (!widths[maxQuality]) {
  fail(`unknown --max-quality=${maxQuality}.`);
} else if (!apply) {
  console.log(`Dry-run: GDAL will produce ${widths[maxQuality]}x${widths[maxQuality] / 2} ${maxQuality} output for ${body}.`);
  console.log(`Source: ${source}`);
  console.log('No files will be written. Add --apply only after reviewing the source and coverage.');
} else {
  const gdalwarp = process.platform === 'win32' ? 'gdalwarp.exe' : 'gdalwarp';
  const version = spawnSync(gdalwarp, ['--version'], { encoding: 'utf8' });
  if (version.error) {
    fail('GDAL is required. Install gdalwarp before using --apply.');
  } else {
    mkdirSync(outputRoot, { recursive: true });
    mkdirSync(textureRoot, { recursive: true });
    const intermediate = resolve(outputRoot, `${body}-${maxQuality}-equirectangular.tif`);
    const width = widths[maxQuality];
    const warpArgs = [
      '-overwrite',
      '-of',
      'GTiff',
      '-multi',
      '-wo',
      'NUM_THREADS=ALL_CPUS',
      '-t_srs',
      'EPSG:4326',
      '-te',
      '-180',
      '-90',
      '180',
      '90',
      '-ts',
      String(width),
      String(width / 2),
      '-r',
      'lanczos',
      '-dstalpha',
      source,
      intermediate,
    ];
    const warped = spawnSync(gdalwarp, warpArgs, { stdio: 'inherit' });
    if (warped.status !== 0) {
      process.exitCode = warped.status ?? 1;
    } else {
      for (const [quality, outputWidth] of Object.entries(widths)) {
        if (outputWidth > width) continue;
        const outputPath = resolve(textureRoot, `${body}Surface_${quality}.jpg`);
        if (existsSync(outputPath) && !force) {
          throw new Error(`${outputPath} exists; add --force to replace it.`);
        }
        await sharp(intermediate)
          .removeAlpha()
          .resize(outputWidth, outputWidth / 2, { fit: 'fill', kernel: 'lanczos3' })
          .jpeg({ quality: 90, chromaSubsampling: '4:4:4', progressive: true })
          .toFile(outputPath);
      }
      writeFileSync(
        resolve(outputRoot, 'processing.json'),
        JSON.stringify(
          {
            body,
            source,
            sourcePage: entry.sourcePage,
            sourceResolution: entry.sourceResolution,
            projection: entry.projection,
            maxQuality,
            outputProjection: 'equirectangular',
            tool: 'gdalwarp + sharp',
            processedAt: new Date().toISOString(),
          },
          null,
          2
        ) + '\n'
      );
      console.log(`Processed ${body} through ${maxQuality}; inspect the output and audit before publishing.`);
    }
  }
}
