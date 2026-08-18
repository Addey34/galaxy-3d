import { describe, it, expect } from 'vitest';
import {
  samplePalette,
  scalarGridToRGBA,
  paletteToCss,
  TEMPERATURE_PALETTE,
  PRECIP_PALETTE,
  PRESSURE_PALETTE,
  PRESSURE_DOMAIN,
  HUMIDITY_PALETTE,
  HUMIDITY_DOMAIN,
  TEMPERATURE_DOMAIN,
  type Palette,
} from './meteoPalette';
import type { ScalarGrid } from './meteoGrid';

const SIMPLE: Palette = {
  stops: [
    { t: 0, rgb: [0, 0, 0] },
    { t: 1, rgb: [200, 100, 50] },
  ],
};

function grid(values: number[], nLat: number, nLon: number): ScalarGrid {
  return {
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat,
    nLon,
    values: new Float32Array(values),
  };
}

describe('samplePalette', () => {
  it('renvoie les extrémités hors domaine (clamp)', () => {
    expect(samplePalette(SIMPLE, -1)).toEqual([0, 0, 0]);
    expect(samplePalette(SIMPLE, 2)).toEqual([200, 100, 50]);
  });

  it('interpole linéairement au milieu', () => {
    expect(samplePalette(SIMPLE, 0.5)).toEqual([100, 50, 25]);
  });

  it('gère une palette multi-arrêts (température : vert vers le milieu)', () => {
    const mid = samplePalette(TEMPERATURE_PALETTE, 0.5);
    expect(mid).toEqual([102, 189, 99]);
  });
});

describe('weather palettes', () => {
  it('keeps pressure and humidity stops ordered and within RGB bounds', () => {
    for (const palette of [PRESSURE_PALETTE, HUMIDITY_PALETTE]) {
      expect(palette.stops.length).toBeGreaterThanOrEqual(5);
      for (let index = 0; index < palette.stops.length; index += 1) {
        const stop = palette.stops[index];
        expect(stop.t).toBeGreaterThanOrEqual(0);
        expect(stop.t).toBeLessThanOrEqual(1);
        if (index > 0)
          expect(stop.t).toBeGreaterThan(palette.stops[index - 1].t);
        for (const channel of stop.rgb) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    }
    expect(PRESSURE_DOMAIN).toEqual({ min: 960, max: 1060 });
    expect(HUMIDITY_DOMAIN).toEqual({ min: 0, max: 100 });
  });
});
describe('scalarGridToRGBA', () => {
  it('mappe les valeurs sur la palette et inverse le Nord en haut', () => {
    // 2 rangées : rangée 0 = SUD (val 0 → noir), rangée 1 = NORD (val max → couleur).
    const g = grid([0, 0, 1, 1], 2, 2);
    const { data, width, height } = scalarGridToRGBA(g, SIMPLE, {
      min: 0,
      max: 1,
    });
    expect(width).toBe(2);
    expect(height).toBe(2);
    // Rangée 0 image = NORD = valeurs 1 → couleur pleine.
    expect([data[0], data[1], data[2]]).toEqual([200, 100, 50]);
    // Rangée 1 image = SUD = valeurs 0 → noir.
    const o = (1 * 2 + 0) * 4;
    expect([data[o], data[o + 1], data[o + 2]]).toEqual([0, 0, 0]);
  });

  it('opaque par défaut (température)', () => {
    const g = grid([-40, 45], 1, 2);
    const { data } = scalarGridToRGBA(
      g,
      TEMPERATURE_PALETTE,
      TEMPERATURE_DOMAIN
    );
    expect(data[3]).toBe(255);
    expect(data[7]).toBe(255);
  });

  it('transparentBelow rend les zones sèches transparentes (pluie)', () => {
    const g = grid([0, 5], 1, 2);
    const { data } = scalarGridToRGBA(g, PRECIP_PALETTE, {
      min: 0,
      max: 20,
      transparentBelow: 0.1,
    });
    // val 0 < seuil → alpha 0 ; val 5 ≥ seuil → alpha plein.
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
  });

  it('alphaRamp adoucit le bord (montée progressive de alpha)', () => {
    const g = grid([0, 0.5, 1, 2], 1, 4);
    const { data } = scalarGridToRGBA(g, PRECIP_PALETTE, {
      min: 0,
      max: 20,
      transparentBelow: 0,
      alphaRamp: 1,
      maxAlpha: 255,
    });
    // 0 → 0, 0.5 → ~128, 1 → 255, 2 (au-delà de la rampe) → 255.
    expect(data[3]).toBe(0);
    expect(data[7]).toBeGreaterThan(100);
    expect(data[7]).toBeLessThan(160);
    expect(data[11]).toBe(255);
    expect(data[15]).toBe(255);
  });
});

describe('paletteToCss', () => {
  it('construit un linear-gradient cohérent avec les arrêts', () => {
    const css = paletteToCss(SIMPLE);
    expect(css).toBe(
      'linear-gradient(to right, rgb(0,0,0) 0%, rgb(200,100,50) 100%)'
    );
  });

  it('respecte la direction fournie', () => {
    expect(paletteToCss(SIMPLE, 'to top')).toContain('to top');
  });
});
