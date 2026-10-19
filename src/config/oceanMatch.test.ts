import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import fiche from '@/registry/products/tilesets/earth-gibs-bluemarble-ng-500m.json';

const TEXTURES = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  'public/assets/textures/earth'
);

/**
 * LA COULEUR D'OCÉAN DE LA BASE, DÉCLARÉE PAR LA FICHE, EST CELLE DE LA TEXTURE LIVRÉE.
 *
 * `oceanMatch.baseSrgb` est une mesure, pas un réglage : si la texture de base change (autre
 * source, autre étalonnage), la valeur de la fiche devient fausse et le shader ramènerait l'océan
 * des tuiles vers une couleur qui n'est plus celle de la base. On la relit donc ici, sur les
 * fichiers livrés, par la même méthode que la fiche écrit (médiane par canal des pixels que le
 * masque d'eau désigne, entre 60° S et 60° N). La couleur de la MOSAÏQUE vient du réseau et ne
 * peut pas être relue hors ligne : elle porte sa date de mesure.
 */
describe('oceanMatch de la mosaïque Blue Marble', () => {
  const match = (
    fiche as { oceanMatch?: { baseSrgb: number[]; measured: string } }
  ).oceanMatch;

  it('est déclaré, daté', () => {
    expect(match).toBeDefined();
    expect(match!.measured).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('donne la couleur médiane de l’océan de la texture de base livrée', async () => {
    const [base, mask] = await Promise.all(
      ['earth_surface_2k.jpg', 'earth_spec_2k.jpg'].map((name) =>
        sharp(readFileSync(join(TEXTURES, name)))
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
      )
    );
    const { width, height } = base.info;
    const channels: number[][] = [[], [], []];
    for (
      let y = Math.floor(height / 6);
      y < Math.floor((5 * height) / 6);
      y++
    ) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        if (mask.data[i]! <= 250) continue;
        for (let k = 0; k < 3; k++) channels[k]!.push(base.data[i + k]!);
      }
    }
    const median = channels.map((values) => {
      values.sort((a, b) => a - b);
      return values[values.length >> 1]!;
    });
    median.forEach((value, k) =>
      expect(
        Math.abs(value - match!.baseSrgb[k]!),
        `canal ${k}`
      ).toBeLessThanOrEqual(2)
    );
  });
});
