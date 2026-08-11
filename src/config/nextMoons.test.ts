import { describe, expect, it } from 'vitest';
import { Body } from 'astronomy-engine';
import { CELESTIAL_CONFIG } from './bodies';

const NEXT_MOONS = [
  ['phobos', 'Phobos', 'mars', Body.Mars, 0.0000626680043, 0.3187],
  ['deimos', 'Deimos', 'mars', Body.Mars, 0.00015680036, 1.2625],
  ['triton', 'Triton', 'neptune', Body.Neptune, 0.00237169151, 5.876994],
  ['charon', 'Charon', 'pluto', undefined, 0.000131017908, 6.387222],
] as const;

/** Résolutions de surface réellement livrées par corps (voir public/assets/textures). */
const MOON_SURFACE_RES: Record<string, string[]> = {
  phobos: ['8k', '4k', '2k', '1k'],
  deimos: ['1k'],
  triton: ['8k', '4k', '2k', '1k'],
  charon: ['8k', '4k', '2k', '1k'],
};

describe('next planetary moon catalogue entries', () => {
  it.each(NEXT_MOONS)(
    'declares %s as a textured parent-relative moon',
    (key, displayName, parent, rotationBody, semiMajorAxisAU, periodDays) => {
      const moon = CELESTIAL_CONFIG.bodies[parent].satellites?.[key];

      expect(moon).toBeDefined();
      expect(moon?.kind).toBe('moon');
      expect(moon?.displayName?.en).toBe(displayName);
      expect(moon?.frame).toBe('parentRelative');
      expect(moon?.relativeEphemeris).toEqual({
        kind: 'horizonsParentRelative',
      });
      if (rotationBody !== undefined) {
        expect(moon?.rotationBody).toBe(rotationBody);
      }
      expect(moon?.relativeOrbitalElements?.semiMajorAxisAU).toBeCloseTo(
        semiMajorAxisAU,
        9
      );
      expect(moon?.textures?.surface).toBe(`${key}/${key}_surface`);
      expect(moon?.textureResolutions.surface).toEqual(MOON_SURFACE_RES[key]);
      expect(moon?.fallbackColor).toBeTypeOf('number');
      expect(moon?.realData?.orbitPeriodDays).toBeCloseTo(periodDays, 6);
    }
  );

  it.each(NEXT_MOONS)(
    'uses synchronous rotation for %s',
    (
      key,
      _displayName,
      parent,
      _rotationBody,
      _semiMajorAxisAU,
      periodDays
    ) => {
      const moon = CELESTIAL_CONFIG.bodies[parent].satellites![key];
      const rotationPeriodDays =
        (2 * Math.PI) / Math.abs(moon.rotationSpeed) / 86_400;

      expect(rotationPeriodDays).toBeCloseTo(periodDays, 6);
    }
  );
});
