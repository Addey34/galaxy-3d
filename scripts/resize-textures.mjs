/* global console, process */
/**
 * Génère des versions basse résolution à partir de textures existantes.
 * Usage : node scripts/resize-textures.mjs
 * Requiert sharp : pnpm add -D sharp  (ou pnpm dlx sharp)
 *
 * Par défaut génère plutoSurface_2k.jpg depuis plutoSurface_4k.jpg.
 * Ajouter d'autres entrées dans TASKS pour d'autres corps.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp non trouvé. Installe-le avec :  pnpm add -D sharp');
  process.exit(1);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEX = (p) => resolve(ROOT, 'public/assets/textures', p);

/** { src, dst, width, height } — height = width/2 pour équirectangulaire. */
const TASKS = [
  { src: TEX('pluto/plutoSurface_4k.jpg'),     dst: TEX('pluto/plutoSurface_2k.jpg'),     width: 2048  },
  { src: TEX('mercury/mercurySurface_4k.jpg'),  dst: TEX('mercury/mercurySurface_8k.jpg'),  width: 8192, comment: 'upscale — remplace quand tu as le vrai 8k' },
  { src: TEX('moon/moonSurface_4k.jpg'),        dst: TEX('moon/moonSurface_8k.jpg'),        width: 8192, comment: 'upscale — remplace quand tu as le vrai 8k' },
];

for (const task of TASKS) {
  if (!existsSync(task.src)) {
    console.warn(`⚠  Source introuvable, ignoré : ${task.src}`);
    continue;
  }
  if (existsSync(task.dst)) {
    console.log(`✓  Déjà présent, ignoré   : ${task.dst}`);
    continue;
  }
  const height = Math.round(task.width / 2);
  const label = task.dst.split(/[/\\]textures[/\\]/)[1] ?? task.dst;
  process.stdout.write(`→  ${label} (${task.width}×${height}) … `);
  await sharp(task.src)
    .resize(task.width, height, { fit: 'fill', kernel: 'lanczos3' })
    .jpeg({ quality: 88, progressive: true })
    .toFile(task.dst);
  console.log('OK');
  if (task.comment) console.log(`   ⚠  ${task.comment}`);
}

console.log('\nTerminé.');
