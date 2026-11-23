import { describe, expect, it } from 'vitest';
import {
  AXIS_LABEL_PRIORITY,
  auRingLabelPriority,
  parsecRingLabelPriority,
  starLabelPriority,
  SUN_LABEL_PRIORITY,
} from './stellarLabels';

describe('la priorité des noms de la vue stellaire', () => {
  const extent = 5;
  const stars = [0, 1.3, 2.5, 4, 5, 8].map((d) => starLabelPriority(d, extent));

  it('le Soleil et l’axe passent avant tout, puis les étoiles, puis les repères', () => {
    const minStar = Math.min(...stars);
    const maxRing = Math.max(
      ...[1, 2, 3, 4, 5, 6, 9, 15].map(parsecRingLabelPriority),
      ...[0, 1, 2, 3, 4, 5, 6].map(auRingLabelPriority)
    );
    expect(SUN_LABEL_PRIORITY).toBeGreaterThan(AXIS_LABEL_PRIORITY);
    expect(AXIS_LABEL_PRIORITY).toBeGreaterThan(Math.max(...stars));
    // Un repère d'échelle ne masque jamais un nom d'étoile, même pour une étoile à la limite.
    expect(minStar).toBeGreaterThan(maxRing);
  });

  it('les étoiles sont ordonnées de la plus proche à la plus lointaine', () => {
    for (let i = 1; i < stars.length; i++)
      expect(stars[i]!).toBeLessThanOrEqual(stars[i - 1]!);
    expect(starLabelPriority(0, extent)).toBe(100);
    expect(starLabelPriority(extent, extent)).toBe(50);
  });

  it('les cercles de parsecs passent avant ceux d’UA, et chacun avant le suivant', () => {
    expect(parsecRingLabelPriority(5)).toBeLessThan(parsecRingLabelPriority(1));
    expect(auRingLabelPriority(5)).toBeLessThan(auRingLabelPriority(0));
    expect(Math.min(...[1, 9].map(parsecRingLabelPriority))).toBeGreaterThan(
      auRingLabelPriority(0)
    );
  });
});
