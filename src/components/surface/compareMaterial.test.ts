import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { createSurfaceLayerMaterial } from '@/components/celestial/celestialLayers';
import { COMPARE_SPLIT, compareMapOf, setCompareMap } from './compareMaterial';

/**
 * LE PATCH DU RIDEAU (lot 50, pas 2), sur le VRAI matériau que la Terre donne à ses carreaux : il
 * porte déjà ses propres patchs (ombre, terminateur, clair de Lune…), et le rideau doit passer
 * derrière eux sans les défaire.
 */
function compile(
  material: THREE.Material
): THREE.WebGLProgramParametersWithUniforms {
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

const earthMaterial = () =>
  createSurfaceLayerMaterial(
    new Map([...flattenBodies(CELESTIAL_CONFIG)]).get('earth')!,
    'earth'
  );

describe('le patch du rideau', () => {
  it('choisit la carte selon le côté de la ligne, derrière les patchs de la Terre', () => {
    const plain = compile(earthMaterial());
    const material = earthMaterial();
    const texture = new THREE.Texture();
    setCompareMap(material, texture);
    const shader = compile(material);

    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    expect(shader.fragmentShader).toContain('gl_FragCoord.x < uCompareSplitX');
    expect(shader.uniforms['uCompareMap']!.value).toBe(texture);
    // UN objet partagé par tous les carreaux : le rideau le déplace une fois pour tous.
    expect(shader.uniforms['uCompareSplitX']).toBe(COMPARE_SPLIT);
    // Ce que les patchs du corps ont AJOUTÉ après l'include reste en place.
    const added = plain.fragmentShader
      .split('#include <map_fragment>')[1]!
      .slice(0, 200);
    expect(shader.fragmentShader).toContain(added);
  });

  it('distingue son programme de celui d’un carreau sans rideau, et ne se pose qu’une fois', () => {
    const plain = earthMaterial();
    const material = earthMaterial();
    setCompareMap(material, new THREE.Texture());
    expect(material.customProgramCacheKey()).not.toBe(
      plain.customProgramCacheKey()
    );
    const next = new THREE.Texture();
    const key = material.customProgramCacheKey();
    setCompareMap(material, next);
    expect(compareMapOf(material)).toBe(next);
    expect(material.customProgramCacheKey()).toBe(key);
    expect(compareMapOf(plain)).toBeNull();
  });
});
