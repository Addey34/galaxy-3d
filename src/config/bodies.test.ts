import { describe, expect, it } from 'vitest';
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
      expect(moon?.fallbackColor).toBeTypeOf('number');
      expect(moon?.textures.surface).toBe(name + '/' + name + 'Surface');
      expect(moon?.textureResolutions.surface).toEqual(['2k', '1k']);
      expect(moon?.realData?.radiusKm).toBeGreaterThan(1_000);
      expect(moon?.realData?.orbitPeriodDays).toBeGreaterThan(1);
    }
  });
});
