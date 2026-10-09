import { describe, expect, it } from 'vitest';
import {
  deformToFigure,
  figureNormal,
  figureRadius,
  isSphere,
  type Figure,
} from './ellipsoid';
import { geographicToLocalDirection } from './frames';

// Saturne rapportée à son rayon équatorial : a = b = 1, c = 54 364 / 60 268.
const SATURN: Figure = { a: 1, b: 1, c: 54_364 / 60_268 };
// Un triaxial franc, pour distinguer les trois axes.
const TRIAXIAL: Figure = { a: 1.3, b: 1.1, c: 0.9 };

describe('l’ellipsoïde publié, dans le repère local du globe', () => {
  it('porte a vers la longitude 0, b vers 90° Est, c vers le pôle', () => {
    const at = (lat: number, lon: number): number => {
      const d = geographicToLocalDirection(lat, lon);
      return figureRadius(TRIAXIAL, d.x, d.y, d.z);
    };
    expect(at(0, 0)).toBeCloseTo(1.3, 12);
    expect(at(0, 180)).toBeCloseTo(1.3, 12);
    expect(at(0, 90)).toBeCloseTo(1.1, 12);
    expect(at(0, -90)).toBeCloseTo(1.1, 12);
    expect(at(90, 0)).toBeCloseTo(0.9, 12);
    expect(at(-90, 0)).toBeCloseTo(0.9, 12);
  });

  it('rend un point SUR l’ellipsoïde, dans toutes les directions', () => {
    for (const [lat, lon] of [
      [12, 34],
      [-61, 170],
      [45, -100],
    ] as const) {
      const d = geographicToLocalDirection(lat, lon);
      const r = figureRadius(TRIAXIAL, d.x, d.y, d.z);
      const x = d.x * r;
      const y = d.y * r;
      const z = d.z * r;
      expect(
        (x / TRIAXIAL.a) ** 2 + (z / TRIAXIAL.b) ** 2 + (y / TRIAXIAL.c) ** 2
      ).toBeCloseTo(1, 12);
    }
  });

  it('donne une normale perpendiculaire à la surface, qui n’est pas la direction', () => {
    // À 45° sur Saturne, la normale s'écarte de la direction de plus de 5° vers le pôle.
    const d = geographicToLocalDirection(45, 0);
    const n = figureNormal(SATURN, d.x, d.y, d.z);
    const angle =
      (Math.acos(n.x * d.x + n.y * d.y + n.z * d.z) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(5);
    expect(n.y).toBeGreaterThan(d.y);
    // Perpendiculaire à une petite corde le long du méridien.
    const step = (lat: number) => {
      const u = geographicToLocalDirection(lat, 0);
      const r = figureRadius(SATURN, u.x, u.y, u.z);
      return [u.x * r, u.y * r, u.z * r] as const;
    };
    const p = step(45.001);
    const q = step(44.999);
    const chord = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const dot = n.x * chord[0]! + n.y * chord[1]! + n.z * chord[2]!;
    expect(Math.abs(dot) / Math.hypot(...chord)).toBeLessThan(1e-6);
  });

  it('pousse chaque sommet LE LONG de sa direction : la latitude reste planétocentrique', () => {
    const d = geographicToLocalDirection(45, 30);
    const positions = new Float32Array([d.x * 2, d.y * 2, d.z * 2]);
    const normals = new Float32Array(3);
    deformToFigure(positions, normals, 2, SATURN);
    const length = Math.hypot(positions[0]!, positions[1]!, positions[2]!);
    expect(positions[0]! / length).toBeCloseTo(d.x, 6);
    expect(positions[1]! / length).toBeCloseTo(d.y, 6);
    expect(positions[2]! / length).toBeCloseTo(d.z, 6);
    expect(length).toBeCloseTo(2 * figureRadius(SATURN, d.x, d.y, d.z), 5);
    expect(Math.hypot(normals[0]!, normals[1]!, normals[2]!)).toBeCloseTo(1, 6);
  });

  it('reconnaît une sphère', () => {
    expect(isSphere({ a: 1, b: 1, c: 1 })).toBe(true);
    expect(isSphere(SATURN)).toBe(false);
  });
});
