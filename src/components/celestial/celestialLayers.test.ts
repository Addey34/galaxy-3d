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
