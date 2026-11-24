import * as THREE from 'three';
import type { SurfaceHost } from './PlanetarySurfaceEngine';
import { createRegionalCloudMaterial } from './cloudShellMaterial';

/** Ce que la façade demande de la Terre en plus de l'interface du moteur. */
export interface CloudShellEarth extends SurfaceHost {
  getOceanMask(): THREE.Texture | null;
  adoptOverlayMaterial(material: THREE.Material): void;
}

/**
 * LA COQUE DES NUAGES VUE PAR LE MOTEUR DE TUILES (GAL-EARTH-CLOUD-REGIONAL-001).
 *
 * Le moteur d'imagerie ne demande à un corps que {@link SurfaceHost} : un rayon, un groupe (position
 * monde et rayon RENDU), un parent qui tourne, un matériau par carreau. Cette façade présente la Terre
 * comme une sphère plus grande de `scale` (la coque des nuages, `LAYER_RADIUS_SCALE.clouds`) : les
 * carreaux se posent à l'altitude des nuages de la scène, tournent avec le corps, et le moteur y règle
 * sa sélection (distance, subdivision, budget) sans qu'on y ajoute une ligne.
 *
 * Elle ne touche JAMAIS à la Terre : pas de plancher d'approche (la finesse déclarée est ignorée), pas de
 * relief, pas d'enveloppe abaissée. Une couche de nuages n'a ni sol ni hauteurs.
 */
export function createCloudShellHost(
  earth: CloudShellEarth,
  options: {
    /** Rapport du rayon de la coque à celui du corps (1,01 pour les nuages). */
    scale: number;
  }
): SurfaceHost {
  // Un groupe MIROIR : même position monde que la Terre, rayon rendu multiplié par `scale`. Il ne porte
  // aucun enfant (les carreaux vont au parent qui tourne, celui de la Terre).
  const proxy = new THREE.Object3D();
  proxy.getWorldPosition = (target: THREE.Vector3): THREE.Vector3 =>
    earth.group.getWorldPosition(target);
  Object.defineProperty(proxy.userData, 'radius', {
    get: () =>
      ((earth.group.userData['radius'] as number | undefined) ?? 0) *
      options.scale,
    enumerable: true,
  });

  return {
    name: `${earth.name}-clouds`,
    layerRadius: earth.layerRadius * options.scale,
    figure: null,
    group: proxy,
    attachSpinningChild: (object) => earth.attachSpinningChild(object),
    createSurfaceOverlayMaterial: (_oceanMatch, tile) => {
      const material = createRegionalCloudMaterial(tile, earth.getOceanMask());
      // Éclairage et ombre d'éclipse de la Terre : un nuage régional suit le même Soleil que la coque.
      earth.adoptOverlayMaterial(material);
      return material;
    },
    releaseSurfaceOverlayMaterial: (material) =>
      earth.releaseSurfaceOverlayMaterial(material),
    hasOceanMask: () => false,
    worldPointToGeographic: (point) => earth.worldPointToGeographic(point),
    // La finesse des nuages ne borne pas la caméra : le plancher d'approche reste celui du SOL.
    setStreamedImageryWidth: () => false,
    shippedSurfaceWidthPx: () => 2048,
    setSurfaceShellScale: () => undefined,
  };
}
