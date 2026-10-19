import { describe, expect, it } from 'vitest';
import {
  altitudeToFrame,
  diameterFromWebZoom,
  diveDistance,
  DIVE_FILL,
  MIN_DIVE_ALTITUDE_RADII,
} from './placeDive';

describe('altitudeToFrame', () => {
  it('cadre la formation : à cette altitude elle occupe la part voulue de la vue', () => {
    const fov = 50;
    const altitude = altitudeToFrame(100, fov, 1);
    const visible = 2 * altitude * Math.tan((fov * Math.PI) / 360);
    expect(100 / visible).toBeCloseTo(DIVE_FILL, 6);
  });

  it("s'appuie sur le champ le plus étroit : une vue en portrait cadre sur la largeur", () => {
    const landscape = altitudeToFrame(100, 50, 16 / 9);
    const portrait = altitudeToFrame(100, 50, 9 / 16);
    expect(portrait).toBeGreaterThan(landscape);
  });

  it('refuse les entrées absurdes au lieu de rendre NaN', () => {
    expect(altitudeToFrame(0, 50, 1)).toBe(0);
    expect(altitudeToFrame(100, 0, 1)).toBe(0);
    expect(altitudeToFrame(100, 50, 0)).toBe(0);
    expect(altitudeToFrame(Number.NaN, 50, 1)).toBe(0);
  });
});

describe('diameterFromWebZoom', () => {
  it('divise par deux à chaque niveau', () => {
    expect(diameterFromWebZoom(5)).toBeCloseTo(diameterFromWebZoom(4) / 2, 9);
  });
  it('rend 0 hors domaine', () => {
    expect(diameterFromWebZoom(Number.POSITIVE_INFINITY)).toBe(0);
    expect(diameterFromWebZoom(Number.NaN)).toBe(0);
  });
});

describe('diveDistance', () => {
  it('ajoute le rayon à l’altitude, ramenée en rayons', () => {
    expect(diveDistance(10, 1000, 500)).toBeCloseTo(15, 9);
  });
  it('ne descend jamais sous l’altitude plancher', () => {
    expect(diveDistance(10, 1000, 0)).toBeCloseTo(
      10 * (1 + MIN_DIVE_ALTITUDE_RADII),
      9
    );
  });
  it('ne s’éloigne jamais de plus de quatre rayons', () => {
    expect(diveDistance(10, 1000, 1e9)).toBeCloseTo(40, 9);
  });
  it('rend 0 sans rayon', () => {
    expect(diveDistance(0, 1000, 5)).toBe(0);
    expect(diveDistance(10, 0, 5)).toBe(0);
  });
});
