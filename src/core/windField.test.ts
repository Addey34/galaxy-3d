import { describe, expect, it } from 'vitest';
import {
  sampleWind,
  windGridFromScalars,
  windToUV,
  type WindGrid,
} from './windField';

describe("windToUV (météo: direction = d'où vient le vent)", () => {
  it('north wind (0°) blows toward the south → v negative', () => {
    const { u, v } = windToUV(10, 0);
    expect(Math.abs(u)).toBeLessThan(1e-6);
    expect(v).toBeCloseTo(-10, 5);
  });
  it('east wind (90°) blows toward the west → u negative', () => {
    const { u, v } = windToUV(10, 90);
    expect(u).toBeCloseTo(-10, 5);
    expect(Math.abs(v)).toBeLessThan(1e-6);
  });
  it('south wind (180°) blows toward the north → v positive', () => {
    const { v } = windToUV(10, 180);
    expect(v).toBeCloseTo(10, 5);
  });
  it('west wind (270°) blows toward the east → u positive', () => {
    const { u } = windToUV(10, 270);
    expect(u).toBeCloseTo(10, 5);
  });
});

describe('windGridFromScalars', () => {
  const scalar = (values: number[]) => ({
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat: 3,
    nLon: 4,
    values: Float32Array.from(values),
  });

  it('compose u/v point par point depuis vitesse et direction', () => {
    const grid = windGridFromScalars(
      scalar(Array(12).fill(10)),
      scalar([270, 0, ...Array(10).fill(90)])
    );
    // Vent d'ouest (270°) : l'air va vers l'est, u > 0.
    expect(grid.u[0]).toBeCloseTo(10, 4);
    // Vent du nord (0°) : l'air va vers le sud, v < 0.
    expect(grid.v[1]).toBeCloseTo(-10, 4);
    expect(grid.nLat).toBe(3);
    expect(grid.nLon).toBe(4);
  });

  it('refuse deux grilles qui ne viennent pas de la même requête', () => {
    expect(() =>
      windGridFromScalars(scalar(Array(12).fill(1)), {
        ...scalar(Array(12).fill(1)),
        step: 45,
      })
    ).toThrow(/désaccordées/);
  });
});

describe('sampleWind', () => {
  const grid: WindGrid = {
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat: 3,
    nLon: 4,
    u: new Float32Array(12).fill(5),
    v: new Float32Array(12).fill(-3),
  };

  it('returns the field value on a uniform grid', () => {
    const s = sampleWind(grid, 12, 34);
    expect(s.u).toBeCloseTo(5, 4);
    expect(s.v).toBeCloseTo(-3, 4);
  });

  it('interpolates between distinct cells', () => {
    const g = { ...grid, u: new Float32Array(12), v: new Float32Array(12) };
    // col 0 = 0, col 1 = 10 (à lonMin=-180 → col0 ; -90 → col1)
    for (let r = 0; r < 3; r++) {
      g.u[r * 4 + 0] = 0;
      g.u[r * 4 + 1] = 10;
    }
    // à mi-chemin entre lon -180 et -90 → u ≈ 5
    const s = sampleWind(g, 0, -135);
    expect(s.u).toBeCloseTo(5, 4);
  });

  it('wraps longitude across ±180', () => {
    const g = { ...grid, u: new Float32Array(12) };
    // dernière colonne (lon 90) = 8, première (lon -180) = 0 ; à lon 135 on interpole
    // entre col3 (90) et col0 (wrap -180) → défini, pas de crash.
    for (let r = 0; r < 3; r++) g.u[r * 4 + 3] = 8;
    const s = sampleWind(g, 0, 170);
    expect(Number.isFinite(s.u)).toBe(true);
  });
});
