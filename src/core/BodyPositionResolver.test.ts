import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Body } from 'astronomy-engine';
import type { CelestialBodyConfig } from '@/types';
import { BodyPositionResolver } from './BodyPositionResolver';
import type { EphemerisService } from './EphemerisService';
import type { OrbitalElementsService } from './OrbitalElementsService';
import type { PreciseEphemerisProvider } from './PreciseEphemerisProvider';

/**
 * ORDRE DE PRIORITÉ DES SOURCES DE POSITION.
 *
 * Ces cas existaient déjà, mais ils devaient passer par `Object.create` sur une classe de
 * 900 lignes et appeler une méthode privée, faute de module à qui poser la question. Ils
 * construisent désormais le vrai `BodyPositionResolver` avec des services doublés : ce qui
 * est vérifié est la règle publique, plus un détail d'implémentation atteint par réflexion.
 *
 * Ce que la règle doit garantir, et qui a déjà été cassé en production :
 *   - un satellite reste dans le repère de son PARENT, jamais héliocentrique ;
 *   - la source précise prime quand elle couvre, le repli prend le relais sinon ;
 *   - une réponse précise mais implausible est rejetée, pas affichée.
 */

const DATE = new Date('2026-08-09T00:00:00Z');

/** Éléments circulaires minimaux — seule leur identité compte dans ces cas. */
function elementsAt(semiMajorAxisAU: number) {
  return {
    semiMajorAxisAU,
    eccentricity: 0,
    inclinationRad: 0,
    ascendingNodeRad: 0,
    argPerihelionRad: 0,
    meanAnomalyAtEpochRad: 0,
    epoch: new Date('2026-01-01T00:00:00Z'),
  };
}

function makeResolver(parts: {
  horizons?: Partial<PreciseEphemerisProvider>;
  elements?: Partial<OrbitalElementsService>;
  ephemeris?: Partial<EphemerisService>;
  parentName?: Map<string, string>;
  parentAstroBody?: Map<string, Body>;
}): BodyPositionResolver {
  return new BodyPositionResolver(
    (parts.ephemeris ?? {}) as EphemerisService,
    (parts.elements ?? {}) as OrbitalElementsService,
    {
      getHeliocentricAU: () => null,
      getParentRelativeAU: () => null,
      ...parts.horizons,
    } as PreciseEphemerisProvider,
    parts.parentName ?? new Map(),
    parts.parentAstroBody ?? new Map()
  );
}

describe('BodyPositionResolver', () => {
  it('utilise les éléments RELATIFS pour un corps parent-relative', () => {
    const relative = elementsAt(0.008);
    const absolute = elementsAt(2);
    const getHeliocentricAU = vi.fn(
      (el: { semiMajorAxisAU: number }) =>
        new THREE.Vector3(el.semiMajorAxisAU, 0, 0)
    );
    const resolver = makeResolver({ elements: { getHeliocentricAU } });

    const config = {
      kind: 'moon',
      frame: 'parentRelative',
      radius: 1,
      rotationSpeed: 0,
      orbitalColor: 0xffffff,
      textureResolutions: {},
      textures: {},
      relativeOrbitalElements: relative,
      // Piège volontaire : un jeu ABSOLU coexiste. Le confondre avec le relatif placerait
      // la lune à 2 UA de sa planète.
      orbitalElements: absolute,
    } as CelestialBodyConfig;

    expect(resolver.resolve('titan', config, DATE)?.x).toBe(0.008);
    // La période catalogue est jointe aux éléments (cf. `OrbitalElements.periodDays`), donc
    // on vérifie l'identité des éléments transmis, pas l'égalité stricte de l'objet.
    expect(getHeliocentricAU).toHaveBeenCalledWith(
      expect.objectContaining({ semiMajorAxisAU: 0.008 }),
      DATE
    );
  });

  it('garde un corps parent-relative dans le repère de son parent', () => {
    const getHeliocentricAU = vi.fn(() => new THREE.Vector3(9, 0, 0));
    const getParentRelativeAU = vi.fn(() => new THREE.Vector3(0.001, 0, 0));
    const resolver = makeResolver({
      horizons: { getHeliocentricAU, getParentRelativeAU },
      parentName: new Map([['moon', 'earth']]),
    });

    const config = {
      kind: 'moon',
      frame: 'parentRelative',
      radius: 0.1,
      textureResolutions: {},
      textures: {},
    } as CelestialBodyConfig;

    expect(resolver.resolve('moon', config, DATE)?.x).toBe(0.001);
    expect(getParentRelativeAU).toHaveBeenCalledWith('moon', 'earth', DATE);
    // Le point qui compte : la lecture héliocentrique ne doit JAMAIS être tentée pour un
    // corps imbriqué — l'utiliser sous le groupe du parent appliquerait le parent deux fois.
    expect(getHeliocentricAU).not.toHaveBeenCalled();
  });

  it('rejette un vecteur précis hors de l’orbite publiée du parent', () => {
    const relative = elementsAt(0.008);
    const getHeliocentricAU = vi.fn(() => new THREE.Vector3(0.008, 0, 0));
    const resolver = makeResolver({
      horizons: {
        // 1 UA pour une lune dont l'orbite fait 0,008 UA : typiquement un fichier généré
        // avec le Soleil comme centre puis lu comme parent-relative.
        getParentRelativeAU: vi.fn(() => new THREE.Vector3(1, 0, 0)),
      },
      elements: { getHeliocentricAU },
      parentName: new Map([['moon', 'earth']]),
    });

    const config = {
      kind: 'moon',
      frame: 'parentRelative',
      radius: 0.1,
      textureResolutions: {},
      textures: {},
      relativeOrbitalElements: relative,
    } as CelestialBodyConfig;

    expect(resolver.resolve('moon', config, DATE)?.x).toBe(0.008);
    expect(getHeliocentricAU).toHaveBeenCalled();
  });

  it('rejette une éphéméride héliocentrique à la mauvaise distance planétaire', () => {
    const resolver = makeResolver({
      // 4,6 UA annoncés pour un corps attendu à 1,524 : la signature du bug « 699; »
      // qui résolvait un identifiant de planète vers un astéroïde homonyme.
      horizons: { getHeliocentricAU: () => new THREE.Vector3(4.6, 0, 0) },
      elements: { getHeliocentricAU: () => new THREE.Vector3(1.524, 0, 0) },
    });

    const config = {
      kind: 'planet',
      radius: 0.53,
      rotationSpeed: 0,
      orbitalColor: 0xffffff,
      textureResolutions: {},
      textures: {},
      realData: { distanceAU: 1.524 },
      orbitalElements: elementsAt(1.524),
    } as CelestialBodyConfig;

    expect(resolver.resolve('mars', config, DATE)?.length()).toBeCloseTo(
      1.524,
      8
    );
  });

  /**
   * `precise()` et `elementsOnly()` sont publiques parce que tracer une orbite entière exige
   * de savoir si la source précise couvre TOUTE la courbe — sinon le tracé épisse deux
   * trajectoires qui ne coïncident pas. Elles doivent donc rester strictement séparées :
   * `precise` ne doit jamais retomber sur les éléments, ni l'inverse.
   */
  it('sépare strictement source précise et repli', () => {
    const config = {
      kind: 'dwarf',
      radius: 0.1,
      textureResolutions: {},
      textures: {},
      realData: { distanceAU: 40 },
      orbitalElements: elementsAt(40),
    } as CelestialBodyConfig;

    const outOfCoverage = makeResolver({
      horizons: { getHeliocentricAU: () => null },
      elements: { getHeliocentricAU: () => new THREE.Vector3(40, 0, 0) },
    });
    // Hors couverture : la source précise dit `null` et ne se rabat sur rien.
    expect(outOfCoverage.precise('pluto', config, DATE)).toBeNull();
    // Les éléments répondent quand même — couverture infinie.
    expect(outOfCoverage.elementsOnly(config, DATE)?.x).toBe(40);
    // Et la règle de production combine les deux.
    expect(outOfCoverage.resolve('pluto', config, DATE)?.x).toBe(40);
  });

  it('renvoie null quand aucune source ne sait positionner le corps', () => {
    const resolver = makeResolver({});
    const config = {
      kind: 'moon',
      radius: 0.1,
      textureResolutions: {},
      textures: {},
    } as CelestialBodyConfig;

    expect(resolver.resolve('inconnu', config, DATE)).toBeNull();
  });
});
