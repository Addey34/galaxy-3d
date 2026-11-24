import { getSky } from '@/shaders/SkyScatteringShader';
import { attachSky } from './skyLayer';
import { ATTACHED_SKIES } from './skyApproach';
import { skyScattering } from '@/core/atmosphereScattering';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildLayers } from './celestialLayers';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import * as AtmosphereShader from '@/shaders/AtmosphereShader';

describe('celestial atmosphere capability', () => {
  it('declares an atmosphere color for Earth without requiring a bitmap', () => {
    expect(CELESTIAL_CONFIG.bodies.earth.atmosphereColor).toBeDefined();
    expect(
      CELESTIAL_CONFIG.bodies.earth.textureResolutions.atmosphere
    ).toBeUndefined();
  });

  it('gives the Earth a computed sky on approach, from the model its fiche declares', () => {
    const earth = CELESTIAL_CONFIG.bodies.earth;
    expect(earth.skyScattering).toBe('bruneton-2017');
    const layers = buildLayers(earth, 'earth');
    const atmosphere = layers.get('atmosphere')!;
    expect(atmosphere.name).toBe('earth_atmosphere');
    // Au démarrage, le halo de Fresnel : le ciel arrive dans son propre morceau, à l'approche.
    const halo = atmosphere.material as THREE.ShaderMaterial;
    expect(getSky(halo)).toBeUndefined();

    const binding = attachSky(
      {
        group: new THREE.Group(),
        renderedRadius: () => 1,
        figureRatioToward: () => 1,
        sunWorld: new THREE.Vector3(1e6, 0, 0),
      },
      earth.skyScattering!,
      6371,
      atmosphere
    );
    const material = atmosphere.material as THREE.ShaderMaterial;
    const sky = getSky(material);
    expect(sky, 'le ciel calculé de la Terre').toBeDefined();
    // Face ARRIÈRE de la coque : le halo vu de l'extérieur, la voûte vue de l'intérieur.
    expect(material.side).toBe(THREE.BackSide);
    // Ce que l'air diffuse s'AJOUTE ; ce qui est derrière lui en sort atténué.
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendSrc).toBe(THREE.OneFactor);
    expect(material.blendDst).toBe(THREE.SrcAlphaFactor);
    const model = skyScattering('bruneton-2017');
    expect(sky!.thicknessKm).toBe(model.thicknessKm);
    expect(sky!.uniforms.uRayleigh.value.toArray()).toEqual(
      model.rayleighScatteringPerKm
    );
    // Hors de l'air, les étoiles ne sont pas touchées ; au sol à midi, elles disparaissent.
    expect(binding.starVisibilityFrom(new THREE.Vector3(0, 0, 3))).toBe(1);
    expect(binding.starVisibilityFrom(new THREE.Vector3(1.0001, 0, 0))).toBe(0);

    // Posé, il s'inscrit parmi les ciels que la boucle de rendu interroge pour les étoiles.
    expect(ATTACHED_SKIES.has(binding)).toBe(true);

    binding.dispose();
    expect(ATTACHED_SKIES.has(binding)).toBe(false);
    expect(atmosphere.material).toBe(halo);
    for (const mesh of layers.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });

  it('keeps the Fresnel halo where no published single-scattering model applies (Venus)', () => {
    const venus = CELESTIAL_CONFIG.bodies.venus;
    expect(venus.skyScattering).toBeUndefined();
    const layers = buildLayers(venus, 'venus');
    const material = layers.get('atmosphere')?.material as THREE.ShaderMaterial;
    expect(getSky(material)).toBeUndefined();
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.side).toBe(THREE.BackSide);
    expect(AtmosphereShader.fragmentShader).toContain('miePhase');
    expect(material.uniforms.uRayleighStrength?.value).toBeGreaterThan(0);

    for (const mesh of layers.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
});

/**
 * QUI RÉFRACTE DANS SON OMBRE — le critère que lit `CelestialObject.refractsLight` pour
 * décider si une ombre portée est cuivrée (la Terre sur la Lune) ou neutre (la Lune sur la
 * Terre). Il vient de la couche atmosphère construite depuis le CATALOGUE, jamais d'un nom :
 * ajouter un corps à atmosphère suffit, il n'y a pas de liste à tenir à jour ailleurs.
 */
describe('couche atmosphère = occulteur qui réfracte', () => {
  it.each([
    ['earth', CELESTIAL_CONFIG.bodies.earth, true],
    ['venus', CELESTIAL_CONFIG.bodies.venus, true],
    ['moon', CELESTIAL_CONFIG.bodies.earth.satellites!.moon!, false],
    ['mercury', CELESTIAL_CONFIG.bodies.mercury, false],
  ] as const)('%s', (name, config, refracts) => {
    const layers = buildLayers(config, name);
    expect(layers.has('atmosphere')).toBe(refracts);
    for (const mesh of layers.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
});

describe('la sphère d’un corps à modèle de forme (GAL-ENGINE-HEADROOM-001)', () => {
  const triangles = (
    config: (typeof CELESTIAL_CONFIG.bodies)[string],
    name: string
  ): number => {
    const geometry = (buildLayers(config, name).get('surface') as THREE.Mesh)
      .geometry;
    return (
      (geometry.index
        ? geometry.index.count
        : geometry.getAttribute('position').count) / 3
    );
  };

  it('est une sphère légère : retirer le maillage du démarrage ne doit pas faire monter le nombre de triangles', () => {
    // Mesuré en CI : sans cette sphère légère, la vue d'ensemble passait de 973 905 à 1 194 001 triangles.
    for (const [name, config] of Object.entries(CELESTIAL_CONFIG.bodies)) {
      if (!config.model) continue;
      expect(triangles(config, name), name).toBeLessThan(1500);
    }
  });

  it('un corps sans modèle garde la sphère ordinaire (les planètes ne sont pas dégradées)', () => {
    expect(triangles(CELESTIAL_CONFIG.bodies.earth, 'earth')).toBeGreaterThan(
      7000
    );
  });

  it('au moins un corps a un modèle (la garde ne porte pas sur un ensemble vide)', () => {
    expect(
      Object.values(CELESTIAL_CONFIG.bodies).filter((c) => c.model).length
    ).toBeGreaterThan(10);
  });
});
