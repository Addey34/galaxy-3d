import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CelestialBodyConfig } from '@/types';
import { OrbitalMechanics } from './OrbitalMechanics';

const DAY_MS = 86_400_000;

describe('OrbitalMechanics orbit sampling', () => {
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
    expect(seamStart).not.toBeCloseTo(
      (date.getTime() / DAY_MS) * 35
    );
  });
});
