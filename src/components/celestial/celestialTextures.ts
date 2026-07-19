/**
 * Application d'une texture chargée à la bonne couche/matériau d'un corps céleste.
 * Extrait de CelestialObject : la logique « quelle texture va où » vit ici, découplée
 * du cycle de vie de l'objet. Opère uniquement sur la map de couches passée en argument.
 */
import * as THREE from 'three';
import * as NightLightsShader from '@/shaders/NightLightsShader';

type Layers = Map<string, THREE.Mesh>;

const SURFACE_TEXTURE_TYPES = [
  'surface',
  'normalMap',
  'bump',
  'spec',
  'specularMap',
];

/** Route une texture (par clé) vers la couche qui la consomme. */
export function applyTexture(
  layers: Layers,
  textureKey: string,
  texture: THREE.Texture
): void {
  if (SURFACE_TEXTURE_TYPES.includes(textureKey)) {
    applySurfaceTexture(layers, textureKey, texture);
    return;
  }
  const handlers: Record<string, () => void> = {
    clouds: () => applyCloudsTexture(layers, texture),
    atmosphere: () => applyAtmosphereTexture(layers, texture),
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
    case 'normalMap':
      mat.normalMap = texture;
      mat.normalScale = new THREE.Vector2(1, 1);
      // Partage la normalMap avec le shader des lumières pour aligner les terminateurs.
      applyLightsNormalMap(layers, texture, mat.normalScale);
      break;
    case 'bump':
      mat.bumpMap = texture;
      mat.bumpScale = 0.05;
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
  texture.wrapT = THREE.RepeatWrapping;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.map = texture;
  mat.alphaMap = texture;
  mat.needsUpdate = true;
}

function applyAtmosphereTexture(layers: Layers, texture: THREE.Texture): void {
  const mesh = layers.get('atmosphere');
  if (!mesh) return;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.map = texture;
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

// Donne au shader des lumières la même normalMap que la surface : son terminateur
// suit alors le relief à l'identique, supprimant la bande sombre sans lumières.
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
