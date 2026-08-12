/* global console, process, Buffer */
/**
 * Corrige la singularité polaire de la texture de surface de la Terre.
 *
 * En projection équirectangulaire, la rangée de pixels au pôle (haut = Arctique,
 * bas = Antarctique) est étirée sur 360° → une calotte blanche grossière et éblouissante
 * (le « super Groenland »). La banquise y est déjà quasi uniforme (~RGB 229,232,239) mais
 * trop claire/étendue une fois projetée.
 *
 * Ce script adoucit À LA SOURCE, dans earth_surface_*.jpg, la bande polaire extrême :
 *  - il fond les ~POLE_FRACTION derniers % de rangées (haut ET bas) vers une glace plus
 *    discrète (cool, moins éblouissante) ;
 *  - transition douce (smoothstep) vers la géographie réelle en dessous → pas de bord dur ;
 *  - la toute dernière rangée est forcée à une couleur UNIFORME (moyenne de la bande) pour
 *    que le point de convergence au pôle soit une glace propre, pas un smear bruité.
 *
 * Sauvegarde chaque original en .bak (idempotent : retravaille toujours depuis le .bak).
 *
 * Usage :
 *   node scripts/fix-earth-poles.mjs            # applique
 *   node scripts/fix-earth-poles.mjs --restore  # restaure les .bak
 */
import sharp from 'sharp';
import { readdir, copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const DIR = 'public/assets/textures/earth';
const RESTORE = process.argv.includes('--restore');

// Fraction de la hauteur traitée à CHAQUE pôle (≈ 3.5 % ≈ derniers ~6° de latitude).
const POLE_FRACTION = 0.035;
// Glace cible : blanc froid discret (moins éblouissant que ~229). Légèrement bleuté.
const ICE = [188, 198, 214];

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

async function processFile(file) {
  const src = path.join(DIR, file);
  const bak = src + '.bak';

  if (RESTORE) {
    if (await exists(bak)) {
      await copyFile(bak, src);
      console.log('restauré', file);
    }
    return;
  }

  // Toujours retravailler depuis l'original (idempotent).
  if (!(await exists(bak))) await copyFile(src, bak);

  const { data, info } = await sharp(bak)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width,
    H = info.height,
    C = info.channels;
  const band = Math.max(2, Math.round(H * POLE_FRACTION));

  const out = Buffer.from(data);

  // Bande NORD (rangées 0..band) et SUD (rangées H-band..H-1). `d` = distance au pôle
  // (0 = pôle, 1 = bas de la bande). On mélange vers ICE, plus fort près du pôle.
  for (let k = 0; k < band; k++) {
    const d = k / band; // 0 au pôle → 1 en bas de bande
    // Poids du remplacement : total au pôle, nul en bas de bande (transition douce).
    const w = 1 - smoothstep(0, 1, d);
    for (let side = 0; side < 2; side++) {
      const y = side === 0 ? k : H - 1 - k;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * C;
        for (let c = 0; c < 3; c++) {
          out[i + c] = Math.round(data[i + c] * (1 - w) + ICE[c] * w);
        }
      }
    }
  }

  // Force la toute dernière rangée de chaque pôle à la couleur ICE uniforme : le point
  // de convergence devient une glace propre (pas de bruit résiduel étiré).
  for (let side = 0; side < 2; side++) {
    const y = side === 0 ? 0 : H - 1;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      out[i] = ICE[0];
      out[i + 1] = ICE[1];
      out[i + 2] = ICE[2];
    }
  }

  await sharp(out, { raw: { width: W, height: H, channels: C } })
    .jpeg({ quality: 92 })
    .toFile(src);
  console.log('corrigé', file, `(bande ${band}px/pôle)`);
}

const files = (await readdir(DIR)).filter((f) =>
  /^earth_surface_\d+k\.jpg$/.test(f)
);
for (const f of files) await processFile(f);
console.log(RESTORE ? 'restauration terminée' : 'correction terminée');
