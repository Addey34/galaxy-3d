import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyTexture,
  configureTextureColorSpace,
  EARTH_DISPLACEMENT_SCALE,
  EARTH_NORMAL_SCALE_WITH_DISPLACEMENT,
} from './celestialTextures';

describe('celestial texture color spaces', () => {
  it('keeps color layers in sRGB', () => {
    for (const key of ['surface', 'clouds', 'atmosphere', 'lights', 'ring']) {
      const texture = new THREE.Texture();
      configureTextureColorSpace(key, texture);
      expect(texture.colorSpace, key).toBe(THREE.SRGBColorSpace);
      texture.dispose();
    }
  });

  it('keeps data maps linear', () => {
    for (const key of [
      'normalMap',
      'bump',
      'displacement',
      'spec',
      'specularMap',
    ]) {
      const texture = new THREE.Texture();
      configureTextureColorSpace(key, texture);
      expect(texture.colorSpace, key).toBe(THREE.NoColorSpace);
      texture.dispose();
    }
  });
});

describe('cloud ocean-mask texture identity', () => {
  it('passes the unchanged spec texture through roughnessMap', () => {
    const spec = new THREE.Texture();
    const surface = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial()
    );
    const layers = new Map([['surface', surface]]);

    applyTexture(layers, 'spec', spec);

    expect((surface.material as THREE.MeshStandardMaterial).roughnessMap).toBe(
      spec
    );

    surface.geometry.dispose();
    (surface.material as THREE.Material).dispose();
    spec.dispose();
  });
});
describe('Earth displacement attachment', () => {
  it('uses a linear height map and reduces overlapping normal relief', () => {
    const surfaceMaterial = new THREE.MeshStandardMaterial();
    const surface = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMaterial);
    const normal = new THREE.Texture();
    const displacement = new THREE.Texture();
    const layers = new Map([['surface', surface]]);

    applyTexture(layers, 'normalMap', normal);
    applyTexture(layers, 'displacement', displacement);

    expect(surfaceMaterial.displacementMap).toBe(displacement);
    expect(surfaceMaterial.displacementScale).toBe(EARTH_DISPLACEMENT_SCALE);
    expect(surfaceMaterial.normalScale.x).toBe(
      EARTH_NORMAL_SCALE_WITH_DISPLACEMENT
    );
    expect(surfaceMaterial.normalScale.y).toBe(
      EARTH_NORMAL_SCALE_WITH_DISPLACEMENT
    );
    expect(displacement.colorSpace).toBe(THREE.NoColorSpace);

    surface.geometry.dispose();
    surfaceMaterial.dispose();
    normal.dispose();
    displacement.dispose();
  });
});

describe('equirectangular cloud wrapping', () => {
  it('wraps longitude but clamps both poles', () => {
    const texture = new THREE.Texture();
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial()
    );
    const layers = new Map([['clouds', mesh]]);

    applyTexture(layers, 'clouds', texture);

    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    texture.dispose();
  });
});
