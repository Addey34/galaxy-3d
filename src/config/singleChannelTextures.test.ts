import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { flattenBodies } from './catalog';
import { CELESTIAL_CONFIG } from './bodies';
import { texturePath } from './catalog';
import { SINGLE_CHANNEL_KEYS } from '@/core/textureColorSpace';

/**
 * UNE TEXTURE TÉLÉVERSÉE SUR UN SEUL CANAL DOIT ÊTRE EN NIVEAUX DE GRIS (lot 54). Les clés de
 * `SINGLE_CHANNEL_KEYS` partent au GPU en R8, qui ne garde que le ROUGE : une carte colorée y
 * perdrait deux canaux sans un mot. Chaque fichier livré sous ces clés, pour tout corps et à tout
 * palier, doit donc avoir R = V = B (lu sur une réduction, à la tolérance d'un JPEG).
 */
describe('cartes à un seul canal : vraiment en niveaux de gris', () => {
  const files: string[] = [];
  for (const [name, cfg] of flattenBodies(CELESTIAL_CONFIG)) {
    for (const key of Object.keys(cfg.textureResolutions ?? {})) {
      if (!SINGLE_CHANNEL_KEYS.has(key)) continue;
      const resolutions =
        (cfg.textureResolutions as Record<string, string[] | undefined>)[key] ??
        [];
      const base =
        (cfg.textures as Record<string, string> | undefined)?.[key] ??
        texturePath(name, key);
      for (const res of resolutions)
        files.push(
          resolve(__dirname, `../../public/assets/textures/${base}_${res}.jpg`)
        );
    }
  }

  it('au moins une carte est concernée (sinon la garde ne garde rien)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // Décoder un JPEG 8k prend plusieurs secondes sur une machine chargée : le délai par défaut
  // de vitest (5 s) faisait tomber ce test quand toute la suite tournait en parallèle.
  it.each(files)('%s', { timeout: 60_000 }, async (file) => {
    expect(existsSync(file), file).toBe(true);
    const { data, info } = await sharp(file)
      .resize(512, 256)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let worst = 0;
    for (let i = 0; i < data.length; i += info.channels)
      worst = Math.max(
        worst,
        Math.abs(data[i]! - data[i + 1]!),
        Math.abs(data[i]! - data[i + 2]!)
      );
    expect(worst, file).toBeLessThanOrEqual(2);
  });
});
