import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { forEachBody } from '@/config/catalog';
import { EphemerisService } from './EphemerisService';
import { OrbitalElementsService } from './OrbitalElementsService';
import { OrbitalMechanics } from './OrbitalMechanics';
import { SimulationClock } from './SimulationClock';
import type { PreciseEphemerisProvider } from './PreciseEphemerisProvider';
import { horizonsServiceFromDisk } from './horizonsTestFixture';
import type { CelestialBodies } from '@/components/systems/SceneSystem';
import type { CelestialBodyConfig } from '@/types';

/**
 * RÉPARTITION DES POINTS SUR LA LIGNE D'ORBITE.
 *
 * Une ligne d'orbite est une polyligne : sa fidélité ne tient pas au nombre de points mais
 * à l'endroit où on les met. Échantillonner uniformément dans le TEMPS les place là où le
 * corps passe son temps — c'est-à-dire, par la deuxième loi de Kepler, presque tous près de
 * l'aphélie. Plus l'orbite est excentrique, moins il en reste là où la courbe tourne le plus.
 *
 * Défaut réellement livré, signalé à l'œil (« Halley n'est pas ovale ») puis mesuré : sur
 * 512 points répartis sur les 76 ans de Halley (e = 0,967), deux points consécutifs
 * s'écartaient de 130°, une corde droite traversait toute la région du périhélie, et la
 * ligne n'atteignait jamais sa distance minimale — rapport des rayons rendu 6,7 pour 7,8
 * attendu. Le bout pointu de l'ellipse était coupé. Le même code servant les deux modes, le
 * défaut était présent dans les deux, Explo n'étant qu'atténué par ses 4096 points (20,7°).
 *
 * Deux assertions, pour deux propriétés qu'il ne faut pas confondre :
 *
 *   - AMPLITUDE : la ligne atteint-elle vraiment le périhélie et l'aphélie ? Vérifiée contre
 *     (1+e)/(1−e) calculé depuis l'excentricité du catalogue — une vérité géométrique
 *     indépendante du code de rendu, et compressée en √ en mode Éducatif comme le veut ce
 *     mode. C'est elle qui attrape une courbe tronquée.
 *   - RÉGULARITÉ : aucun segment ne doit sauter une portion d'orbite. C'est elle qui attrape
 *     une courbe qui atteindrait ses apsides mais les relierait par des cordes.
 *
 * Les deux sont nécessaires : la première seule passerait sur une ligne en zigzag qui touche
 * les bons extrêmes, la seconde seule passerait sur un cercle parfaitement régulier mais faux.
 */

const noPreciseData: PreciseEphemerisProvider = {
  getHeliocentricAU: () => null,
  getParentRelativeAU: () => null,
};

const DATE = new Date('2026-03-15T00:00:00Z');

function makeMechanics(
  mode: 'educ' | 'explo',
  precise: PreciseEphemerisProvider = noPreciseData
): OrbitalMechanics {
  const mechanics = new OrbitalMechanics(
    new SimulationClock(),
    new EphemerisService(),
    new OrbitalElementsService(),
    precise,
    CELESTIAL_CONFIG,
    {} as CelestialBodies
  );
  mechanics.setMode(mode);
  return mechanics;
}

/** Corps héliocentriques dont le catalogue publie l'excentricité. */
const eccentricBodies: {
  name: string;
  config: CelestialBodyConfig;
  e: number;
}[] = [];
forEachBody(CELESTIAL_CONFIG, ({ name, config, parentName }) => {
  const elements = config.orbitalElements;
  if (parentName !== null || !elements) return;
  eccentricBodies.push({ name, config, e: elements.eccentricity });
});

interface LineMetrics {
  radiusRatio: number;
  maxGapDeg: number;
  maxSegmentRatio: number;
}

function measure(
  mechanics: OrbitalMechanics,
  name: string,
  config: CelestialBodyConfig
): LineMetrics | null {
  const points = mechanics.computeOrbitPoints(name, config, DATE);
  if (!points) return null;
  const count = points.length / 3 - 1;

  let radiusMin = Infinity;
  let radiusMax = 0;
  let maxGapDeg = 0;
  let maxSegment = 0;
  let totalSegment = 0;
  const current = new THREE.Vector3();
  const previous = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    current.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    const radius = current.length();
    radiusMin = Math.min(radiusMin, radius);
    radiusMax = Math.max(radiusMax, radius);
    if (i > 0) {
      maxGapDeg = Math.max(
        maxGapDeg,
        previous.angleTo(current) * (180 / Math.PI)
      );
      const segment = previous.distanceTo(current);
      maxSegment = Math.max(maxSegment, segment);
      totalSegment += segment;
    }
    previous.copy(current);
  }

  return {
    radiusRatio: radiusMax / radiusMin,
    maxGapDeg,
    maxSegmentRatio: maxSegment / (totalSegment / (count - 1)),
  };
}

describe('répartition des points sur la ligne d’orbite', () => {
  it('couvre bien les corps excentriques du catalogue', () => {
    expect(eccentricBodies.length).toBeGreaterThanOrEqual(8);
    // Sans un corps très excentrique, la suite ne prouverait presque rien.
    expect(Math.max(...eccentricBodies.map(({ e }) => e))).toBeGreaterThan(0.9);
  });

  for (const mode of ['educ', 'explo'] as const) {
    describe(mode, () => {
      const mechanics = makeMechanics(mode);

      for (const { name, config, e } of eccentricBodies) {
        it(`${name} (e = ${e.toFixed(3)}) atteint ses apsides et reste lisse`, () => {
          const metrics = measure(mechanics, name, config);
          expect(metrics, `${name} : pas de ligne`).not.toBeNull();

          // Rapport apoapse/periapse de l'orbite vraie. En Éducatif, la distance radiale
          // est compressée en √ (cf. `_computeEducPos`), donc le rapport l'est aussi.
          const trueRatio = (1 + e) / (1 - e);
          const expectedRatio =
            mode === 'educ' ? Math.sqrt(trueRatio) : trueRatio;
          expect(
            metrics!.radiusRatio / expectedRatio,
            `${name} : la ligne n'atteint pas ses apsides`
          ).toBeCloseTo(1, 1);

          // Régularité : aucun segment ne saute une portion d'orbite. Avant correction,
          // Halley montait à 130° d'écart et 55× le segment moyen.
          expect(metrics!.maxGapDeg, `${name} : trou angulaire`).toBeLessThan(
            10
          );
          expect(
            metrics!.maxSegmentRatio,
            `${name} : segment démesuré`
          ).toBeLessThan(4);
        });
      }
    });
  }

  /**
   * Garde générale sur TOUT le catalogue, excentrique ou non : aucune ligne d'orbite ne doit
   * comporter de saut. Attrape un corps dont l'échantillonnage se dégraderait sans que
   * personne pense à l'ajouter à la liste ci-dessus.
   */
  it('ne laisse aucun trou sur les lignes d’orbite du catalogue', () => {
    const mechanics = makeMechanics('educ');
    let checked = 0;
    forEachBody(CELESTIAL_CONFIG, ({ name, config }) => {
      if (config.kind === 'skybox' || config.kind === 'star') return;
      const metrics = measure(mechanics, name, config);
      if (!metrics) return;
      checked++;
      expect(metrics.maxGapDeg, `${name} : trou angulaire`).toBeLessThan(10);
    });
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  /**
   * La MEME garde, mais sur le chemin de PRODUCTION : binaires Horizons réellement committés
   * plutôt que repli képlérien forcé.
   *
   * Sans elle, la garde ci-dessus ne prouve rien de ce que voit l'utilisateur. Elle injecte un
   * fournisseur vide, donc tout corps dont la position vient d'un binaire retourne `null` et
   * se fait **silencieusement sauter** par le `if (!metrics) return`. C'était le cas de la
   * moitié du catalogue.
   *
   * Elle ferme aussi un piège identifié mais non gardé jusqu'ici : la répartition en anomalie
   * excentrique s'active sur la présence d'éléments orbitaux (`_orbitSampleDate`). Un futur
   * corps très excentrique alimenté par un binaire mais SANS jeu d'éléments retomberait donc
   * sur l'échantillonnage uniforme en temps — exactement le défaut Halley. Ici il se verrait,
   * puisqu'on mesure la courbe telle qu'elle est tracée.
   */
  for (const mode of ['educ', 'explo'] as const) {
    it(`ne laisse aucun trou sur les lignes d’orbite réelles (${mode}, binaires Horizons)`, () => {
      const mechanics = makeMechanics(mode, horizonsServiceFromDisk());
      let checked = 0;
      forEachBody(CELESTIAL_CONFIG, ({ name, config }) => {
        if (config.kind === 'skybox' || config.kind === 'star') return;
        const metrics = measure(mechanics, name, config);
        if (!metrics) return;
        checked++;
        expect(metrics.maxGapDeg, `${name} : trou angulaire`).toBeLessThan(10);
        expect(
          metrics.maxSegmentRatio,
          `${name} : segment démesuré`
        ).toBeLessThan(6);
      });
      expect(checked).toBeGreaterThanOrEqual(30);
    });
  }
});
