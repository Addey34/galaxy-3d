import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEXTURE_ROOT = join(PROJECT_ROOT, 'public/assets/textures');
const ORDER = ['1k', '2k', '4k', '8k'] as const;

/**
 * Écart moyen toléré (sur 255) entre le niveau le plus fin et le plus grossier d'une texture,
 * réduits à la même taille. MESURÉ sur les 34 textures multi-niveaux livrées : 4,56 au plus
 * (la normal map de la Terre, dont le détail fin est légitime), 1,5 pour tout le reste. Le 8k
 * défectueux de l'anneau de Saturne mesurait ~17.
 */
const MAX_LEVEL_GAP = 8;

/**
 * TOUS LES NIVEAUX D'UNE TEXTURE DISENT LA MÊME CHOSE.
 *
 * Chaque palier de qualité charge un fichier différent du même corps : le 8k n'est vu qu'en
 * qualité haute, le 2k en moyenne. Un niveau faux ne se voit donc QUE sur la machine qui le
 * charge, et aucun autre test ne le lit. C'est ce qui a été livré : le 8k de l'anneau de Saturne
 * portait un bord intérieur blanc opaque (le RVB caché sous un alpha nul, cf.
 * `blackenTransparent` dans `scripts/import-textures.mjs`), dessiné en haute qualité comme une
 * ellipse lumineuse autour de la planète — et 1k, 2k, 4k étaient justes.
 */
describe('cohérence des niveaux de texture', () => {
  const groups = new Map<string, string[]>();
  for (const body of readdirSync(TEXTURE_ROOT))
    for (const file of readdirSync(join(TEXTURE_ROOT, body))) {
      const match = /^(.*)_(1k|2k|4k|8k)\.jpg$/.exec(file);
      if (!match) continue;
      const key = `${body}/${match[1]}`;
      groups.set(key, [...(groups.get(key) ?? []), match[2]!]);
    }
  const multi = [...groups].filter(([, levels]) => levels.length >= 2);

  it('trouve des textures à plusieurs niveaux', () => {
    // Sans cette borne, un dossier mal lu rendrait la suite ci-dessous vide, donc verte.
    expect(multi.length).toBeGreaterThan(20);
  });

  it.each(multi)(
    '%s : le niveau le plus fin concorde avec le plus grossier',
    async (key, levels) => {
      const sorted = [...levels].sort(
        (a, b) =>
          ORDER.indexOf(a as (typeof ORDER)[number]) -
          ORDER.indexOf(b as (typeof ORDER)[number])
      );
      const coarse = join(TEXTURE_ROOT, `${key}_${sorted[0]}.jpg`);
      const fine = join(TEXTURE_ROOT, `${key}_${sorted.at(-1)}.jpg`);
      const meta = await sharp(coarse).metadata();
      const width = Math.min(256, meta.width!);
      const height = Math.max(
        1,
        Math.round((width * meta.height!) / meta.width!)
      );
      const shrink = (path: string) =>
        sharp(path, { limitInputPixels: false })
          .removeAlpha()
          .resize(width, height, { fit: 'fill' })
          .raw()
          .toBuffer();
      const [a, b] = await Promise.all([shrink(coarse), shrink(fine)]);
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
      const gap = sum / a.length;
      expect(
        gap,
        `${key} : ${sorted.at(-1)} s'écarte de ${sorted[0]} de ${gap.toFixed(2)}/255`
      ).toBeLessThan(MAX_LEVEL_GAP);
    },
    30_000
  );
});
