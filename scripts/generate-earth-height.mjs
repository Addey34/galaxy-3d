/* global console, process */
/**
 * Generates Earth displacement height maps from NOAA ETOPO surface elevation.
 * Ocean and negative bathymetry are clamped to sea level using the deployed Earth
 * ocean mask, because seafloor is not visible relief on an orbital surface.
 *
 * Usage:
 *   node scripts/generate-earth-height.mjs <etopo-tif> <earth-spec-2k> [output-dir]
 */
import { Buffer } from 'node:buffer';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const input = process.argv[2];
const specInput = process.argv[3];
if (!input || !specInput)
  throw new Error(
    'Usage: node scripts/generate-earth-height.mjs <etopo-tif> <earth-spec-2k> [output-dir]'
  );
await access(input);
await access(specInput);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.resolve(
  process.argv[4] ?? path.join(ROOT, 'public/assets/textures/earth')
);
const SIZES = [1024, 2048];
const MAX_ELEVATION_METERS = 8_849;

function sample(data, width, height, x, y, channels = 1) {
  const wrappedX = (x + width) % width;
  const clampedY = Math.max(0, Math.min(height - 1, y));
  return data[(clampedY * width + wrappedX) * channels];
}

for (const width of SIZES) {
  const height = width / 2;
  const elevation = await sharp(input)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw({ depth: 'float' })
    .toBuffer({ resolveWithObject: true });
  const spec = await sharp(specInput)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const elevationChannels = elevation.info.channels;
  if (elevationChannels !== 3)
    throw new Error(`Expected three DEM channels, got ${elevationChannels}`);

  const values = Buffer.alloc(width * height);
  const elevations = new Float32Array(
    elevation.data.buffer,
    elevation.data.byteOffset,
    elevation.data.byteLength / 4
  );
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let oceanPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const specIndex = (y * width + x) * spec.info.channels;
      const isOcean = spec.data[specIndex + 1] > 220;
      const rawElevation = sample(
        elevations,
        width,
        height,
        x,
        y,
        elevationChannels
      );
      const landElevation = isOcean
        ? 0
        : Math.max(0, Math.min(MAX_ELEVATION_METERS, rawElevation));
      const normalized = Math.round(
        (landElevation / MAX_ELEVATION_METERS) * 255
      );
      values[y * width + x] = normalized;
      min = Math.min(min, landElevation);
      max = Math.max(max, landElevation);
      sum += landElevation;
      if (isOcean) oceanPixels += 1;
    }
  }

  await sharp(values, { raw: { width, height, channels: 1 } })
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    .toFile(path.join(OUTPUT_DIR, `earth_displacement_${width / 1024}k.jpg`));

  console.log(
    `earth_displacement_${width / 1024}k.jpg generated (min ${min.toFixed(1)} m, max ${max.toFixed(1)} m, mean ${(sum / (width * height)).toFixed(1)} m, ocean ${((100 * oceanPixels) / (width * height)).toFixed(2)}%)`
  );
}
