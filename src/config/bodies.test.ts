import { describe, expect, it } from 'vitest';
import { Body } from 'astronomy-engine';
import { CELESTIAL_CONFIG } from './bodies';
import { forEachBody } from './catalog';

describe('Jupiter Galilean moons catalogue', () => {
  it('declares the four astronomy-engine jovian sources as parent-relative bodies', () => {
    const jupiter = CELESTIAL_CONFIG.bodies.jupiter;
    const expected = ['io', 'europa', 'ganymede', 'callisto'] as const;

    for (const name of expected) {
      const moon = jupiter.satellites?.[name];
      expect(moon).toBeDefined();
      expect(moon?.kind).toBe('moon');
      expect(moon?.frame).toBe('parentRelative');
      expect(moon?.relativeEphemeris).toEqual({
        kind: 'jupiterMoon',
        moon: name,
      });
      expect(moon?.rotationBody).toBe(Body.Jupiter);
      expect(moon?.fallbackColor).toBeTypeOf('number');
      expect(moon?.textures?.surface).toBe(name + '/' + name + '_surface');
      expect(moon?.textureResolutions.surface).toEqual([
        '8k',
        '4k',
        '2k',
        '1k',
      ]);
      expect(moon?.realData?.radiusKm).toBeGreaterThan(1_000);
      expect(moon?.realData?.orbitPeriodDays).toBeGreaterThan(1);
    }
  });
  it('keeps each Galilean moon synchronously locked to its orbit', () => {
    const jupiter = CELESTIAL_CONFIG.bodies.jupiter;
    const names = ['io', 'europa', 'ganymede', 'callisto'] as const;
    const distances = names.map(
      (name) => jupiter.satellites?.[name].realData?.distanceAU ?? 0
    );

    expect(distances[0]).toBeLessThan(distances[1]);
    expect(distances[1]).toBeLessThan(distances[2]);
    expect(distances[2]).toBeLessThan(distances[3]);

    for (const name of names) {
      const moon = jupiter.satellites?.[name];
      const orbitPeriodDays = moon?.realData?.orbitPeriodDays ?? 0;
      const rotationPeriodDays =
        (2 * Math.PI) / Math.abs(moon?.rotationSpeed ?? 0) / 86_400;
      expect(rotationPeriodDays).toBeCloseTo(orbitPeriodDays, 2);
    }
  });
});

/**
 * Rotation synchrone = MÊME période que l'orbite, au chiffre près. La rotation est une
 * intégrale de `rotationSpeed` : un écart relatif ε fait tourner la face visible de 360°·ε
 * par révolution. Dix lunes portaient une période de spin recopiée de leur ancienne période
 * orbitale OSCULATRICE ; corriger l'orbite seule (lot 2b) aurait fait dériver la face de
 * Mimas d'un demi-tour en 100 jours. Une lune dont le spin est à moins de 1 % de son orbite
 * est tenue pour verrouillée, et doit alors coïncider à 1e-9 près.
 *
 * Périmètre : les lunes dont la période fait tourner un repli képlérien
 * (`relativeOrbitalElements`). La Lune et les galiléennes (positions astronomy-engine) gardent
 * un écart d'arrondi de 5e-5 à 1,2e-4 entre heures de spin et jours d'orbite, soit ~7°/an de
 * dérive de face pour Io : connu, hors du lot 2b, à reprendre avec les faits sourcés (lot 4).
 */
describe('synchronous moons', () => {
  const locked: [string, number, number][] = [];
  forEachBody(CELESTIAL_CONFIG, ({ name, config, parentName }) => {
    const orbit = config.realData?.orbitPeriodDays;
    if (!parentName || !orbit || !config.rotationSpeed) return;
    if (!config.relativeOrbitalElements) return;
    const spin = (2 * Math.PI) / Math.abs(config.rotationSpeed) / 86_400;
    if (Math.abs(spin / orbit - 1) < 0.01) locked.push([name, spin, orbit]);
  });

  it('finds the locked moons of the catalogue', () => {
    expect(locked.length).toBeGreaterThanOrEqual(18);
  });

  it.each(locked)('%s spins at its orbital period', (_name, spin, orbit) => {
    expect(Math.abs(spin / orbit - 1)).toBeLessThan(1e-9);
  });
});
