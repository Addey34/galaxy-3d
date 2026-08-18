/**
 * Applies a loaded texture to the correct layer/material of a celestial body.
 * Texture ownership remains with TextureSystem; this module only attaches maps.
 */
import * as THREE from 'three';
import * as NightLightsShader from '@/shaders/NightLightsShader';

type Layers = Map<string, THREE.Mesh>;

const SURFACE_TEXTURE_TYPES = [
  'surface',
  'normalMap',
  'bump',
  'displacement',
  'spec',
  'specularMap',
];

/** Physical Earth relief: 8,849 m / 6,371 km, expressed with Earth radius = 1. */
export const EARTH_DISPLACEMENT_SCALE = 0.0014;
/** Keep only small-scale shading after large-scale DEM geometry is displaced. */
export const EARTH_NORMAL_SCALE_WITH_DISPLACEMENT = 0.4;

const DATA_TEXTURE_TYPES = new Set([
  'normalMap',
  'bump',
  'displacement',
  'spec',
  'specularMap',
]);

export function configureTextureColorSpace(
  textureKey: string,
  texture: THREE.Texture
): void {
  texture.colorSpace = DATA_TEXTURE_TYPES.has(textureKey)
    ? THREE.NoColorSpace
    : THREE.SRGBColorSpace;
}

export function applyTexture(
  layers: Layers,
  textureKey: string,
  texture: THREE.Texture
): void {
  configureTextureColorSpace(textureKey, texture);
  if (SURFACE_TEXTURE_TYPES.includes(textureKey)) {
    applySurfaceTexture(layers, textureKey, texture);
    return;
  }
  const handlers: Record<string, () => void> = {
    clouds: () => applyCloudsTexture(layers, texture),
    lights: () => applyLightsTexture(layers, texture),
  };
  handlers[textureKey]?.();
}

function applySurfaceTexture(
  layers: Layers,
  textureKey: string,
  texture: THREE.Texture
): void {
  const mesh = layers.get('surface');
  if (!mesh) return;
  const mat = mesh.material as THREE.MeshStandardMaterial;

  switch (textureKey) {
    case 'surface':
      mat.map = texture;
      break;
    case 'normalMap': {
      mat.normalMap = texture;
      const scale = mat.displacementMap
        ? EARTH_NORMAL_SCALE_WITH_DISPLACEMENT
        : 1;
      mat.normalScale = new THREE.Vector2(scale, scale);
      applyLightsNormalMap(layers, texture, mat.normalScale);
      break;
    }
    case 'bump':
      mat.bumpMap = texture;
      mat.bumpScale = 0.05;
      break;
    case 'displacement':
      mat.displacementMap = texture;
      mat.displacementScale = EARTH_DISPLACEMENT_SCALE;
      if (mat.normalMap) {
        mat.normalScale.set(
          EARTH_NORMAL_SCALE_WITH_DISPLACEMENT,
          EARTH_NORMAL_SCALE_WITH_DISPLACEMENT
        );
        applyLightsNormalMap(layers, mat.normalMap, mat.normalScale);
      }
      break;
    case 'spec':
    case 'specularMap':
      mat.roughnessMap = texture;
      mat.roughness = 1.0;
      break;
  }
  mat.needsUpdate = true;
}

function applyCloudsTexture(layers: Layers, texture: THREE.Texture): void {
  const mesh = layers.get('clouds');
  if (!mesh) return;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.map = texture;
  mat.alphaMap = texture;
  mat.needsUpdate = true;
}

function applyLightsTexture(layers: Layers, texture: THREE.Texture): void {
  const mesh = layers.get('lights');
  if (!(mesh?.material instanceof THREE.ShaderMaterial)) return;
  const uniforms = mesh.material
    .uniforms as unknown as NightLightsShader.NightLightsUniforms;
  uniforms.lightsMap.value = texture;
  mesh.material.needsUpdate = true;
}

function applyLightsNormalMap(
  layers: Layers,
  texture: THREE.Texture,
  normalScale: THREE.Vector2
): void {
  const mesh = layers.get('lights');
  if (!(mesh?.material instanceof THREE.ShaderMaterial)) return;
  const uniforms = mesh.material
    .uniforms as unknown as NightLightsShader.NightLightsUniforms;
  uniforms.normalMap.value = texture;
  uniforms.normalScale.value.copy(normalScale);
  uniforms.useNormalMap.value = 1;
  mesh.material.needsUpdate = true;
}
