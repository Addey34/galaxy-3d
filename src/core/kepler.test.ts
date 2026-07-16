import { describe, expect, it } from 'vitest';
import {
  keplerianPositionEcliptic,
  solveKepler,
  type OrbitalElements,
} from './kepler';

describe('solveKepler', () => {
  it('satisfies M = E - e·sin(E) across anomalies and eccentricities', () => {
    for (const e of [0, 0.1, 0.5, 0.8, 0.97]) {
      for (let k = 0; k < 12; k++) {
        const M = -Math.PI + (k / 11) * 2 * Math.PI;
        const E = solveKepler(M, e);
        const residual = E - e * Math.sin(E) - M;
        // Kepler doit être résolue à la précision machine.
        expect(
          Math.abs(Math.atan2(Math.sin(residual), Math.cos(residual)))
        ).toBeLessThan(1e-10);
      }
    }
  });

  it('returns E = M for a circular orbit (e = 0)', () => {
    expect(solveKepler(1.23, 0)).toBeCloseTo(1.23, 12);
  });
});

/** Orbite circulaire dans le plan de l'écliptique, périhélie sur +X. */
function circularElements(
  overrides: Partial<OrbitalElements> = {}
): OrbitalElements {
  return {
    semiMajorAxisAU: 1,
    eccentricity: 0,
    inclinationRad: 0,
    ascendingNodeRad: 0,
    argPerihelionRad: 0,
    meanAnomalyAtEpochRad: 0,
    epoch: new Date('2000-01-01T12:00:00Z'),
    ...overrides,
  };
}

describe('keplerianPositionEcliptic', () => {
  it('places a body at perihelion on +X at epoch (M0 = 0)', () => {
    const el = circularElements({ semiMajorAxisAU: 2, eccentricity: 0.3 });
    const p = keplerianPositionEcliptic(el, el.epoch);
    // Périhélie : distance = a(1 - e), le long de la direction du périhélie (+X ici).
    expect(p.x).toBeCloseTo(2 * (1 - 0.3), 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('keeps a circular orbit at constant radius a', () => {
    const el = circularElements({ semiMajorAxisAU: 1.6 });
    for (let d = 0; d < 400; d += 37) {
      const p = keplerianPositionEcliptic(
        el,
        new Date(el.epoch.getTime() + d * 86_400_000)
      );
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1.6, 6);
    }
  });

  it('returns to the same position after one orbital period', () => {
    const el = circularElements({ semiMajorAxisAU: 2.5, eccentricity: 0.4 });
    // Troisième loi de Kepler : période (jours) = 365.25 · a^1.5.
    const periodDays = 365.256 * Math.pow(2.5, 1.5);
    const p0 = keplerianPositionEcliptic(el, el.epoch);
    const p1 = keplerianPositionEcliptic(
      el,
      new Date(el.epoch.getTime() + periodDays * 86_400_000)
    );
    expect(p1.x).toBeCloseTo(p0.x, 3);
    expect(p1.y).toBeCloseTo(p0.y, 3);
    expect(p1.z).toBeCloseTo(p0.z, 3);
  });

  it('inclination tilts the orbit out of the ecliptic plane', () => {
    // Nœud ascendant sur +X (Ω=0), inclinaison 30° : à 90° après le nœud le corps est
    // au-dessus du plan (z > 0).
    const el = circularElements({
      inclinationRad: (30 * Math.PI) / 180,
      argPerihelionRad: Math.PI / 2,
    });
    const p = keplerianPositionEcliptic(el, el.epoch);
    expect(p.z).toBeGreaterThan(0);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 6);
  });

  it('keeps Ceres within its perihelion–aphelion range over a full orbit', () => {
    // Éléments de (1) Cérès, époque J2000 (valeurs JPL approximatives).
    const D2R = Math.PI / 180;
    const ceres: OrbitalElements = {
      semiMajorAxisAU: 2.7691,
      eccentricity: 0.076,
      inclinationRad: 10.594 * D2R,
      ascendingNodeRad: 80.305 * D2R,
      argPerihelionRad: 73.597 * D2R,
      meanAnomalyAtEpochRad: 95.989 * D2R,
      epoch: new Date('2000-01-01T12:00:00Z'),
    };
    const peri = ceres.semiMajorAxisAU * (1 - ceres.eccentricity);
    const aph = ceres.semiMajorAxisAU * (1 + ceres.eccentricity);
    for (let d = 0; d < 1_682; d += 40) {
      const p = keplerianPositionEcliptic(
        ceres,
        new Date(ceres.epoch.getTime() + d * 86_400_000)
      );
      const r = Math.hypot(p.x, p.y, p.z);
      expect(r).toBeGreaterThanOrEqual(peri - 1e-3);
      expect(r).toBeLessThanOrEqual(aph + 1e-3);
    }
  });
});
