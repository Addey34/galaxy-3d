import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CelestialBodyConfig } from '@/types';
import { OrbitalMechanics } from './OrbitalMechanics';

describe('OrbitalMechanics relative orbital elements', () => {
  it('uses the relative source for parent-relative bodies', () => {
    const mechanics = Object.create(
      OrbitalMechanics.prototype
    ) as OrbitalMechanics;
    const relativeElements = {
      semiMajorAxisAU: 0.008,
      eccentricity: 0,
      inclinationRad: 0,
      ascendingNodeRad: 0,
      argPerihelionRad: 0,
      meanAnomalyAtEpochRad: 0,
      epoch: new Date('2026-01-01T00:00:00Z'),
    };
    const absoluteElements = {
      ...relativeElements,
      semiMajorAxisAU: 2,
    };
    const getHeliocentricAU = vi.fn(
      (elements: { semiMajorAxisAU: number }) =>
        new THREE.Vector3(elements.semiMajorAxisAU, 0, 0)
    );
    Object.defineProperty(mechanics, 'horizons', {
      value: { getHeliocentricAU: vi.fn(() => null) },
    });
    Object.defineProperty(mechanics, 'elements', {
      value: { getHeliocentricAU },
    });
    const date = new Date('2026-08-09T00:00:00Z');
    const config = {
      kind: 'moon',
      frame: 'parentRelative',
      radius: 1,
      rotationSpeed: 0,
      orbitalColor: 0xffffff,
      textureResolutions: {},
      textures: {},
      relativeOrbitalElements: relativeElements,
      orbitalElements: absoluteElements,
    } as CelestialBodyConfig;
    const position = (
      mechanics as unknown as {
        _positionAU: (
          name: string,
          config: CelestialBodyConfig,
          date: Date
        ) => THREE.Vector3 | null;
      }
    )._positionAU('titan', config, date);

    expect(position?.x).toBe(0.008);
    expect(getHeliocentricAU).toHaveBeenCalledWith(relativeElements, date);
  });

  it('keeps every parent-relative body in the parent frame', () => {
    const mechanics = Object.create(
      OrbitalMechanics.prototype
    ) as OrbitalMechanics;
    const getHeliocentricAU = vi.fn(() => new THREE.Vector3(9, 0, 0));
    const getParentRelativeAU = vi.fn(() => new THREE.Vector3(0.001, 0, 0));
    Object.defineProperty(mechanics, '_parentName', {
      value: new Map([['moon', 'earth']]),
    });
    Object.defineProperty(mechanics, 'horizons', {
      value: { getHeliocentricAU, getParentRelativeAU },
    });
    Object.defineProperty(mechanics, 'elements', {
      value: { getHeliocentricAU: vi.fn() },
    });

    const config = {
      kind: 'moon',
      frame: 'parentRelative',
      radius: 0.1,
      textureResolutions: {},
      textures: {},
    } as CelestialBodyConfig;
    const date = new Date('2026-08-09T00:00:00Z');
    const position = (
      mechanics as unknown as {
        _positionAU: (
          name: string,
          config: CelestialBodyConfig,
          date: Date
        ) => THREE.Vector3 | null;
      }
    )._positionAU('moon', config, date);

    expect(position?.x).toBe(0.001);
    expect(getParentRelativeAU).toHaveBeenCalledWith('moon', 'earth', date);
    expect(getHeliocentricAU).not.toHaveBeenCalled();
  });

  it('rejects a precise vector outside the published parent orbit', () => {
    const mechanics = Object.create(
      OrbitalMechanics.prototype
    ) as OrbitalMechanics;
    const relativeElements = {
      semiMajorAxisAU: 0.008,
      eccentricity: 0,
      inclinationRad: 0,
      ascendingNodeRad: 0,
      argPerihelionRad: 0,
      meanAnomalyAtEpochRad: 0,
      epoch: new Date('2026-01-01T00:00:00Z'),
    };
    const getHeliocentricAU = vi.fn(() => new THREE.Vector3(0.008, 0, 0));
    Object.defineProperty(mechanics, '_parentName', {
      value: new Map([['moon', 'earth']]),
    });
    Object.defineProperty(mechanics, 'horizons', {
      value: {
        getHeliocentricAU: vi.fn(),
        getParentRelativeAU: vi.fn(() => new THREE.Vector3(1, 0, 0)),
      },
    });
    Object.defineProperty(mechanics, 'elements', {
      value: { getHeliocentricAU },
    });

    const config = {
      kind: 'moon',
      frame: 'parentRelative',
      radius: 0.1,
      textureResolutions: {},
      textures: {},
      relativeOrbitalElements: relativeElements,
    } as CelestialBodyConfig;
    const position = (
      mechanics as unknown as {
        _positionAU: (
          name: string,
          config: CelestialBodyConfig,
          date: Date
        ) => THREE.Vector3 | null;
      }
    )._positionAU('moon', config, new Date('2026-08-09T00:00:00Z'));

    expect(position?.x).toBe(0.008);
    expect(getHeliocentricAU).toHaveBeenCalledWith(
      relativeElements,
      expect.any(Date)
    );
  });
});
