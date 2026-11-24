import { describe, expect, it } from 'vitest';
import { fitDistance, turn, zoom, FIT_MARGIN } from './craftFit';

describe('fitDistance', () => {
  it('place la sphère juste dans le champ : tan(demi-champ) = rayon / distance', () => {
    const d = fitDistance(1, 40, 2);
    // Le champ vertical décide quand l'écran est plus large que haut.
    expect(d).toBeCloseTo(FIT_MARGIN / Math.sin((20 * Math.PI) / 180), 10);
  });

  it('un écran étroit (téléphone en portrait) recule plus qu’un écran large', () => {
    expect(fitDistance(1, 40, 0.5)).toBeGreaterThan(fitDistance(1, 40, 2));
  });

  it('est proportionnelle au rayon', () => {
    expect(fitDistance(3, 40, 1.5)).toBeCloseTo(
      3 * fitDistance(1, 40, 1.5),
      10
    );
  });
});

describe('turn et zoom', () => {
  const pose = { azimuth: 0, polar: 1, distance: 5 };

  it('l’azimut est libre, le pôle ne se retourne jamais', () => {
    expect(turn(pose, 10, 0).azimuth).toBe(10);
    expect(turn(pose, 0, 100).polar).toBeLessThan(Math.PI);
    expect(turn(pose, 0, -100).polar).toBeGreaterThan(0);
  });

  it('le zoom reste dans ses bornes et ne modifie pas la pose reçue', () => {
    expect(zoom(pose, 0.01, 2, 9).distance).toBe(2);
    expect(zoom(pose, 100, 2, 9).distance).toBe(9);
    expect(pose.distance).toBe(5);
  });
});
