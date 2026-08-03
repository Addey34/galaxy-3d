/* global console, process, URL */
/**
 * Audite les dimensions et projections des textures réellement présentes.
 * Le test Vitest vérifie le catalogue ; ce script vérifie les fichiers JPEG eux-mêmes.
 */
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEXTURE_ROOT = resolve(ROOT, 'public/assets/textures');
const CANONICAL_WIDTHS = new Set([1024, 2048, 4096, 8192]);
const errors = [];
const warnings = [];
let imageCount = 0;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.(jpe?g)$/i.test(entry.name)) files.push(path);
  }
  return files;
}

for (const path of await walk(TEXTURE_ROOT)) {
  imageCount++;
  const label = relative(ROOT, path).replaceAll('\\', '/');
  let metadata;
  try {
    metadata = await sharp(path).metadata();
  } catch (error) {
    errors.push(`${label}: unreadable image (${error.message})`);
    continue;
  }

  if (!metadata.width || !metadata.height) {
    errors.push(`${label}: missing dimensions`);
    continue;
  }
  if (metadata.width > 8192) {
    errors.push(`${label}: width ${metadata.width} exceeds the 8k policy`);
  }

  const isRing = /Ring_/i.test(label);
  if (!isRing && Math.abs(metadata.width / metadata.height - 2) > 0.03) {
    errors.push(
      `${label}: ${metadata.width}x${metadata.height} is not equirectangular`
    );
  }
  if (!CANONICAL_WIDTHS.has(metadata.width)) {
    warnings.push(
      `${label}: ${metadata.width} px is an approximate/non-canonical LOD width`
    );
  }
}

console.log(`Texture audit: ${imageCount} JPEG(s) inspected.`);
for (const warning of warnings) console.warn(`  ! ${warning}`);
for (const error of errors) console.error(`  x ${error}`);
if (errors.length > 0) {
  process.exitCode = 1;
  console.error(`Texture audit failed: ${errors.length} error(s).`);
} else {
  console.log(`Texture audit passed with ${warnings.length} warning(s).`);
}
