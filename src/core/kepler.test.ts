import { describe, expect, it } from 'vitest';
import {
  hyperbolicPerihelionDate,
  keplerianPositionEcliptic,
  sampleHyperbolicTrajectory,
  solveHyperbolicKepler,
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

  it('clamps out-of-range eccentricities instead of diverging', () => {
    // e >= 1 n'a pas de sens pour cette forme elliptique (l'hyperbole a son propre solveur) :
    // le solveur doit rester fini et stable plutôt que diverger silencieusement.
    expect(Number.isFinite(solveKepler(1.0, 1))).toBe(true);
    expect(Number.isFinite(solveKepler(1.0, 5))).toBe(true);
    expect(Number.isFinite(solveKepler(1.0, -0.2))).toBe(true);
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

describe('solveHyperbolicKepler', () => {
  it('satisfies M = e·sinh(F) − F from near-parabolic to strongly hyperbolic', () => {
    for (const e of [1.0001, 1.2, 3.36, 6.14, 20]) {
      for (const M of [-1e4, -500, -10, -1, -1e-3, 0, 1e-3, 1, 10, 500, 1e4]) {
        const F = solveHyperbolicKepler(M, e);
        const residual = e * Math.sinh(F) - F - M;
        expect(Math.abs(residual), `e=${e}, M=${M}: F=${F}`).toBeLessThan(
          1e-9 * Math.max(1, Math.abs(M))
        );
      }
    }
  });

  it('never reduces the mean anomaly modulo 2π (an open path does not come back)', () => {
    // 3I/ATLAS : M = 818° à son époque Horizons. La réduire comme on le fait pour une
    // ellipse (818° → 98°) placerait le corps à une tout autre distance.
    const e = 6.14;
    const M = 818 * (Math.PI / 180);
    const reduced = M - 4 * Math.PI;
    expect(solveHyperbolicKepler(M, e)).not.toBeCloseTo(
      solveHyperbolicKepler(reduced, e),
      2
    );
  });

  it('is odd in (F, M): inbound and outbound legs mirror each other', () => {
    expect(solveHyperbolicKepler(-37, 2.5)).toBeCloseTo(
      -solveHyperbolicKepler(37, 2.5),
      12
    );
  });

  it('refuses e ≤ 1 instead of returning a plausible wrong answer', () => {
    expect(() => solveHyperbolicKepler(1, 1)).toThrow(RangeError);
    expect(() => solveHyperbolicKepler(1, 0.5)).toThrow(RangeError);
    expect(() => solveHyperbolicKepler(1, Number.NaN)).toThrow(RangeError);
  });
});

/** Hyperbole dans le plan de l'écliptique, périhélie sur +X, passage au périhélie à l'époque. */
function hyperbolicElements(
  overrides: Partial<OrbitalElements> = {}
): OrbitalElements {
  return circularElements({
    semiMajorAxisAU: -1.5,
    eccentricity: 2,
    ...overrides,
  });
}

const DAY_MS = 86_400_000;

describe('keplerianPositionEcliptic — hyperbolic branch (e > 1)', () => {
  it('passes perihelion at q = |a|·(e − 1) on +X when M0 = 0', () => {
    const el = hyperbolicElements();
    const p = keplerianPositionEcliptic(el, el.epoch);
    expect(p.x).toBeCloseTo(1.5 * (2 - 1), 12);
    expect(p.y).toBeCloseTo(0, 12);
    expect(p.z).toBeCloseTo(0, 12);
  });

  it('moves prograde through perihelion (+Y after, −Y before)', () => {
    const el = hyperbolicElements();
    const after = keplerianPositionEcliptic(
      el,
      new Date(el.epoch.getTime() + 10 * DAY_MS)
    );
    const before = keplerianPositionEcliptic(
      el,
      new Date(el.epoch.getTime() - 10 * DAY_MS)
    );
    expect(after.y).toBeGreaterThan(0);
    expect(before.y).toBeLessThan(0);
    expect(Math.hypot(after.x, after.y)).toBeCloseTo(
      Math.hypot(before.x, before.y),
      9
    );
  });

  it('approaches the asymptote ν∞ = arccos(−1/e) far from the Sun', () => {
    const el = hyperbolicElements();
    const far = keplerianPositionEcliptic(
      el,
      new Date(el.epoch.getTime() + 1e6 * DAY_MS)
    );
    const trueAnomaly = Math.atan2(far.y, far.x);
    expect(trueAnomaly).toBeLessThan(Math.acos(-1 / 2));
    expect(trueAnomaly).toBeGreaterThan(Math.acos(-1 / 2) - 0.01);
  });

  it('keeps the vis-viva energy of a hyperbola (v² = μ·(2/r + 1/|a|))', () => {
    // Vitesse par différence finie : relie la cadence (mouvement moyen de Gauss) à la
    // géométrie (|a|, e). Une erreur de n ou de la forme de r casse cette égalité.
    const el = hyperbolicElements({
      semiMajorAxisAU: -0.85,
      eccentricity: 3.36,
    });
    const mu = 0.01720209895 ** 2;
    for (const days of [-400, -30, 5, 90, 2000]) {
      const t = el.epoch.getTime() + days * DAY_MS;
      const h = 1e-3;
      const p0 = keplerianPositionEcliptic(el, new Date(t - h * DAY_MS));
      const p1 = keplerianPositionEcliptic(el, new Date(t + h * DAY_MS));
      const p = keplerianPositionEcliptic(el, new Date(t));
      const v = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z) / (2 * h);
      const r = Math.hypot(p.x, p.y, p.z);
      expect(v * v).toBeCloseTo(mu * (2 / r + 1 / 0.85), 8);
    }
  });

  it('derives the perihelion date from the epoch and mean anomaly', () => {
    const el = hyperbolicElements({ meanAnomalyAtEpochRad: 0.4 });
    const perihelion = hyperbolicPerihelionDate(el);
    expect(perihelion.getTime()).toBeLessThan(el.epoch.getTime());
    const p = keplerianPositionEcliptic(el, perihelion);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1.5, 9);
  });
});

describe('sampleHyperbolicTrajectory', () => {
  it('starts and ends exactly on the body at the window edges', () => {
    const el = hyperbolicElements({ meanAnomalyAtEpochRad: 3 });
    const from = new Date('1990-01-01T00:00:00Z');
    const to = new Date('2010-01-01T00:00:00Z');
    const points = sampleHyperbolicTrajectory(el, from, to, 64);
    expect(points).toHaveLength(64);
    for (const [point, date] of [
      [points[0], from],
      [points[63], to],
    ] as const) {
      const body = keplerianPositionEcliptic(el, date);
      expect(point.x).toBeCloseTo(body.x, 9);
      expect(point.y).toBeCloseTo(body.y, 9);
      expect(point.z).toBeCloseTo(body.z, 9);
    }
  });

  it('keeps every sample on the conic r = |a|·(e·cosh F − 1) ≥ q', () => {
    const el = hyperbolicElements({
      inclinationRad: 1.1,
      ascendingNodeRad: 0.7,
      argPerihelionRad: 2.2,
    });
    const from = new Date(el.epoch.getTime() - 3000 * DAY_MS);
    const to = new Date(el.epoch.getTime() + 3000 * DAY_MS);
    for (const p of sampleHyperbolicTrajectory(el, from, to, 257)) {
      expect(Math.hypot(p.x, p.y, p.z)).toBeGreaterThanOrEqual(1.5 - 1e-12);
    }
  });
});
