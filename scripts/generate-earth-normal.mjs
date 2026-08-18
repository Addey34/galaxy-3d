/* global console, process */
/**
 * Generates Earth tangent-space normal maps from a global elevation raster.
 *
 * Preferred input: NOAA ETOPO 2022 surface elevation GeoTIFF (float32, 60 arc-sec).
 * A legacy 8-bit NASA relief raster remains supported for reproducibility, but is
 * explicitly not treated as altitude data. Longitude wraps; latitude clamps.
 *
 * Usage:
 *   node scripts/generate-earth-normal.mjs <elevation-or-relief-raster> [output-dir]
 */
import { Buffer } from 'node:buffer';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const input = process.argv[2];
if (!input)
  throw new Error(
    'Usage: node scripts/generate-earth-normal.mjs <elevation-or-relief-raster> [output-dir]'
  );
await access(input);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.resolve(
  process.argv[3] ?? path.join(ROOT, 'public/assets/textures/earth')
);
const SIZES = [1024, 2048, 4096, 8192];
const EARTH_RADIUS_METERS = 6_371_000;
// Display scale compensates for the 2k/4k/8k resampling of a physical DEM. It is a
// normal-map slope scale, not an altitude multiplier or a claim of raw geophysical normals.
const NORMAL_STRENGTH = Number(process.env.EARTH_NORMAL_STRENGTH ?? 24);
if (!(NORMAL_STRENGTH > 0))
  throw new Error('EARTH_NORMAL_STRENGTH must be positive');
const isElevationRaster = /\.(tif|tiff)$/i.test(input);

function sample(data, width, height, x, y, channels = 1) {
  const wrappedX = (x + width) % width;
  const clampedY = Math.max(0, Math.min(height - 1, y));
  return data[(clampedY * width + wrappedX) * channels];
}

function meanAndStd(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

for (const width of SIZES) {
  const height = width / 2;
  const source = isElevationRaster ? sharp(input) : sharp(input).greyscale();
  const { data, info } = await source
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw({ depth: isElevationRaster ? 'float' : 'uchar' })
    .toBuffer({ resolveWithObject: true });
  const sourceChannels = info.channels;
  if (isElevationRaster && sourceChannels !== 3)
    throw new Error(`Expected three DEM channels, got ${sourceChannels}`);
  if (!isElevationRaster && sourceChannels !== 1)
    throw new Error(`Expected one relief channel, got ${sourceChannels}`);

  const elevations = isElevationRaster
    ? new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
    : data;
  const output = Buffer.alloc(width * height * 3);
  const red = [];
  const green = [];

  for (let y = 0; y < height; y++) {
    const latitude = Math.PI / 2 - ((y + 0.5) * Math.PI) / height;
    const latitudeStepMeters = (EARTH_RADIUS_METERS * Math.PI) / height;
    const longitudeStepMeters =
      Math.max(Math.cos(latitude), 0.02) *
      ((EARTH_RADIUS_METERS * 2 * Math.PI) / width);

    for (let x = 0; x < width; x++) {
      const eastWestSlope =
        (sample(elevations, width, height, x + 1, y, sourceChannels) -
          sample(elevations, width, height, x - 1, y, sourceChannels)) /
        (2 * (isElevationRaster ? longitudeStepMeters : 1));
      const northSouthSlope =
        (sample(elevations, width, height, x, y - 1, sourceChannels) -
          sample(elevations, width, height, x, y + 1, sourceChannels)) /
        (2 * (isElevationRaster ? latitudeStepMeters : 1));

      const nx = -eastWestSlope * NORMAL_STRENGTH;
      const ny = -northSouthSlope * NORMAL_STRENGTH;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);
      const offset = (y * width + x) * 3;
      const r = Math.round(((nx / length) * 0.5 + 0.5) * 255);
      const g = Math.round(((ny / length) * 0.5 + 0.5) * 255);
      const b = Math.round(((nz / length) * 0.5 + 0.5) * 255);
      output[offset] = r;
      output[offset + 1] = g;
      output[offset + 2] = b;
      red.push(r);
      green.push(g);
    }
  }

  await sharp(output, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toFile(path.join(OUTPUT_DIR, `earth_normal_map_${width / 1024}k.jpg`));

  const redStats = meanAndStd(red);
  const greenStats = meanAndStd(green);
  console.log(
    `earth_normal_map_${width / 1024}k.jpg generated (${isElevationRaster ? 'ETOPO DEM' : 'legacy relief'}; R std ${redStats.std.toFixed(2)}, G std ${greenStats.std.toFixed(2)})`
  );
}
