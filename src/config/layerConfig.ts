/**
 * Fabriques de g�om�tries et de mat�riaux partag�es par tous les corps c�lestes.
 * Centralise les conventions de rendu : facteurs d'�chelle des couches (surface, nuages,
 * atmosph�re, lumi�res), finesse des sph�res/anneaux et mat�riaux standard r�utilis�s.
 */
import * as THREE from 'three';

const SHADOW_AWARE_UNIFORM_KEY = '__lightAttenuationUniform';

// Chaque couche est l�g�rement plus grande que la pr�c�dente pour �viter le
// z-fighting (deux surfaces co�ncidentes causent du scintillement GPU).
// `lights` est � 1.002 et non 1.01 : trop �loign� du mesh surface casse
// le calcul de la direction lumi�re dans le shader (d�calage visible � l'oeil).
export const LAYER_RADIUS_SCALE: Record<string, number> = {
  surface: 1.0,
  clouds: 1.01,
  atmosphere: 1.02,
  lights: 1.002,
};

// 64 segments pour les plan�tes : bon compromis silhouette/perf (� 8 k triangles).
// 128 pour les anneaux de Saturne : la g�om�trie RingGeometry est plate, mais ses
// subdivisions radiales d�terminent la pr�cision des UVs corrig�s (_correctRingUVs).
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
    color: fallbackColor,
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
