/* global console, process */
/**
 * Auto-génération du LOD : crée les variantes basse résolution manquantes à partir de la
 * plus haute résolution réellement présente pour chaque texture.
 *
 * Usage :
 *   node scripts/resize-textures.mjs           # génère les variantes manquantes
 *   node scripts/resize-textures.mjs --dry-run # liste ce qui serait généré, sans écrire
 *   node scripts/resize-textures.mjs --force   # régénère même si le fichier cible existe
 *
 * Requiert sharp : pnpm add -D sharp
 *
 * Principe :
 *  - balaie public/assets/textures/{body}/ et regroupe les fichiers par base ({body}{Layer}).
 *  - pour chaque base, prend la plus haute réso PRÉSENTE comme source.
 *  - génère uniquement les variantes INFÉRIEURES manquantes (jamais d'upscale : on ne crée
 *    pas de faux détail). Une réso cible >= source est ignorée.
 *  - la largeur cible est dérivée du palier LOD, mais plafonnée à la largeur réelle de la
 *    source pour ne jamais agrandir.
 *
 * ⚠️ Après génération, aligne `textureResolutions` dans src/config/bodies.ts sur les fichiers
 *    réellement présents (le LOD ne demande que les paliers déclarés → pas de 404, plafonnement
 *    propre sur la plus haute réso existante).
 */
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp non trouvé. Installe-le avec :  pnpm add -D sharp');
  process.exit(1);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEX_DIR = resolve(ROOT, 'public/assets/textures');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

/** Paliers LOD → largeur équirectangulaire (hauteur = largeur / 2). */
const QUALITY_WIDTH = { '1k': 1024, '2k': 2048, '4k': 4096, '8k': 8192 };
/** Ordre décroissant pour choisir la source (plus haute présente d'abord). */
const QUALITY_ORDER = ['8k', '4k', '2k', '1k'];

/** Extrait { base, quality } d'un nom de fichier `fooSurface_4k.jpg` → { base:'fooSurface', quality:'4k' }. */
function parseName(file) {
  const m = /^(.*)_(\d+k)\.jpg$/i.exec(file);
  if (!m || !(m[2].toLowerCase() in QUALITY_WIDTH)) return null;
  return { base: m[1], quality: m[2].toLowerCase() };
}

/** Regroupe les fichiers d'un dossier par base : { base: { quality: fullPath } }. */
function groupByBase(dir) {
  const groups = {};
  for (const file of readdirSync(dir)) {
    const parsed = parseName(file);
    if (!parsed) continue;
    (groups[parsed.base] ??= {})[parsed.quality] = join(dir, file);
  }
  return groups;
}

let generated = 0;
let skipped = 0;
let planned = 0;

for (const body of readdirSync(TEX_DIR)) {
  const bodyDir = join(TEX_DIR, body);
  if (!statSync(bodyDir).isDirectory()) continue;

  const groups = groupByBase(bodyDir);
  for (const [base, byQuality] of Object.entries(groups)) {
    // Source = plus haute réso présente.
    const srcQuality = QUALITY_ORDER.find((q) => byQuality[q]);
    if (!srcQuality) continue;
    const srcPath = byQuality[srcQuality];
    const srcWidth = QUALITY_WIDTH[srcQuality];

    // Cibles = paliers strictement inférieurs à la source (jamais d'upscale).
    for (const targetQuality of QUALITY_ORDER) {
      const targetWidth = QUALITY_WIDTH[targetQuality];
      if (targetWidth >= srcWidth) continue; // >= source → pas d'upscale ni de copie inutile

      const dstPath = join(bodyDir, `${base}_${targetQuality}.jpg`);
      const label = `${body}/${base}_${targetQuality}`;

      if (existsSync(dstPath) && !FORCE) {
        skipped++;
        continue;
      }

      const height = Math.round(targetWidth / 2);
      if (DRY_RUN) {
        planned++;
        console.log(`· ${label} (${targetWidth}×${height}) ← ${srcQuality}`);
        continue;
      }

      process.stdout.write(
        `→ ${label} (${targetWidth}×${height}) ← ${srcQuality} … `
      );
      await sharp(srcPath)
        .resize(targetWidth, height, { fit: 'fill', kernel: 'lanczos3' })
        .jpeg({ quality: 88, progressive: true })
        .toFile(dstPath);
      console.log('OK');
      generated++;
    }
  }
}

if (DRY_RUN) {
  console.log(
    `\nDry-run : ${planned} variante(s) à générer, ${skipped} déjà présente(s).`
  );
} else {
  console.log(
    `\nTerminé : ${generated} générée(s), ${skipped} déjà présente(s).`
  );
  if (generated > 0) {
    console.log(
      '⚠️  Pense à aligner `textureResolutions` dans src/config/bodies.ts sur les fichiers présents.'
    );
  }
}
