import { getSky } from '@/shaders/SkyScatteringShader';
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

  it('gives the Earth a computed sky, from the model its fiche declares', () => {
    const earth = CELESTIAL_CONFIG.bodies.earth;
    expect(earth.skyScattering).toBe('bruneton-2017');
    const layers = buildLayers(earth, 'earth');
    const atmosphere = layers.get('atmosphere');

    expect(atmosphere?.name).toBe('earth_atmosphere');
    const material = atmosphere?.material as THREE.ShaderMaterial;
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
    expect(sky!.uniforms.uMieG.value).toBe(model.mieG);

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
