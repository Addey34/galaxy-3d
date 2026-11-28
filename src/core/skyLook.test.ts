import { describe, expect, it } from 'vitest';
import {
  SKY_LOOK_HIDE_RAD,
  SKY_LOOK_MAX_DEG,
  SKY_LOOK_SHOW_RAD,
  skyLookShown,
  skyTiltFromDeg,
} from './skyLook';
import { horizonTiltRad } from './horizonTilt';

describe('regarder le ciel depuis la surface', () => {
  it('n’apparaît que près du sol : ~207 km sur la Terre, ~56 km sur la Lune (champ de 55°)', () => {
    const shownAt = (radiusKm: number, altitudeKm: number) =>
      skyLookShown(false, horizonTiltRad(radiusKm + altitudeKm, radiusKm, 55));
    expect(shownAt(6371, 150)).toBe(true);
    expect(shownAt(6371, 260)).toBe(false);
    expect(shownAt(1737.4, 40)).toBe(true);
    expect(shownAt(1737.4, 70)).toBe(false);
    // De l'orbite, ou sans corps suivi (relèvement nul en Éducatif) : jamais.
    expect(shownAt(6371, 20000)).toBe(false);
    expect(skyLookShown(true, 0)).toBe(false);
  });

  it('ne clignote pas sur le seuil (hystérésis)', () => {
    const between = (SKY_LOOK_SHOW_RAD + SKY_LOOK_HIDE_RAD) / 2;
    expect(skyLookShown(false, between)).toBe(false);
    expect(skyLookShown(true, between)).toBe(true);
    expect(skyLookShown(true, SKY_LOOK_HIDE_RAD - 1e-6)).toBe(false);
    expect(skyLookShown(true, Number.NaN)).toBe(false);
  });

  it('borne la visée entre l’horizon et le maximum offert', () => {
    expect(skyTiltFromDeg(0)).toBe(0);
    expect(skyTiltFromDeg(45)).toBeCloseTo(Math.PI / 4, 12);
    expect(skyTiltFromDeg(-10)).toBe(0);
    expect(skyTiltFromDeg(500)).toBeCloseTo(
      (SKY_LOOK_MAX_DEG * Math.PI) / 180,
      12
    );
    expect(skyTiltFromDeg(Number.NaN)).toBe(0);
  });
});
