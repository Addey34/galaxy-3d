import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCloudsMaterial, createSurfaceMaterial } from './layerConfig';
import { EARTH_OCEAN_ROUGHNESS_SETTINGS } from './engine';

describe('MODIS cloud-fraction shader', () => {
  it('converts NASA percentage palette values to shader fractions', () => {
    const material = createCloudsMaterial();
    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];

    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(shader.fragmentShader).toContain('return (12.0 + g) / 100.0;');
    expect(shader.fragmentShader).toContain('return (95.0 + b) / 100.0;');
    expect(shader.fragmentShader).not.toContain('return 12.0 + g / 100.0;');
    expect(shader.fragmentShader).toContain(
      'float dayGapAlpha = dayAlpha * ( 1.0 - nightCoverage )'
    );
    expect(shader.fragmentShader).toContain('uCloudOpticalBlendRadiusTexels');
    expect(shader.fragmentShader).toContain(
      'float supplementalAlpha = max( nightFallbackAlpha, dayGapAlpha );'
    );
    // Jonction True Color ↔ masques MODIS : la True Color n'est JAMAIS atténuée (max, pas mix →
    // les nuages ne peuvent pas disparaître) ; le masque ne COMBLE que là où l'optique est faible
    // (pas de doublon en plein jour), pour une jonction douce au Sud sans « déchirure ».
    expect(shader.fragmentShader).toContain(
      'float supplementalFill = supplementalAlpha * ( 1.0 - opticalAvailability );'
    );
    expect(shader.fragmentShader).toContain(
      'rcAlpha = max( rcAlpha, supplementalFill );'
    );
    expect(shader.fragmentShader).toContain('( 1.0 - nightCoverage );');
    expect(shader.fragmentShader).not.toContain(
      'mix( rcAlpha, dayAlpha, dayCoverage )'
    );
    material.dispose();
  });
});

describe('Earth ocean PBR shader', () => {
  it('keeps Three.js specular lighting and maps white ocean data to low roughness', () => {
    const material = createSurfaceMaterial(false, undefined, false, true);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader:
        '#include <common>\n' +
        'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n' +
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n' +
        '#include <map_fragment>\n' +
        'roughnessFactor *= texelRoughness.g;',
    } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];

    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(shader.fragmentShader).toContain(
      'vec3 boundedSpecular = min( totalSpecular, vec3( 0.20 ) );'
    );
    expect(shader.fragmentShader).toContain(
      'roughnessFactor = mix( 0.92, earthOceanRoughness( vMapUv ), texelRoughness.g );'
    );
    expect(shader.fragmentShader).toContain(
      'uniform float uEarthOceanRoughnessVariation;'
    );
    expect(material.customProgramCacheKey()).toContain('-invrough-v2');
    expect(material.customProgramCacheKey()).toContain('-oceanrough-v1');
    expect(EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanBase).toBe(0.06);
    expect(EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanMin).toBeGreaterThanOrEqual(
      0.03
    );
    expect(EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanMax).toBeLessThanOrEqual(0.15);
    expect(EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanVariation).toBeLessThan(0.04);
    expect(shader.fragmentShader).toContain('cloudDirectFactor');
    expect(
      shader.fragmentShader.indexOf('float cloudDirectFactor')
    ).toBeLessThan(shader.fragmentShader.indexOf('#ifdef USE_MAP'));
    expect(shader.fragmentShader).not.toContain('gOceanSpec');
    expect(shader.fragmentShader).not.toContain('uGlintStrength');
    material.dispose();
  });
});
