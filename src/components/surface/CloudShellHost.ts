import * as THREE from 'three';
import type { SurfaceHost } from './PlanetarySurfaceEngine';
import { createRegionalCloudMaterial } from './cloudShellMaterial';
import type { RealCloudsUniforms } from '@/config/layerConfig';

/** Ce que la façade demande de la Terre en plus de l'interface du moteur. */
export interface CloudShellEarth extends SurfaceHost {
  /** Les uniformes des nuages réels de la couche mondiale, ou `undefined` sans couche nuages. */
  realCloudsUniforms(): RealCloudsUniforms | undefined;
  adoptOverlayMaterial(material: THREE.Material): void;
  /** Échelle de la coque mondiale, pour qu'elle reste à la même altitude que les carreaux régionaux. */
  setCloudShellScale(factor: number): void;
}

/** La façade, plus l'échelle de la coque (les carreaux et la coque mondiale descendent ENSEMBLE). */
export interface CloudShellHost extends SurfaceHost {
  setShellScale(factor: number): void;
  dispose(): void;
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
    /** Servie aussi de l'intérieur (le plafond vu d'en dessous) ; faux par `?cloud-interior=0`. */
    interior?: boolean;
  }
): CloudShellHost {
  // Les carreaux vont dans UN groupe à eux, enfant du parent qui tourne : son échelle rapproche la coque
  // du sol sans reconstruire un seul carreau.
  const tiles = new THREE.Group();
  tiles.name = 'regional-clouds';
  earth.attachSpinningChild(tiles);
  let shellScale = 1;
  // Un groupe MIROIR : même position monde que la Terre, rayon rendu multiplié par `scale`. Il ne porte
  // aucun enfant (les carreaux vont au parent qui tourne, celui de la Terre).
  const proxy = new THREE.Object3D();
  proxy.getWorldPosition = (target: THREE.Vector3): THREE.Vector3 =>
    earth.group.getWorldPosition(target);
  Object.defineProperty(proxy.userData, 'radius', {
    get: () =>
      ((earth.group.userData['radius'] as number | undefined) ?? 0) *
      options.scale *
      shellScale,
    enumerable: true,
  });

  return {
    name: `${earth.name}-clouds`,
    layerRadius: earth.layerRadius * options.scale,
    figure: null,
    group: proxy,
    attachSpinningChild: (object) => tiles.add(object),
    createSurfaceOverlayMaterial: (_oceanMatch, tile) => {
      const realClouds = earth.realCloudsUniforms();
      // Sans couche mondiale il n'y a rien à prolonger : le pilote ne s'attache pas dans ce cas (`cloudsOnScreen`).
      if (!realClouds)
        throw new Error('nuages régionaux sans couche de nuages mondiale');
      const material = createRegionalCloudMaterial(tile, realClouds);
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
    // Le plafond se voit aussi d'en dessous (GAL-EARTH-ATMOSPHERE-003). Le sol se compte sur le plus petit demi-axe
    // de l'ellipsoïde, comme le moteur le fait pour le sol : aux Kerguelen (49° S) il passe 3,7 km SOUS la sphère
    // moyenne, et la sphère retirait le plafond à 2 km au-dessus du sol réel (mesuré).
    ...(options.interior === false
      ? {}
      : {
          interiorGroundRatio: () => {
            const f = earth.figure;
            const lowest = f ? Math.min(f.a, f.b, f.c) : 1;
            return lowest / (options.scale * shellScale);
          },
        }),
    setShellScale: (factor) => {
      shellScale = factor;
      tiles.scale.setScalar(factor);
      earth.setCloudShellScale(factor);
    },
    dispose: () => {
      tiles.removeFromParent();
      earth.setCloudShellScale(1);
    },
  };
}
