import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { forEachBody } from '@/config/catalog';
import { EphemerisService } from './EphemerisService';
import { OrbitalElementsService } from './OrbitalElementsService';
import { OrbitalMechanics } from './OrbitalMechanics';
import { SimulationClock } from './SimulationClock';
import type { PreciseEphemerisProvider } from './PreciseEphemerisProvider';
import type { CelestialBodies } from '@/components/systems/SceneSystem';

/**
 * CADENCE DE RÉVOLUTION DES SATELLITES, sur le repli képlérien.
 *
 * Un satellite dont la position vient de `relativeOrbitalElements` tourne autour de sa
 * PLANÈTE. Le mouvement moyen ne peut donc pas être déduit de la troisième loi de Kepler
 * avec la constante de Gauss, qui suppose le Soleil au foyer : `kepler.ts` doit recevoir la
 * période publiée (cf. `OrbitalElements.periodDays`).
 *
 * Défaut réellement livré, et mesuré ici corps par corps : sans elle, chaque lune parcourait
 * sa (bonne) ellipse entre 32× (Amalthée) et 11 661× (Charon) trop vite — le facteur vaut
 * √(M☉/M_parent). Rien ne le signalait : la trajectoire restait géométriquement juste, seule
 * sa cadence était fausse. Deux conséquences visibles, l'une en temps réel et l'autre à
 * l'arrêt :
 *   - la lune filait sur son orbite au lieu de la parcourir en quelques jours simulés ;
 *   - la LIGNE d'orbite, échantillonnée sur une période catalogue, se repliait complètement
 *     (`computeOrbitPoints` faisait des milliers de tours entre deux points) et ne décrivait
 *     plus une orbite du tout — un zigzag, pas une courbe fermée.
 *
 * Le test suit la SORTIE observable et non le mouvement moyen : l'angle balayé autour de la
 * planète sur une période catalogue doit valoir un tour. C'est ce qu'un facteur d'erreur,
 * quel qu'il soit, ne peut pas produire par hasard.
 */

/** Repli forcé : ce test porte sur le chemin képlérien, pas sur les binaires Horizons. */
const noPreciseData: PreciseEphemerisProvider = {
  getHeliocentricAU: () => null,
  getParentRelativeAU: () => null,
};

function makeMechanics(): OrbitalMechanics {
  return new OrbitalMechanics(
    new SimulationClock(),
    new EphemerisService(),
    new OrbitalElementsService(),
    noPreciseData,
    CELESTIAL_CONFIG,
    {} as CelestialBodies
  );
}

const DATE = new Date('2026-03-15T00:00:00Z');

/** Satellites positionnés par éléments képlériens relatifs à leur planète. */
const keplerianSatellites: { name: string; parent: string; period: number }[] =
  [];
forEachBody(CELESTIAL_CONFIG, ({ name, config, parentName }) => {
  const period = config.realData?.orbitPeriodDays;
  if (!config.relativeOrbitalElements || parentName === null || !period) return;
  keplerianSatellites.push({ name, parent: parentName, period });
});

describe('cadence de révolution des satellites (repli képlérien)', () => {
  it('couvre bien les satellites du catalogue', () => {
    expect(keplerianSatellites.length).toBeGreaterThanOrEqual(15);
  });

  const mechanics = makeMechanics();

  for (const { name, period } of keplerianSatellites) {
    it(`${name} décrit un tour complet sur une période catalogue (${period.toFixed(2)} j)`, () => {
      const config = findSatellite(name);
      const nPoints = 512;
      const points = mechanics.computeOrbitPoints(name, config, DATE, nPoints);
      expect(points, `${name} : pas de ligne d'orbite`).not.toBeNull();

      // `computeOrbitPoints` échantillonne UNE période catalogue en `nPoints` pas de temps
      // égaux. On lit donc sur la ligne elle-même ce que le corps fait en temps réel.
      let swept = 0;
      let maxGapDeg = 0;
      const current = new THREE.Vector3();
      const previous = new THREE.Vector3();
      for (let i = 0; i < nPoints; i++) {
        current.set(points![i * 3], points![i * 3 + 1], points![i * 3 + 2]);
        if (i > 0) {
          const gap = previous.angleTo(current) * (180 / Math.PI);
          swept += gap;
          maxGapDeg = Math.max(maxGapDeg, gap);
        }
        previous.copy(current);
      }

      // Un tour, ni plus ni moins. Avec le μ solaire, Charon en faisait 11 661 : l'angle
      // cumulé devenait une somme de sauts arbitraires, très au-dessus de 360°.
      expect(swept, `${name} : angle balayé sur une période`).toBeGreaterThan(
        355
      );
      expect(swept, `${name} : angle balayé sur une période`).toBeLessThan(365);

      // Et une COURBE, pas un zigzag : aucun saut ne doit dépasser largement le pas
      // nominal. C'est la signature du repliement, que l'angle cumulé seul pourrait
      // manquer si les sauts se compensaient. Marge large pour les orbites excentriques,
      // qui balaient légitimement plus vite au périastre (Néréide, e = 0,75).
      expect(maxGapDeg, `${name} : écart max entre deux points`).toBeLessThan(
        20
      );
    });
  }
});

/** Retrouve la config d'un satellite imbriqué dans le catalogue. */
function findSatellite(target: string) {
  let found: (typeof CELESTIAL_CONFIG.bodies)[string] | undefined;
  forEachBody(CELESTIAL_CONFIG, ({ name, config }) => {
    if (name === target) found = config;
  });
  return found!;
}
