import { describe, expect, it } from 'vitest';
import { OrbitalElementsService } from './OrbitalElementsService';
import type { OrbitalElements } from './kepler';

const service = new OrbitalElementsService();

const epoch = new Date('2000-01-01T12:00:00Z');

/** Orbite circulaire équatoriale (écliptique), périhélie sur +X, corps à l'époque. */
const flatCircle: OrbitalElements = {
  semiMajorAxisAU: 3,
  eccentricity: 0,
  inclinationRad: 0,
  ascendingNodeRad: 0,
  argPerihelionRad: 0,
  meanAnomalyAtEpochRad: 0,
  epoch,
};

describe('OrbitalElementsService', () => {
  it('maps an ecliptic-plane orbit onto the scene XZ plane (Y ≈ 0)', () => {
    const p = service.getHeliocentricAU(flatCircle, epoch);
    // Périhélie sur +X écliptique → +X scène ; plan écliptique → Y scène nul.
    expect(p.x).toBeCloseTo(3, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('preserves heliocentric distance through the frame mapping', () => {
    const D2R = Math.PI / 180;
    const inclined: OrbitalElements = {
      ...flatCircle,
      semiMajorAxisAU: 2.2,
      eccentricity: 0.25,
      inclinationRad: 17 * D2R,
      ascendingNodeRad: 40 * D2R,
      argPerihelionRad: 120 * D2R,
      meanAnomalyAtEpochRad: 200 * D2R,
    };
    const date = new Date(epoch.getTime() + 500 * 86_400_000);
    const p = service.getHeliocentricAU(inclined, date);
    const peri = 2.2 * (1 - 0.25);
    const aph = 2.2 * (1 + 0.25);
    expect(p.length()).toBeGreaterThanOrEqual(peri - 1e-6);
    expect(p.length()).toBeLessThanOrEqual(aph + 1e-6);
  });

  it('tilts an inclined orbit out of the scene XZ plane', () => {
    const D2R = Math.PI / 180;
    const inclined: OrbitalElements = {
      ...flatCircle,
      inclinationRad: 30 * D2R,
      argPerihelionRad: 90 * D2R,
    };
    const p = service.getHeliocentricAU(inclined, epoch);
    // Hors du plan écliptique → composante Y scène non nulle.
    expect(Math.abs(p.y)).toBeGreaterThan(0.1);
  });
});
