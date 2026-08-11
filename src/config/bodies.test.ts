import { describe, expect, it } from 'vitest';
import { Body } from 'astronomy-engine';
import { CELESTIAL_CONFIG } from './bodies';

describe('Jupiter Galilean moons catalogue', () => {
  it('declares the four astronomy-engine jovian sources as parent-relative bodies', () => {
    const jupiter = CELESTIAL_CONFIG.bodies.jupiter;
    const expected = ['io', 'europa', 'ganymede', 'callisto'] as const;

    for (const name of expected) {
      const moon = jupiter.satellites?.[name];
      expect(moon).toBeDefined();
      expect(moon?.kind).toBe('moon');
      expect(moon?.frame).toBe('parentRelative');
      expect(moon?.relativeEphemeris).toEqual({
        kind: 'jupiterMoon',
        moon: name,
      });
      expect(moon?.rotationBody).toBe(Body.Jupiter);
      expect(moon?.fallbackColor).toBeTypeOf('number');
      expect(moon?.textures?.surface).toBe(name + '/' + name + '_surface');
      expect(moon?.textureResolutions.surface).toEqual([
        '8k',
        '4k',
        '2k',
        '1k',
      ]);
      expect(moon?.realData?.radiusKm).toBeGreaterThan(1_000);
      expect(moon?.realData?.orbitPeriodDays).toBeGreaterThan(1);
    }
  });
  it('keeps each Galilean moon synchronously locked to its orbit', () => {
    const jupiter = CELESTIAL_CONFIG.bodies.jupiter;
    const names = ['io', 'europa', 'ganymede', 'callisto'] as const;
    const distances = names.map(
      (name) => jupiter.satellites?.[name].realData?.distanceAU ?? 0
    );

    expect(distances[0]).toBeLessThan(distances[1]);
    expect(distances[1]).toBeLessThan(distances[2]);
    expect(distances[2]).toBeLessThan(distances[3]);

    for (const name of names) {
      const moon = jupiter.satellites?.[name];
      const orbitPeriodDays = moon?.realData?.orbitPeriodDays ?? 0;
      const rotationPeriodDays =
        (2 * Math.PI) / Math.abs(moon?.rotationSpeed ?? 0) / 86_400;
      expect(rotationPeriodDays).toBeCloseTo(orbitPeriodDays, 2);
    }
  });
});
