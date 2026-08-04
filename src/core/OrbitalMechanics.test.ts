import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CelestialBodyConfig } from '@/types';
import {
  educationalParentOrbitScale,
  OrbitalMechanics,
} from './OrbitalMechanics';
import { SQRT_K } from './ScaleService';
import { CELESTIAL_CONFIG } from '@/config/bodies';

const DAY_MS = 86_400_000;

describe('OrbitalMechanics orbit sampling', () => {
  it('keeps Jupiter moons ordered and outside the enlarged educational Jupiter', () => {
    const jupiter = CELESTIAL_CONFIG.bodies.jupiter;
    const scale = educationalParentOrbitScale(jupiter);
    const radii = ['io', 'europa', 'ganymede', 'callisto'].map((name) => {
      const distanceAU = jupiter.satellites?.[name].realData?.distanceAU ?? 0;
      return Math.sqrt(distanceAU) * SQRT_K * scale;
    });

    expect(scale).toBeGreaterThan(1);
    expect(radii[0]).toBeGreaterThan(jupiter.radius);
    expect(radii[0]).toBeLessThan(radii[1]);
    expect(radii[1]).toBeLessThan(radii[2]);
    expect(radii[2]).toBeLessThan(radii[3]);
  });
  it('starts the Explo curve opposite the current body and closes it there', () => {
    const mechanics = Object.create(
      OrbitalMechanics.prototype
    ) as OrbitalMechanics;
    Object.defineProperty(mechanics, 'scale', { value: { mode: 'explo' } });
    Object.defineProperty(mechanics, '_positionAU', {
      value: (_name: string, _cfg: CelestialBodyConfig, date: Date) =>
        new THREE.Vector3(date.getTime() / DAY_MS, 0, 0),
    });

    const config = {
      kind: 'asteroid',
      radius: 0.1,
      rotationSpeed: 0,
      orbitalColor: 0xffffff,
      textureResolutions: {},
      textures: {},
      realData: { distanceAU: 2, orbitPeriodDays: 8 },
    } as CelestialBodyConfig;
    const date = new Date('2026-08-02T00:00:00Z');
    const points = mechanics.computeOrbitPoints('test', config, date, 4);

    expect(points).not.toBeNull();
    const seamStart = points![0];
    const seamEnd = points![12];
    expect(seamStart).toBeCloseTo((date.getTime() / DAY_MS - 4) * 35);
    expect(seamEnd).toBeCloseTo(seamStart);
    expect(seamStart).not.toBeCloseTo((date.getTime() / DAY_MS) * 35);
  });
  it('keeps real radial variation in compressed educational orbits', () => {
    const mechanics = Object.create(
      OrbitalMechanics.prototype
    ) as OrbitalMechanics;
    Object.defineProperty(mechanics, 'scale', { value: { mode: 'educ' } });
    Object.defineProperty(mechanics, '_positionAU', {
      value: (_name: string, _cfg: CelestialBodyConfig, date: Date) => {
        const phase = (date.getTime() / DAY_MS) % 8;
        return new THREE.Vector3(
          1.5 + 0.5 * Math.cos((phase / 8) * Math.PI * 2),
          0,
          0
        );
      },
    });
    const config = { realData: { orbitPeriodDays: 8 } } as CelestialBodyConfig;
    const points = mechanics.computeOrbitPoints(
      'test',
      config,
      new Date('2026-08-02T00:00:00Z'),
      8
    );
    const radii = [0, 1, 2, 3].map((i) => Math.abs(points![i * 3]));
    expect(
      new Set(radii.map((radius) => radius.toFixed(6))).size
    ).toBeGreaterThan(1);
  });
});
