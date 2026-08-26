import { describe, expect, it } from 'vitest';
import { allBodies } from './catalog';
import { CELESTIAL_CONFIG } from './bodies';
import { SMALL_BODIES } from './smallBodies';

const G = 6.6743e-11;

/**
 * Régression pour un bug réel : Makémaké (gravity=0,5) et Hygie (gravity=0,09) affichaient une
 * gravité de surface incohérente avec leurs propres massKg/radiusKm — jusqu'à 37 % d'écart avec
 * g=GM/r². Un enseignant ou un relecteur scientifique ferait exactement ce calcul en comparant
 * les chiffres affichés dans la fiche corps. Corrigé en recalculant `gravity` depuis massKg et
 * radiusKm — les trois champs doivent maintenant rester cohérents entre eux.
 *
 * Deimos et Uranus ont un écart réel mais PHYSIQUEMENT JUSTIFIÉ, pas une erreur de saisie :
 * Deimos est un corps minuscule et très irrégulier où « la » gravité de surface n'est de toute
 * façon qu'une approximation à 1 chiffre significatif ; Uranus a un écart cohérent avec l'effet
 * réel d'aplatissement/rotation rapide sur la gravité équatoriale déclarée. Tolérance élargie
 * explicitement pour ces deux-là, stricte pour tous les autres.
 */
const WIDER_TOLERANCE: Record<string, number> = {
  deimos: 0.16,
  uranus: 0.03,
};
const DEFAULT_TOLERANCE = 0.02;

describe('physical consistency: gravity = G·mass/radius²', () => {
  const all = [
    ...allBodies(CELESTIAL_CONFIG),
    ...allBodies({ bodies: SMALL_BODIES }),
  ].filter(
    ({ config }) =>
      config.realData?.massKg &&
      config.realData?.radiusKm &&
      config.realData?.gravity
  );

  it('has bodies with mass/radius/gravity to check', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it.each(all.map(({ name, config }) => [name, config] as const))(
    '%s: stated gravity matches G·mass/radius²',
    (name, config) => {
      const rd = config.realData!;
      const radiusM = rd.radiusKm! * 1000;
      const computed = (G * rd.massKg!) / (radiusM * radiusM);
      const tolerance = WIDER_TOLERANCE[name] ?? DEFAULT_TOLERANCE;
      const relativeError = Math.abs(computed - rd.gravity!) / rd.gravity!;
      expect(
        relativeError,
        `${name}: stated=${rd.gravity} computed=${computed.toFixed(4)} (${(relativeError * 100).toFixed(1)}% off, tolerance ${(tolerance * 100).toFixed(0)}%)`
      ).toBeLessThanOrEqual(tolerance);
    }
  );
});

/**
 * Régression complémentaire : période orbitale et demi-grand axe doivent rester cohérents avec
 * la 3ᵉ loi de Kepler (T² = a³ en années/UA, exact pour une orbite héliocentrique autour du
 * Soleil). Aucun bug trouvé ici au moment de l'écriture — verrouille l'invariant pour la suite.
 */
describe("physical consistency: Kepler's third law for heliocentric orbits", () => {
  const heliocentric = [
    ...allBodies(CELESTIAL_CONFIG),
    ...allBodies({ bodies: SMALL_BODIES }),
  ].filter(
    ({ config }) =>
      config.frame !== 'parentRelative' &&
      config.realData?.distanceAU &&
      config.realData?.orbitPeriodDays
  );

  it('has heliocentric bodies with distance/period to check', () => {
    expect(heliocentric.length).toBeGreaterThan(10);
  });

  it.each(heliocentric.map(({ name, config }) => [name, config] as const))(
    '%s: orbital period matches a^1.5 (years, AU)',
    (name, config) => {
      const rd = config.realData!;
      const periodYears = rd.orbitPeriodDays! / 365.25;
      const expectedYears = Math.pow(rd.distanceAU!, 1.5);
      const relativeError =
        Math.abs(periodYears - expectedYears) / expectedYears;
      expect(
        relativeError,
        `${name}: statedT=${periodYears.toFixed(3)}y keplerT=${expectedYears.toFixed(3)}y`
      ).toBeLessThanOrEqual(0.01);
    }
  );
});
