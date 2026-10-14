import { describe, expect, it } from 'vitest';
import { REALTIME_CLOUDS_SETTINGS } from '@/config/engine';
import { srgbByteToLinear } from './srgb';

describe('décodage sRGB', () => {
  it('suit la norme aux bornes et au coude', () => {
    expect(srgbByteToLinear(0)).toBe(0);
    expect(srgbByteToLinear(255)).toBeCloseTo(1, 12);
    // 10/255 est sous le coude (0,04045) : partie linéaire.
    expect(srgbByteToLinear(10)).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(srgbByteToLinear(128)).toBeCloseTo(0.2158605, 6);
  });
});

describe('disponibilité optique des nuages du jour (2026-10-14)', () => {
  // Le shader compare la moyenne de cinq voisins, lue en LINÉAIRE (texture sRGB décodée par le
  // GPU), à une fenêtre smoothstep. Bornes MESURÉES sur VIIRS du 2026-10-10 (2 048 x 1 024) :
  // l'absence de donnée tient à 0-3 sur 255, l'océan clair observé commence vers 24.
  const NO_DATA_MAX_SRGB = 3;
  const DARKEST_OCEAN_SRGB = 24;
  const smoothstep = (a: number, b: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const availability = (byte: number): number =>
    smoothstep(
      srgbByteToLinear(
        REALTIME_CLOUDS_SETTINGS.cloudOpticalAvailabilityLowSrgb
      ),
      srgbByteToLinear(
        REALTIME_CLOUDS_SETTINGS.cloudOpticalAvailabilityHighSrgb
      ),
      srgbByteToLinear(byte)
    );

  it("tient l'océan le plus sombre pour observé", () => {
    // Sous l'ancienne fenêtre (0,02 → 0,12 lue en linéaire), cet océan valait 0 : MODIS le
    // peignait de ses cellules de ~20 km.
    expect(availability(DARKEST_OCEAN_SRGB)).toBe(1);
  });

  it("tient l'absence de donnée pour non observée", () => {
    expect(availability(NO_DATA_MAX_SRGB)).toBe(0);
  });
});
