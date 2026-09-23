/* global console, process */
/**
 * Relève, pour chaque texture livrée, ce que chaque palier apporte VRAIMENT.
 *
 *   node scripts/measure-texture-ladder.mjs           # compare au relevé commité
 *   node scripts/measure-texture-ladder.mjs --write   # réécrit src/config/textureLadder.json
 *
 * Mesure, palier par palier : la variance (pondérée par cos(latitude), parce qu'une
 * équirectangulaire sur-échantillonne les pôles) de l'écart entre le fichier du palier et son
 * propre aller-retour en demi-résolution, rapportée à sa variance totale. C'est « ce que ce
 * palier montre que le palier du dessous ne montre pas ».
 *
 * La RÈGLE qui lit ce relevé vit dans `src/core/textureLadder.ts` ; la provenance (largeur de
 * la source, lue à son étiquette) vit dans `src/registry/products/textures/*.json`. Le test
 * `src/config/textureLadder.test.ts` confronte les trois aux fichiers réellement présents.
 *
 * Ce relevé est VOLONTAIREMENT hors de `pnpm verify` : il décode les 172 JPEG livrés, ce qui dure des minutes. La porte rapide est le test, qui lit ce fichier.
 */
import { createRequire } from 'node:module';
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp non trouvé. Installe-le avec :  pnpm add -D sharp');
  process.exit(1);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEX_DIR = join(ROOT, 'public/assets/textures');
const OUT = join(ROOT, 'src/config/textureLadder.json');
const WRITE = process.argv.includes('--write');

/** Variance pondérée par cos(latitude) d'une équirectangulaire. */
function weightedVariance(pixels, width, height) {
  let weight = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let y = 0; y < height; y++) {
    const w = Math.cos(((y + 0.5) / height - 0.5) * Math.PI);
    let rowSum = 0;
    let rowSquares = 0;
    const offset = y * width;
    for (let x = 0; x < width; x++) {
      const v = pixels[offset + x];
      rowSum += v;
      rowSquares += v * v;
    }
    weight += w * width;
    sum += w * rowSum;
    sumSquares += w * rowSquares;
  }
  const mean = sum / weight;
  return sumSquares / weight - mean * mean;
}

/** Même pondération, sur l'écart entre deux images de même taille. */
function weightedVarianceOfDifference(a, b, width, height) {
  let weight = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let y = 0; y < height; y++) {
    const w = Math.cos(((y + 0.5) / height - 0.5) * Math.PI);
    let rowSum = 0;
    let rowSquares = 0;
    const offset = y * width;
    for (let x = 0; x < width; x++) {
      const d = a[offset + x] - b[offset + x];
      rowSum += d;
      rowSquares += d * d;
    }
    weight += w * width;
    sum += w * rowSum;
    sumSquares += w * rowSquares;
  }
  const mean = sum / weight;
  return sumSquares / weight - mean * mean;
}

/**
 * Part de variance que `path` porte en plus de son propre aller-retour en demi-résolution.
 *
 * ⚠️ sharp n'ENCHAÎNE pas deux `.resize()` sur un même pipeline : le second remplace le
 * premier, et la mesure rendrait alors 0 partout. D'où les deux passes explicites.
 */
async function detailAboveHalf(path) {
  const meta = await sharp(path).metadata();
  const width = meta.width;
  const height = meta.height;
  const full = await sharp(path).greyscale().raw().toBuffer();
  const total = weightedVariance(full, width, height);
  if (total <= 0) return 0;
  const halfWidth = Math.max(1, Math.round(width / 2));
  const halfHeight = Math.max(1, Math.round(height / 2));
  const small = await sharp(path)
    .greyscale()
    .resize(halfWidth, halfHeight, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const back = await sharp(small)
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .greyscale()
    .raw()
    .toBuffer();
  return weightedVarianceOfDifference(full, back, width, height) / total;
}

function parseName(file) {
  const m = /^(.*)_(\d+k)\.jpg$/i.exec(file);
  return m ? { base: m[1], tier: m[2].toLowerCase() } : null;
}

const rows = [];
for (const body of readdirSync(TEX_DIR).sort()) {
  const dir = join(TEX_DIR, body);
  if (!statSync(dir).isDirectory()) continue;
  const groups = {};
  for (const file of readdirSync(dir)) {
    const parsed = parseName(file);
    if (parsed) (groups[parsed.base] ??= {})[parsed.tier] = join(dir, file);
  }
  for (const [base, byTier] of Object.entries(groups).sort()) {
    const layer = base.slice(body.length + 1);
    const tiers = {};
    for (const tier of ['2k', '4k', '8k']) {
      if (!byTier[tier]) continue;
      tiers[tier] = Number((await detailAboveHalf(byTier[tier])).toFixed(5));
    }
    const shipped = ['1k', '2k', '4k', '8k'].filter((t) => byTier[t]);
    const bytes = shipped.reduce((sum, t) => sum + statSync(byTier[t]).size, 0);
    rows.push({ body, layer, shipped, detail: tiers, bytes });
    console.error(
      `${body}/${layer} ${shipped.join(',')} ` +
        Object.entries(tiers)
          .map(([t, v]) => `${t}:${(v * 100).toFixed(2)}%`)
          .join(' ')
    );
  }
}

const payload = {
  $comment:
    'Relevé écrit par `pnpm textures:ladder --write`. Ne pas éditer à la main. `detail` = part de variance (pondérée cos lat) que le palier porte en plus de son aller-retour en demi-résolution.',
  measuredAt: new Date().toISOString().slice(0, 10),
  rows,
};
const serialized = JSON.stringify(payload, null, 2) + '\n';

if (WRITE) {
  writeFileSync(OUT, serialized, 'utf8');
  console.log(
    `\nÉcrit : ${rows.length} textures dans src/config/textureLadder.json`
  );
} else {
  let current = null;
  try {
    current = JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    console.error('\nAucun relevé commité : lance --write.');
    process.exit(1);
  }
  const same = JSON.stringify(current.rows) === JSON.stringify(rows);
  console.log(
    same
      ? `\n${rows.length} textures : le relevé commité est à jour.`
      : '\nLe relevé commité DIFFÈRE des fichiers présents. Relance avec --write.'
  );
  process.exit(same ? 0 : 1);
}
