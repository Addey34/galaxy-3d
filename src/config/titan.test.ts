import { describe, expect, it } from 'vitest';
import { Body } from 'astronomy-engine';
import { CELESTIAL_CONFIG } from './bodies';

describe('Titan catalogue entry', () => {
  it('declares a textured parent-relative Saturnian moon', () => {
    const titan = CELESTIAL_CONFIG.bodies.saturn.satellites?.titan;

    expect(titan).toBeDefined();
    expect(titan?.kind).toBe('moon');
    expect(titan?.frame).toBe('parentRelative');
    expect(titan?.rotationBody).toBe(Body.Saturn);
    expect(titan?.relativeOrbitalElements?.semiMajorAxisAU).toBeCloseTo(
      0.008167897,
      9
    );
    expect(titan?.relativeOrbitalElements?.eccentricity).toBe(0.029);
    expect(titan?.textures?.surface).toBe('titan/titan_surface');
    expect(titan?.textureResolutions.surface).toEqual(['1k']);
    expect(titan?.fallbackColor).toBeTypeOf('number');
    expect(titan?.realData?.radiusKm).toBeCloseTo(2_574.76, 2);
    expect(titan?.realData?.orbitPeriodDays).toBeCloseTo(15.945448, 6);
  });

  it('uses a synchronous rotation period', () => {
    const titan = CELESTIAL_CONFIG.bodies.saturn.satellites!.titan;
    const rotationPeriodDays =
      (2 * Math.PI) / Math.abs(titan.rotationSpeed) / 86_400;

    expect(rotationPeriodDays).toBeCloseTo(
      titan.realData?.orbitPeriodDays ?? 0,
      6
    );
  });
});
