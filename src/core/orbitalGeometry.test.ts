import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { angleInOrbitalPlane, orbitalPositionEduc } from './orbitalGeometry';

describe('orbitalPositionEduc', () => {
  it('places angle 0 (i=0, Ω=0) at (r, 0, 0)', () => {
    const p = orbitalPositionEduc(35, 0, 0, 0);
    expect(p.x).toBeCloseTo(35, 12);
    expect(p.y).toBeCloseTo(0, 12);
    expect(p.z).toBeCloseTo(0, 12);
  });

  it('is prograde — angle π/2 (flat orbit) goes to -Z', () => {
    const p = orbitalPositionEduc(35, Math.PI / 2, 0, 0);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.z).toBeCloseTo(-35, 12);
  });

  it('keeps the orbit radius regardless of inclination / node', () => {
    const p = orbitalPositionEduc(12, 1.1, 0.4, 2.3);
    expect(p.length()).toBeCloseTo(12, 12);
  });

  it('lifts the orbit out of the XZ plane when inclined', () => {
    const p = orbitalPositionEduc(10, Math.PI / 2, 0.5, 0);
    expect(p.y).toBeCloseTo(10 * Math.sin(0.5), 12);
  });
});

describe('angleInOrbitalPlane (inverse of orbitalPositionEduc)', () => {
  const norm = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

  it('round-trips the angle for a range of elements', () => {
    const cases: Array<[number, number, number]> = [
      [0.3, 0.12, 0.0],
      [1.9, 0.05, 1.2],
      [-2.1, 0.4, 2.7],
      [Math.PI / 4, 0, 0],
    ];
    for (const [angle, inc, node] of cases) {
      const pos = orbitalPositionEduc(9, angle, inc, node);
      expect(norm(angleInOrbitalPlane(pos, inc, node))).toBeCloseTo(norm(angle), 10);
    }
  });

  it('accepts a plain scene Vector3', () => {
    const pos = new THREE.Vector3().copy(orbitalPositionEduc(5, 0, 0, 0));
    expect(angleInOrbitalPlane(pos, 0, 0)).toBeCloseTo(0, 10);
  });
});
