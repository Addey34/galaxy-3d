import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  educRadius,
  exploCameraDistance,
  KM_PER_AU,
  ScaleService,
  SQRT_K,
} from './ScaleService';

describe('ScaleService.auToScene', () => {
  it('calibrates Earth (1 AU) to SQRT_K units in both modes', () => {
    const s = new ScaleService();
    s.mode = 'educ';
    expect(s.auToScene(1)).toBeCloseTo(SQRT_K, 12);
    s.mode = 'explo';
    expect(s.auToScene(1)).toBeCloseTo(SQRT_K, 12);
  });

  it('compresses with √ in educ mode and stays linear in explo mode', () => {
    const s = new ScaleService();
    s.mode = 'educ';
    expect(s.auToScene(4)).toBeCloseTo(2 * SQRT_K, 12); // √4 = 2
    s.mode = 'explo';
    expect(s.auToScene(4)).toBeCloseTo(4 * SQRT_K, 12);
  });

  it('clamps negative distances to 0', () => {
    const s = new ScaleService();
    expect(s.auToScene(-5)).toBe(0);
  });
});

describe('ScaleService.auVectorToScene', () => {
  it('preserves direction and scales magnitude', () => {
    const s = new ScaleService();
    s.mode = 'explo';
    const out = s.auVectorToScene(new THREE.Vector3(3, 0, 0));
    expect(out.x).toBeCloseTo(3 * SQRT_K, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(0, 12);
  });

  it('returns origin for a ~zero vector', () => {
    const s = new ScaleService();
    const out = s.auVectorToScene(new THREE.Vector3(0, 0, 0));
    expect(out.equals(new THREE.Vector3(0, 0, 0))).toBe(true);
  });
});

describe('helpers', () => {
  it('educRadius uses the √ (educ) scale', () => {
    expect(educRadius(1)).toBeCloseTo(SQRT_K, 12);
    expect(educRadius(9)).toBeCloseTo(3 * SQRT_K, 12);
  });

  it('exploCameraDistance derives from physical radius in km', () => {
    // Terre : 6371 km → (6371 / KM_PER_AU) × SQRT_K × 7
    expect(exploCameraDistance(6371)).toBeCloseTo((6371 / KM_PER_AU) * SQRT_K * 7, 12);
  });
});
