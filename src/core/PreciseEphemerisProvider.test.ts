import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SpiceEphemerisService } from './PreciseEphemerisProvider';

describe('SpiceEphemerisService', () => {
  it('maps heliocentric requests to the Sun-centered reader contract', () => {
    const calls: string[][] = [];
    const expected = new THREE.Vector3(1, 2, 3);
    const service = new SpiceEphemerisService({
      getPositionAU(targetName, centerName, date) {
        calls.push([targetName, centerName, date.toISOString()]);
        return expected;
      },
    });
    const date = new Date('2026-01-01T00:00:00Z');

    expect(service.getHeliocentricAU('triton', date)).toBe(expected);
    expect(calls).toEqual([['triton', 'sun', date.toISOString()]]);
  });

  it('preserves parent-centered vectors and missing-data nulls', () => {
    const service = new SpiceEphemerisService({
      getPositionAU(targetName, centerName) {
        if (targetName === 'charon' && centerName === 'pluto')
          return new THREE.Vector3(0.1, 0.2, 0.3);
        return null;
      },
    });

    expect(
      service.getParentRelativeAU(
        'charon',
        'pluto',
        new Date('2026-01-01T00:00:00Z')
      )
    ).toEqual(new THREE.Vector3(0.1, 0.2, 0.3));
    expect(
      service.getParentRelativeAU(
        'triton',
        'neptune',
        new Date('2026-01-01T00:00:00Z')
      )
    ).toBeNull();
  });
});
