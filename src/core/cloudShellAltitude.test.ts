import { describe, expect, it } from 'vitest';
import {
  cloudShellAltitudeKm,
  cloudShellScale,
  SHELL_NEAR_FROM_KM,
  SHELL_NEAR_KM,
  SHELL_ORBIT_FROM_KM,
  SHELL_ORBIT_KM,
} from './cloudShellAltitude';

describe('altitude de la coque des nuages', () => {
  it('ne change rien vue de l\u2019orbite : 1,01 rayon au-dessus de 2 500 km', () => {
    expect(cloudShellAltitudeKm(50_000)).toBe(SHELL_ORBIT_KM);
    expect(cloudShellAltitudeKm(SHELL_ORBIT_FROM_KM)).toBe(SHELL_ORBIT_KM);
    expect(cloudShellScale(8_000, 6371, 1.01)).toBeCloseTo(1, 4);
  });

  it('descend à 10 km de près, et reste SOUS la caméra pendant la descente', () => {
    expect(cloudShellAltitudeKm(SHELL_NEAR_FROM_KM)).toBe(SHELL_NEAR_KM);
    for (const camera of [2400, 1264, 800, 499, 195, 75, 27, 12])
      expect(cloudShellAltitudeKm(camera)).toBeLessThan(camera);
  });

  it('est monotone et lisse entre les deux bornes', () => {
    let previous = cloudShellAltitudeKm(SHELL_NEAR_FROM_KM);
    for (
      let alt = SHELL_NEAR_FROM_KM;
      alt <= SHELL_ORBIT_FROM_KM;
      alt *= 1.05
    ) {
      const now = cloudShellAltitudeKm(alt);
      expect(now).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(now - previous).toBeLessThan(3); // pas de saut d'un cran de molette à l'autre
      previous = now;
    }
  });

  it('ignore une altitude non finie', () => {
    expect(cloudShellAltitudeKm(NaN)).toBe(SHELL_ORBIT_KM);
  });
});
