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

  it('creates an additive back-side atmosphere mesh for Earth', () => {
    const earth = CELESTIAL_CONFIG.bodies.earth;
    const layers = buildLayers(earth, 'earth');
    const atmosphere = layers.get('atmosphere');

    expect(atmosphere?.name).toBe('earth_atmosphere');
    expect(atmosphere?.material).toBeInstanceOf(THREE.ShaderMaterial);
    const material = atmosphere?.material as THREE.ShaderMaterial;
    expect(material.transparent).toBe(true);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.side).toBe(THREE.BackSide);
    expect(AtmosphereShader.fragmentShader).toContain('rayleighBeta');
    expect(AtmosphereShader.fragmentShader).toContain('miePhase');
    expect(AtmosphereShader.fragmentShader).toContain('transmission');
    expect(material.uniforms.uRayleighStrength?.value).toBeGreaterThan(0);
    expect(material.uniforms.uMieStrength?.value).toBeGreaterThan(0);
    expect(material.uniforms.uMieG?.value).toBeCloseTo(0.76);

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
