import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import CelestialObject from './CelestialObject';
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { TextureSystem } from '@/components/systems/TextureSystem';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { getEclipseShadowUniforms } from '@/config/layerConfig';

/**
 * UN CARREAU D'IMAGERIE STREAMÉE PORTE L'OMBRE DE LA SPHÈRE QU'IL RECOUVRE (2026-10-07).
 *
 * Seule la sphère recevait la teinte cuivrée d'une éclipse de Lune : un carreau LROC restait gris
 * dans l'ombre de la Terre. Invisible tant que l'ombre le laissait presque noir, le défaut est
 * apparu quand la Lune suivie a été compensée de son ombre réfractée, et la garde e2e
 * `eclipseLanding.spec.ts` a lu 1,36 au lieu de plus de 2,5 au premier essai, sur deux runs de CI
 * de suite, là où les carreaux étaient arrivés. Ici, sans réseau ni rendu.
 */
const textureSystem = {
  getLODTexture: () => new Promise<never>(() => {}),
} as unknown as TextureSystem;
const animationSystem = {
  addUpdatable: () => {},
} as unknown as AnimationSystem;

const moonConfig = CELESTIAL_CONFIG.bodies['earth']!.satellites!['moon']!;
const makeMoon = () =>
  new CelestialObject(textureSystem, moonConfig, 'moon', animationSystem);

// Clé de `config/layerConfig.ts` (`SHADOW_AWARE_UNIFORM_KEY`, non exportée).
const attenuationOf = (material: THREE.Material): number | undefined =>
  (
    material.userData['__lightAttenuationUniform'] as
      { value: number } | undefined
  )?.value;

describe('carreau posé sur une sphère : même ombre que la sphère', () => {
  it('la sphère de la Lune porte bien une ombre d’éclipse par fragment', () => {
    const moon = makeMoon();
    const surface = (
      moon as unknown as { layers: Map<string, THREE.Mesh> }
    ).layers.get('surface')!;
    expect(
      getEclipseShadowUniforms(surface.material as THREE.Material)
    ).toBeDefined();
  });

  it('un carreau créé APRÈS la teinte la reçoit', () => {
    const moon = makeMoon();
    moon.setUmbraTint([1.6, 0.7, 0.3]);
    const tile = moon.createSurfaceOverlayMaterial();
    const tint = getEclipseShadowUniforms(tile)!.umbraTint.value;
    expect([tint.r, tint.g, tint.b]).toEqual([1.6, 0.7, 0.3]);
  });

  it('un carreau créé AVANT la teinte la reçoit aussi', () => {
    const moon = makeMoon();
    const tile = moon.createSurfaceOverlayMaterial();
    moon.setUmbraTint([1.6, 0.7, 0.3]);
    const tint = getEclipseShadowUniforms(tile)!.umbraTint.value;
    expect([tint.r, tint.g, tint.b]).toEqual([1.6, 0.7, 0.3]);
  });

  it('un carreau suit la source de l’ombre (Explo, par fragment)', () => {
    const moon = makeMoon();
    const tile = moon.createSurfaceOverlayMaterial();
    moon.setEclipseShadowSource(
      new THREE.Vector3(1, 2, 3),
      5,
      new THREE.Vector3(4, 5, 6),
      0.5,
      true
    );
    const u = getEclipseShadowUniforms(tile)!;
    expect(u.sunRadius.value).toBe(5);
    expect(u.occluderRadius.value).toBe(0.5);
    expect(u.occluderRefracts.value).toBe(1);
    expect(u.occluderPosition.value.toArray()).toEqual([4, 5, 6]);
  });

  it('un carreau créé entre deux passes prend l’atténuation courante', () => {
    const moon = makeMoon();
    moon.setLightAttenuation(0.7);
    const tile = moon.createSurfaceOverlayMaterial();
    expect(attenuationOf(tile)).toBeCloseTo(0.7, 12);
  });
});
