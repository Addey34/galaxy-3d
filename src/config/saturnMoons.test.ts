import { describe, expect, it } from 'vitest';
import { Body } from 'astronomy-engine';
import { CELESTIAL_CONFIG } from './bodies';

const SATURN_MOONS = [
  ['enceladus', 'Enceladus', 0.00159360557, 1.370218],
  ['rhea', 'Rhea', 0.00352411433, 4.517503],
  ['iapetus', 'Iapetus', 0.02380849395, 79.331002],
] as const;

/** Résolutions de surface réellement livrées (voir public/assets/textures). */
const SATURN_MOON_RES: Record<string, string[]> = {
  enceladus: ['1k'],
  rhea: ['1k'],
  iapetus: ['4k', '2k', '1k'],
};

describe('Saturnian moon catalogue entries', () => {
  it.each(SATURN_MOONS)(
    'declares %s as a textured parent-relative moon',
    (key, displayName, semiMajorAxisAU, periodDays) => {
      const moon = CELESTIAL_CONFIG.bodies.saturn.satellites?.[key];

      expect(moon).toBeDefined();
      expect(moon?.kind).toBe('moon');
      expect(moon?.displayName?.en).toBe(displayName);
      expect(moon?.frame).toBe('parentRelative');
      expect(moon?.relativeEphemeris).toEqual({
        kind: 'horizonsParentRelative',
      });
      expect(moon?.rotationBody).toBe(Body.Saturn);
      // Tolerance RELATIVE de 0,5 %, et non une egalite a 9 decimales : le catalogue porte
      // desormais le demi-grand axe OSCULATEUR derive des etats Horizons
      // (`scripts/derive-relative-elements.mjs`), la ou cette valeur de reference est le
      // demi-grand axe MOYEN publie. Les deux decrivent la meme orbite et different de
      // quelques centiemes de pourcent, par definition. La marge reste tres en dessous de
      // ce qu'une coquille de saisie produirait (chiffre transpose, ordre de grandeur), ce
      // que cette assertion garde vraiment.
      expect(
        Math.abs(
          (moon!.relativeOrbitalElements!.semiMajorAxisAU - semiMajorAxisAU) /
            semiMajorAxisAU
        ),
        `${key} : demi-grand axe`
      ).toBeLessThan(0.005);
      expect(moon?.textures?.surface).toBe(`${key}/${key}_surface`);
      expect(moon?.textureResolutions.surface).toEqual(SATURN_MOON_RES[key]);
      expect(moon?.fallbackColor).toBeTypeOf('number');
      expect(moon?.realData?.orbitPeriodDays).toBeCloseTo(periodDays, 6);
    }
  );

  it.each(SATURN_MOONS)(
    'uses synchronous rotation for %s',
    (key, _displayName, _semiMajorAxisAU, periodDays) => {
      const moon = CELESTIAL_CONFIG.bodies.saturn.satellites![key];
      const rotationPeriodDays =
        (2 * Math.PI) / Math.abs(moon.rotationSpeed) / 86_400;

      expect(rotationPeriodDays).toBeCloseTo(periodDays, 6);
    }
  );
});
