import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { configureTextureColorSpace } from './celestialTextures';

describe('celestial texture color spaces', () => {
  it('keeps color layers in sRGB', () => {
    for (const key of ['surface', 'clouds', 'atmosphere', 'lights', 'ring']) {
      const texture = new THREE.Texture();
      configureTextureColorSpace(key, texture);
      expect(texture.colorSpace, key).toBe(THREE.SRGBColorSpace);
    }
  });

  it('keeps data maps linear', () => {
    for (const key of ['normalMap', 'bump', 'spec', 'specularMap']) {
      const texture = new THREE.Texture();
      configureTextureColorSpace(key, texture);
      expect(texture.colorSpace, key).toBe(THREE.NoColorSpace);
    }
  });
});
