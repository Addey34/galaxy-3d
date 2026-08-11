/**
 * Fabriques de géométries et de matériaux partagées par tous les corps célestes.
 * Centralise les conventions de rendu : facteurs d'échelle des couches (surface, nuages,
 * atmosphère, lumières), finesse des sphères/anneaux et matériaux standard réutilisés.
 */
import * as THREE from 'three';

const SHADOW_AWARE_UNIFORM_KEY = '__lightAttenuationUniform';

// Chaque couche est légèrement plus grande que la précédente pour éviter le
// z-fighting (deux surfaces coïncidentes causent du scintillement GPU).
// `lights` est à 1.002 et non 1.01 : trop éloigné du mesh surface casse
// le calcul de la direction lumière dans le shader (décalage visible à l'oeil).
export const LAYER_RADIUS_SCALE: Record<string, number> = {
  surface: 1.0,
  clouds: 1.01,
  atmosphere: 1.02,
  lights: 1.002,
};

// 64 segments pour les planètes : bon compromis silhouette/perf (≈ 8 k triangles).
// 128 pour les anneaux de Saturne : la géométrie RingGeometry est plate, mais ses
// subdivisions radiales déterminent la précision des UVs corrigés (_correctRingUVs).
export const GEOMETRY_SEGMENTS = 64;
export const RING_SEGMENTS = 128;

export function createSphereGeometry(
  radius: number,
  layerType = 'surface'
): THREE.SphereGeometry {
  const scale = LAYER_RADIUS_SCALE[layerType] ?? 1.0;
  return new THREE.SphereGeometry(
    radius * scale,
    GEOMETRY_SEGMENTS,
    GEOMETRY_SEGMENTS
  );
}

export function createSurfaceMaterial(
  isSun: boolean,
  fallbackColor?: number
): THREE.MeshBasicMaterial | THREE.MeshStandardMaterial {
  if (isSun) {
    return new THREE.MeshBasicMaterial({ color: 0xffff00 });
  }
  return createShadowAwareStandardMaterial({
    color: fallbackColor ?? 0xffffff,
    roughness: 0.7,
    metalness: 0.0,
  });
}

export function createCloudsMaterial(): THREE.MeshStandardMaterial {
  return createShadowAwareStandardMaterial({
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createAtmosphereMaterial(): THREE.MeshStandardMaterial {
  return createShadowAwareStandardMaterial({
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createRingMaterial(): THREE.MeshStandardMaterial {
  return createShadowAwareStandardMaterial({
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    roughness: 0.8,
  });
}

export function createShadowAwareStandardMaterial(
  params: THREE.MeshStandardMaterialParameters
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(params);
  const attenuationUniform = { value: 1 };

  material.userData[SHADOW_AWARE_UNIFORM_KEY] = attenuationUniform;
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uLightAttenuation'] = attenuationUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uLightAttenuation;'
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        'vec3 outgoingLight = (totalDiffuse + totalSpecular) * uLightAttenuation + totalEmissiveRadiance;'
      );
  };
  material.customProgramCacheKey = () => 'shadow-aware-standard-v1';

  return material;
}

export function configureShadows(
  mesh: THREE.Mesh,
  castShadow: boolean,
  receiveShadow: boolean
): void {
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
}

export function setMaterialLightAttenuation(
  material: THREE.Material,
  attenuation: number
): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  const uniform = material.userData[SHADOW_AWARE_UNIFORM_KEY] as
    { value: number } | undefined;
  if (uniform) uniform.value = attenuation;
}
