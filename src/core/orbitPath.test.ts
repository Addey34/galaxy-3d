import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import type { BodyPositionResolver } from './BodyPositionResolver';
import type { ScaleService } from './ScaleService';
import { OrbitPathBuilder } from './orbitPath';

/**
 * CONSTRUCTION D'UNE LIGNE D'ORBITE, isolée de tout le reste.
 *
 * Ces cas passaient auparavant par `OrbitalMechanics` construit à coups d'`Object.create`,
 * parce que le tracé n'avait pas de module. Ils ciblent désormais `OrbitPathBuilder` avec un
 * résolveur doublé : la position devient une entrée contrôlée, et ce qui est vérifié est la
 * seule chose dont ce module répond — la forme de la polyligne.
 *
 * Les propriétés de la courbe mesurées sur le catalogue réel (amplitude, régularité, source
 * homogène) vivent dans `orbitLineSampling.test.ts`. Ici on vérifie la mécanique du tracé.
 */

const DAY_MS = 86_400_000;

/** Résolveur doublé : la position d'un corps devient une fonction connue de la date. */
function resolverReturning(
  fn: (date: Date) => THREE.Vector3
): BodyPositionResolver {
  return {
    resolve: (_name: string, _cfg: CelestialBodyConfig, date: Date) => fn(date),
    // Toujours couvert : le tracé n'a donc aucune raison de basculer sur les éléments.
    precise: () => new THREE.Vector3(1, 0, 0),
    elementsOnly: () => null,
  } as unknown as BodyPositionResolver;
}

function makeBuilder(
  mode: 'educ' | 'explo',
  fn: (date: Date) => THREE.Vector3
): OrbitPathBuilder {
  return new OrbitPathBuilder(
    resolverReturning(fn),
    { mode } as ScaleService,
    { bodies: {} } as CelestialConfig,
    new Map()
  );
}

describe('OrbitPathBuilder', () => {
  /**
   * La couture d'une courbe fermée doit tomber à l'OPPOSÉ du corps affiché, pas sur lui :
   * sinon elle traverse le corps que l'utilisateur regarde et se déplace avec le temps.
   * D'où l'échantillonnage centré sur la date courante, de −½ à +½ période.
   */
  it('place la couture à l’opposé du corps et la referme exactement', () => {
    const builder = makeBuilder(
      'explo',
      (date) => new THREE.Vector3(date.getTime() / DAY_MS, 0, 0)
    );
    const config = {
      kind: 'asteroid',
      radius: 0.1,
      rotationSpeed: 0,
      orbitalColor: 0xffffff,
      textureResolutions: {},
      textures: {},
      realData: { distanceAU: 2, orbitPeriodDays: 8 },
    } as CelestialBodyConfig;
    const date = new Date('2026-08-02T00:00:00Z');

    const points = builder.computeOrbitPoints('test', config, date, 4);
    expect(points).not.toBeNull();

    const seamStart = points![0];
    const seamEnd = points![12];
    // Une demi-période AVANT la date courante.
    expect(seamStart).toBeCloseTo((date.getTime() / DAY_MS - 4) * 35);
    // Et la courbe se referme exactement dessus.
    expect(seamEnd).toBeCloseTo(seamStart);
    // Surtout pas sur la position courante du corps.
    expect(seamStart).not.toBeCloseTo((date.getTime() / DAY_MS) * 35);
  });

  /**
   * Le mode Éducatif compresse la distance RADIALEMENT (√), il n'aplatit pas l'orbite en
   * cercle. Une orbite dont le rayon varie doit donc continuer à varier après compression —
   * c'est ce qui distingue « compressé » de « circularisé ».
   */
  it('conserve la variation radiale réelle en mode Éducatif', () => {
    const builder = makeBuilder('educ', (date) => {
      const phase = (date.getTime() / DAY_MS) % 8;
      return new THREE.Vector3(
        1.5 + 0.5 * Math.cos((phase / 8) * Math.PI * 2),
        0,
        0
      );
    });
    const config = { realData: { orbitPeriodDays: 8 } } as CelestialBodyConfig;

    const points = builder.computeOrbitPoints(
      'test',
      config,
      new Date('2026-08-02T00:00:00Z'),
      8
    );
    const radii = [0, 1, 2, 3].map((i) => Math.abs(points![i * 3]));
    expect(
      new Set(radii.map((radius) => radius.toFixed(6))).size
    ).toBeGreaterThan(1);
  });

  /** Sans période orbitale, il n'y a pas de courbe à tracer — et surtout pas une de longueur nulle. */
  it('renvoie null pour un corps sans période orbitale', () => {
    const builder = makeBuilder('educ', () => new THREE.Vector3(1, 0, 0));
    const config = { realData: {} } as CelestialBodyConfig;
    expect(
      builder.computeOrbitPoints('test', config, new Date(), 8)
    ).toBeNull();
  });
});
