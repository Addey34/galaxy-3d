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
    // Tolerances RELATIVES : le catalogue porte desormais les elements OSCULATEURS derives
    // des etats Horizons (`scripts/derive-relative-elements.mjs`), la ou ces references sont
    // les valeurs MOYENNES publiees. Meme orbite, definitions differentes, quelques
    // centiemes de pourcent d'ecart. La marge reste tres en dessous de ce que produirait une
    // coquille de saisie, ce que ces assertions gardent reellement.
    expect(
      Math.abs(
        (titan!.relativeOrbitalElements!.semiMajorAxisAU - 0.008167897) /
          0.008167897
      ),
      'titan : demi-grand axe'
    ).toBeLessThan(0.005);
    expect(titan?.relativeOrbitalElements?.eccentricity).toBeCloseTo(0.029, 3);
    expect(titan?.textures?.surface).toBe('titan/titan_surface');
    expect(titan?.textureResolutions.surface).toEqual(['2k', '1k']);
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
