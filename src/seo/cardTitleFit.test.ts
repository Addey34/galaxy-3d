import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  TEXT_RIGHT_MARGIN,
  cardTextSvg,
} from './socialCard';

/**
 * LE TITRE D'UNE VIGNETTE NE DÉBORDE PAS, MESURÉ PAR UN RENDU (2026-10-03).
 *
 * Trouvé en REGARDANT la vignette de 1I/ʻOumuamua : son nom, écrit à 84 px comme celui d'un corps,
 * franchissait le bord droit. La taille est désormais choisie d'après une estimation de largeur,
 * et une estimation ne se juge pas elle-même : ce fichier rasterise le texte de chaque vignette
 * avec la même bibliothèque que le build et exige qu'aucun pixel n'entre dans la marge droite.
 * Les corps sont inclus : leur titre doit rester tel qu'il était, et tenir.
 */
const names = [
  ...[...flattenBodies(CELESTIAL_CONFIG)]
    .filter(([, cfg]) => cfg.kind !== 'skybox')
    .map(([name, cfg]) => cfg.displayName?.en ?? name),
  ...[...NAVIGABLE_TARGETS.values()].map((cfg) => cfg.displayName?.en),
].filter((name): name is string => typeof name === 'string');

/** Colonne la plus à droite qui porte un pixel du texte, sur toute la hauteur de la vignette. */
async function rightmostInk(svg: string): Promise<number> {
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let right = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = info.width - 1; x > right; x--)
      if (data[(y * info.width + x) * info.channels + 3]! > 32) {
        right = x;
        break;
      }
  return right;
}

describe('le titre d’une vignette tient dans sa colonne', () => {
  it('couvre les corps ET les objets d’instrument, dont les noms les plus longs', () => {
    expect(names).toContain('James Webb Space Telescope');
    expect(names).toContain('1I/ʻOumuamua');
    expect(names.length).toBeGreaterThan(60);
  });

  /**
   * La garde de la marge est vide de sens pour un titre INVISIBLE : aucun pixel, aucun
   * débordement. Payé le 2026-10-06 : « Churyumov–Gerasimenko », un seul mot de 21 caractères,
   * ne trouvait aucune espace où se couper et sortait en `font-size="0"`, vu en regardant sa
   * vignette. Ce test exige que chaque nom soit ÉCRIT en entier, à une taille lisible.
   */
  it('chaque titre est écrit en entier, à une taille lisible', () => {
    const MIN_TITLE_PX = 40;
    const bad: string[] = [];
    for (const name of names) {
      const svg = cardTextSvg(name, [], 'example.test', '');
      const titles = [
        ...svg.matchAll(
          /<text [^>]*font-size="(\d+)" font-weight="700"[^>]*>([^<]*)<\/text>/g
        ),
      ];
      const sizes = titles.map((m) => Number(m[1]));
      const written = titles
        .map((m) => m[2]!.replace(/&amp;/g, '&'))
        .join(' ')
        .replace(/([–-]) /g, '$1');
      if (sizes.some((s) => s < MIN_TITLE_PX) || written !== name)
        bad.push(`${name} : tailles ${sizes.join(',')}, écrit « ${written} »`);
    }
    expect(bad).toEqual([]);
  });

  it('aucun titre n’entre dans la marge droite', async () => {
    const limit = CARD_WIDTH - TEXT_RIGHT_MARGIN;
    const over: string[] = [];
    for (const name of names) {
      const right = await rightmostInk(
        cardTextSvg(name, [], 'example.test', '')
      );
      if (right >= limit) over.push(`${name} : jusqu'à x=${right}`);
    }
    expect(over).toEqual([]);
    expect(CARD_HEIGHT).toBe(630);
  }, 120_000);
});
