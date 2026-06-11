/**
 * Fabriques de géométries et de matériaux partagées par tous les corps célestes.
 * Centralise les conventions de rendu : facteurs d'échelle des couches (surface, nuages,
 * atmosphère, lumières), finesse des sphères/anneaux et matériaux standard réutilisés.
 */
import * as THREE from 'three';

// Chaque couche est légèrement plus grande que la précédente pour éviter le
// z-fighting (deux surfaces coïncidentes causent du scintillement GPU).
// `lights` est à 1.002 et non 1.01 : trop éloigné du mesh surface casse
// le calcul de la direction lumière dans le shader (décalage visible à l'oeil).
export const LAYER_RADIUS_SCALE: Record<string, number> = {
  surface:    1.0,
  clouds:     1.01,
  atmosphere: 1.02,
  lights:     1.002,
};

// 64 segments pour les planètes : bon compromis silhouette/perf (≈ 8 k triangles).
// 128 pour les anneaux de Saturne : la géométrie RingGeometry est plate, mais ses
// subdivisions radiales déterminent la précision des UVs corrigés (_correctRingUVs).
export const GEOMETRY_SEGMENTS = 64;
export const RING_SEGMENTS = 128;

export function createSphereGeometry(radius: number, layerType = 'surface'): THREE.SphereGeometry {
  const scale = LAYER_RADIUS_SCALE[layerType] ?? 1.0;
  return new THREE.SphereGeometry(radius * scale, GEOMETRY_SEGMENTS, GEOMETRY_SEGMENTS);
}

export function createSurfaceMaterial(isSun: boolean): THREE.MeshBasicMaterial | THREE.MeshStandardMaterial {
  if (isSun) {
    return new THREE.MeshBasicMaterial({ color: 0xffff00 });
  }
  return new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.0 });
}

export function createCloudsMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createAtmosphereMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createRingMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    roughness: 0.8,
  });
}

export function configureShadows(mesh: THREE.Mesh, castShadow: boolean, receiveShadow: boolean): void {
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
}
