import { describe, expect, it } from 'vitest';
import {
  dayZenithLuminance,
  SKY_SCATTERING_MODELS,
  skyScattering,
  STARS_HIDDEN_ABOVE,
  STARS_VISIBLE_BELOW,
  starVisibility,
  zenithSkyLuminance,
} from './atmosphereScattering';

/**
 * Les valeurs attendues sont calculées À LA MAIN depuis les constantes de `demo.cc` (Rayleigh :
 * 1,24062e-6 × λ⁻⁴ ; Mie : 5,328e-3 / 1 200 m, albédo 0,9 ; ozone : 300 DU sur 15 km fois la
 * section efficace du canal), indépendamment du code qui les dérive.
 */
describe('bruneton-2017', () => {
  const sky = skyScattering('bruneton-2017');

  it('derives the Rayleigh scattering of the three channels from λ⁻⁴', () => {
    const [r, g, b] = sky.rayleighScatteringPerKm;
    expect(r).toBeCloseTo(5.802e-3, 6);
    expect(g).toBeCloseTo(13.558e-3, 6);
    expect(b).toBeCloseTo(33.1e-3, 5);
    expect(sky.rayleighScaleHeightKm).toBe(8);
  });

  it('derives Mie extinction from the Ångström law, and scattering from its albedo', () => {
    expect(sky.mieExtinctionPerKm).toBeCloseTo(4.44e-3, 6);
    expect(sky.mieScatteringPerKm).toBeCloseTo(3.996e-3, 6);
    expect(sky.mieScaleHeightKm).toBe(1.2);
    expect(sky.mieG).toBe(0.8);
  });

  it('derives the ozone absorption at the peak of its layer', () => {
    const [r, g, b] = sky.ozoneAbsorptionPerKm;
    expect(r).toBeCloseTo(0.65e-3, 5);
    expect(g).toBeCloseTo(1.881e-3, 5);
    expect(b).toBeCloseTo(0.085e-3, 5);
    expect(sky.ozonePeakKm - sky.ozoneHalfWidthKm).toBe(10);
    expect(sky.ozonePeakKm + sky.ozoneHalfWidthKm).toBe(40);
  });

  it('is sixty kilometres thick, as its two radii say', () => {
    expect(sky.thicknessKm).toBe(60);
  });

  it('every declared model has its coefficients', () => {
    for (const model of SKY_SCATTERING_MODELS)
      expect(skyScattering(model).rayleighScatteringPerKm).toHaveLength(3);
  });
});

describe('stars behind the air', () => {
  const day = dayZenithLuminance(skyScattering('bruneton-2017'), 2.5);

  it('takes its daytime reference from the model itself', () => {
    // E × β_vert × H × phase au zénith : 2,5 × 0,013558 × 8 × 3/(8π).
    expect(day).toBeCloseTo(2.5 * 0.013558 * 8 * (3 / (8 * Math.PI)), 5);
  });

  it('shows the stars under a dark sky and hides them under a bright one', () => {
    expect(starVisibility(0, day)).toBe(1);
    expect(starVisibility(day * STARS_VISIBLE_BELOW, day)).toBe(1);
    expect(starVisibility(day * STARS_HIDDEN_ABOVE, day)).toBe(0);
    expect(starVisibility(day, day)).toBe(0);
  });

  it('fades monotonically through twilight', () => {
    let previous = 1;
    for (let e = -4.9; e < -3; e += 0.2) {
      const v = starVisibility(day * 10 ** e, day);
      expect(v).toBeLessThan(previous);
      previous = v;
    }
  });
});

describe('zenithSkyLuminance', () => {
  const sky = skyScattering('bruneton-2017');
  const R = 6371;
  const day = dayZenithLuminance(sky, 2.5);
  const lum = (altitudeKm: number, sunElevationDeg: number) =>
    zenithSkyLuminance(
      sky,
      R,
      R + altitudeKm,
      Math.sin((sunElevationDeg * Math.PI) / 180),
      2.5
    );

  it('is a daytime sky with the Sun high, of the order of the model reference', () => {
    const noon = lum(0, 60);
    expect(noon / day).toBeGreaterThan(0.3);
    expect(noon / day).toBeLessThan(3);
    expect(starVisibility(noon, day)).toBe(0);
  });

  it('darkens with altitude, and is nothing above the air', () => {
    expect(lum(10, 60)).toBeLessThan(lum(0, 60));
    expect(lum(100, 60)).toBe(0);
  });

  it('lets the stars out once the Sun is well below the horizon', () => {
    expect(lum(0, -18)).toBeLessThan(day * 1e-5);
    expect(starVisibility(lum(0, -18), day)).toBe(1);
    // Au coucher, le ciel reste bien plus clair que la nuit.
    expect(lum(0, 0)).toBeGreaterThan(lum(0, -6));
  });
});
