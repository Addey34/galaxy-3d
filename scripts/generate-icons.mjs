/* global console, process */
/**
 * Génère les icônes PWA à partir de la source vectorielle public/icon.svg.
 *
 * Usage :
 *   node scripts/generate-icons.mjs
 *
 * Requiert sharp (déjà présent : cf. textures:resize).
 *
 * Produit dans public/icons/ :
 *  - pwa-192.png / pwa-512.png : icônes standard référencées par le manifest.
 *  - maskable-512.png          : variante « maskable » (safe-zone ~20 % : le SVG est
 *    dessiné à ~80 % sur un fond opaque, pour que le rognage circulaire d'Android ne
 *    coupe pas le motif).
 *  - apple-touch-icon.png (180): écran d'accueil iOS (pas de transparence, fond opaque).
 *
 * Le fond opaque #02040a reprend le fond spatial de l'app (theme-color proche du noir).
 */
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'public', 'icon.svg');
const OUT_DIR = join(ROOT, 'public', 'icons');
const BG = '#02040a';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const svg = readFileSync(SRC);

  // Icônes standard : le SVG remplit tout le carré (fond déjà inclus dans le SVG).
  const standard = [
    { size: 192, name: 'pwa-192.png' },
    { size: 512, name: 'pwa-512.png' },
  ];
  for (const { size, name } of standard) {
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain' })
      .png()
      .toFile(join(OUT_DIR, name));
    console.log(`✓ ${name} (${size}×${size})`);
  }

  // Maskable : motif à ~80 % centré sur un fond opaque plein (safe-zone Android).
  const maskSize = 512;
  const inner = Math.round(maskSize * 0.8);
  const pad = Math.round((maskSize - inner) / 2);
  const innerPng = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: 'contain' })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: maskSize,
      height: maskSize,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: innerPng, top: pad, left: pad }])
    .png()
    .toFile(join(OUT_DIR, 'maskable-512.png'));
  console.log('✓ maskable-512.png (512×512, safe-zone 80%)');

  // apple-touch-icon : 180×180 sur fond opaque (iOS n'aime pas la transparence).
  await sharp({
    create: { width: 180, height: 180, channels: 4, background: BG },
  })
    .composite([
      {
        input: await sharp(svg, { density: 384 })
          .resize(180, 180, { fit: 'contain' })
          .png()
          .toBuffer(),
      },
    ])
    .png()
    .toFile(join(OUT_DIR, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png (180×180)');

  console.log('\nIcônes PWA générées dans public/icons/.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
