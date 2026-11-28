import { describe, expect, it } from 'vitest';
import {
  ADAPTATION_REFERENCE_SUN_DEG,
  altitudeWeight,
  LUMINOUS_SOLAR_CONSTANT_LX,
  skyAdaptationGain,
  wardGain,
} from './skyAdaptation';
import { skyScattering, zenithSkyLuminance } from './atmosphereScattering';
import {
  sampleMultipleScattering,
  sharedMultipleScatteringTable,
} from './multipleScattering';

const model = skyScattering('bruneton-2017');
const table = sharedMultipleScatteringTable(model);
const multiple = (a: number, c: number) =>
  sampleMultipleScattering(table, model, a, c)[1];
/** Zénith au niveau de la mer, en part de l'éclairement solaire, pour une hauteur du Soleil (degrés). */
const zenith = (sunDeg: number) =>
  zenithSkyLuminance(
    model,
    6371,
    6371.002,
    Math.sin((sunDeg * Math.PI) / 180),
    1,
    undefined,
    multiple
  );
const reference = zenith(ADAPTATION_REFERENCE_SUN_DEG);

describe('l’œil adapté au ciel du lieu (Ward 1994)', () => {
  it('reprend la formule publiée, constantes de Blackwell comprises (Matkovic 1997, éq. 4.16)', () => {
    const m = (la: number) => (1.219 + la ** 0.4) ** 2.5;
    for (const [w, r] of [
      [1, 1000],
      [0.01, 500],
      [3000, 3000],
    ] as const)
      expect(wardGain(w, r)).toBeCloseTo(m(r) / m(w), 9);
    expect(LUMINOUS_SOLAR_CONSTANT_LX).toBe(133_800);
  });

  it('ne touche pas le jour : 1 au Soleil de référence et plus haut, jamais sous 1', () => {
    expect(skyAdaptationGain(reference, reference, 1)).toBe(1);
    expect(skyAdaptationGain(zenith(70), reference, 1)).toBe(1);
    expect(skyAdaptationGain(zenith(15), reference, 1)).toBeGreaterThan(1);
  });

  it('ce que le ciel AFFICHE décroît du jour à la nuit, sans saut ni inversion', () => {
    const elevations = [45, 15, 5, 0, -3, -6, -12, -18];
    const shown = elevations.map(
      (e) => zenith(e) * skyAdaptationGain(zenith(e), reference, 1)
    );
    for (let i = 1; i < shown.length; i += 1)
      expect(shown[i]!).toBeLessThan(shown[i - 1]!);
    const ratio = (e: number) =>
      (zenith(e) * skyAdaptationGain(zenith(e), reference, 1)) / reference;
    // Coucher : lumineux ; crépuscule civil : bleu sombre visible ; nuit astronomique : noire.
    expect(ratio(0)).toBeGreaterThan(0.4);
    expect(ratio(-6)).toBeGreaterThan(0.02);
    expect(ratio(-6)).toBeLessThan(0.3);
    expect(ratio(-18)).toBeLessThan(1e-4);
  });

  it('le zénith du crépuscule confronté à une mesure : Paranal, Patat et al. 2006 (bande V)', () => {
    // F. Patat et al., « UBVRI twilight sky brightness at ESO-Paranal », A&A (2006), arXiv astro-ph/0604128,
    // table 1, bande V : m(ζ) = 11,84 + 1,518 (ζ − 95) − 0,057 (ζ − 95)² mag/arcsec², ζ distance zénithale du
    // Soleil, valable de 95° à 105°. Conversion usuelle : cd/m² = 1,08·10⁵ × 10^(−0,4 m). Paranal est à 2 635 m,
    // dans un air très pur : son ciel est plus sombre qu'au niveau de la mer, d'où une tolérance d'un facteur 3.
    const measured = (depressionDeg: number) => {
      const z = 90 + depressionDeg - 95;
      const m = 11.84 + 1.518 * z - 0.057 * z * z;
      return 1.08e5 * 10 ** (-0.4 * m);
    };
    const model = (depressionDeg: number) =>
      zenith(-depressionDeg) * LUMINOUS_SOLAR_CONSTANT_LX;
    for (const d of [6, 9, 12]) {
      const ratio = model(d) / measured(d);
      expect(ratio, `${d}° sous l'horizon`).toBeGreaterThan(1 / 3);
      expect(ratio, `${d}° sous l'horizon`).toBeLessThan(3);
    }
    // Mesuré le 2026-11-28 : 0,66 contre 0,52 cd/m² à −6° ; 3,2·10⁻³ contre 1,5·10⁻³ à −12°.
    expect(measured(6)).toBeCloseTo(0.52, 1);
  });

  it('borné : le seuil de Blackwell sature le gain dans la nuit (pas d’infini)', () => {
    expect(wardGain(0, 1430)).toBeLessThan(2000);
    expect(skyAdaptationGain(0, reference, 1)).toBeLessThan(2000);
  });

  it('s’affaiblit avec l’altitude, et vaut 1 au sommet de l’air (continu avec l’orbite)', () => {
    expect(altitudeWeight(0, 60)).toBe(1);
    expect(altitudeWeight(30, 60)).toBe(0.5);
    expect(altitudeWeight(60, 60)).toBe(0);
    expect(altitudeWeight(500, 60)).toBe(0);
    const g = skyAdaptationGain(zenith(-6), reference, 1);
    expect(skyAdaptationGain(zenith(-6), reference, 0.5)).toBeCloseTo(
      Math.sqrt(g),
      9
    );
    expect(skyAdaptationGain(zenith(-6), reference, 0)).toBe(1);
  });
});
