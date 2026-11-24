import { describe, expect, it } from 'vitest';
import {
  MODEL_LOD_DISTANCE,
  chooseModelQuality,
  apparentDiameterPx,
  isNearView,
  lightestModelQuality,
  MODEL_LOAD_DISTANCE,
  MODEL_VIEW_MARGIN,
  shouldLoadShapeModel,
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

describe('le seuil de chargement d’un maillage (GAL-ENGINE-HEADROOM-001)', () => {
  it('à ce seuil le corps mesure moins de 2 pixels, et sa forme ne se lit qu’à plus de 4 fois cette proximité', () => {
    const px = apparentDiameterPx(MODEL_LOAD_DISTANCE, 900, 45);
    expect(px).toBeGreaterThan(1.5);
    expect(px).toBeLessThan(2);
    // 8 pixels : le seuil de lisibilité d'une forme.
    const readable = [...Array(5000).keys()].find(
      (n) => n > 0 && apparentDiameterPx(n, 900, 45) < 8
    )!;
    expect(MODEL_LOAD_DISTANCE / readable).toBeGreaterThan(4);
  });

  it('vue d’ensemble du mode Éducatif (1 846 à 8 960 rayons, mesuré) : rien ne se charge', () => {
    for (const n of [1846, 2399, 3000, 5118, 8960])
      expect(shouldLoadShapeModel(n, null, true), `${n} rayons`).toBe(false);
  });

  it('ne charge que près ET dans le champ ; un niveau déjà chargé reste', () => {
    expect(shouldLoadShapeModel(MODEL_LOAD_DISTANCE, null, true)).toBe(true);
    expect(shouldLoadShapeModel(MODEL_LOAD_DISTANCE + 1, null, true)).toBe(
      false
    );
    // Près mais derrière la caméra ou loin sur le côté : rien.
    expect(shouldLoadShapeModel(100, null, false)).toBe(false);
    // Déjà là : on garde la possibilité de changer de niveau, où qu'il soit.
    expect(shouldLoadShapeModel(1e9, '1k', false)).toBe(true);
  });

  it('isNearView : devant la caméra et jusqu’à la marge, jamais derrière', () => {
    expect(isNearView(0, 0, 0.5)).toBe(true);
    expect(isNearView(MODEL_VIEW_MARGIN, 0, 0.5)).toBe(true);
    expect(isNearView(MODEL_VIEW_MARGIN + 0.01, 0, 0.5)).toBe(false);
    expect(isNearView(0, -MODEL_VIEW_MARGIN - 0.01, 0.5)).toBe(false);
    expect(isNearView(0, 0, 1.2)).toBe(false);
    expect(isNearView(0, 0, -1.2)).toBe(false);
  });
});
