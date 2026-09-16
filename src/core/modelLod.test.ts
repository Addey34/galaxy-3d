import { describe, expect, it } from 'vitest';
import {
  MODEL_LOD_DISTANCE,
  chooseModelQuality,
  lightestModelQuality,
} from './modelLod';
import type { ModelQuality } from './modelLod';

const ALL: ModelQuality[] = ['4k', '2k', '1k'];

describe('niveau de détail des modèles de forme', () => {
  it('ne charge le niveau fin que de près', () => {
    expect(chooseModelQuality(ALL, MODEL_LOD_DISTANCE.fine, '4k')).toBe('4k');
    expect(chooseModelQuality(ALL, MODEL_LOD_DISTANCE.fine + 1, '4k')).toBe(
      '2k'
    );
    expect(chooseModelQuality(ALL, MODEL_LOD_DISTANCE.medium + 1, '4k')).toBe(
      '1k'
    );
  });

  it('ne dépasse jamais le plafond du palier de qualité', () => {
    // Qualité basse : même collé au corps, jamais plus que 1k.
    expect(chooseModelQuality(ALL, 1, '1k')).toBe('1k');
    expect(chooseModelQuality(ALL, 1, '2k')).toBe('2k');
  });

  it('se rabat sur le plus fin DISPONIBLE, sans inventer de niveau', () => {
    // Ida n'a pas de 4k : sa source ne contient pas assez de détail.
    expect(chooseModelQuality(['2k', '1k'], 1, '4k')).toBe('2k');
    expect(chooseModelQuality(['2k'], 500, '4k')).toBe('2k');
    expect(chooseModelQuality([], 1, '4k')).toBeNull();
  });

  it('commence toujours par le plus léger livré', () => {
    expect(lightestModelQuality(ALL)).toBe('1k');
    expect(lightestModelQuality(['4k', '2k'])).toBe('2k');
  });
});
