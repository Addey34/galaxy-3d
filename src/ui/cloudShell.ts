import type * as THREE from 'three';

import {
  createCloudShellHost,
  type CloudShellEarth,
} from '@/components/surface/CloudShellHost';
import { PlanetarySurfaceEngine } from '@/components/surface/PlanetarySurfaceEngine';
import { LAYER_RADIUS_SCALE } from '@/config/layerConfig';
import {
  cloudTilesetForSource,
  type SurfaceTileset,
} from '@/config/surfaceTilesets';
import { cloudsOnScreen } from '@/core/cloudsOnScreen';

/**
 * LES NUAGES RÉGIONAUX (GAL-EARTH-CLOUD-REGIONAL-001) : la couche mondiale (une image de 2 048 px, 19,7 km
 * par texel) s'efface dès que son texel dépasse quelques pixels d'écran. Cette couche reprend la MÊME
 * observation (même satellite, même jour : `cloudsOnScreen.source`) à sa résolution native, 250 m, par le
 * moteur de tuiles du sol, posé sur la coque des nuages. Elle est indépendante du fond terrestre : le sol
 * garde sa mosaïque fine, les nuages viennent par-dessus.
 *
 * Ce qu'elle ne fait JAMAIS : poser une image d'un autre jour ou d'un autre instrument (une couche sans fiche
 * à 250 m, MODIS, la laisse éteinte), compléter un trou de fauchée, ajouter un détail. Une zone sans tuile
 * reste la couche mondiale.
 */

/** Au-delà, rien n'est demandé : la couche mondiale est encore pleine (son texel fait moins de 3 pixels). */
export const CLOUD_SHELL_CEILING_RADII = 1.8;
/** Hystérésis du plafond : une fois dans la bande on n'en sort qu'un peu plus haut. */
export const CLOUD_SHELL_CEILING_EXIT_RADII = 1.9;

export interface CloudShell {
  /** La couche peut-elle servir ce que la couche mondiale montre (une couche à 250 m, un jour posé) ? */
  serves(): boolean;
  /** À appeler à chaque image, avec le corps suivi et sa distance en rayons. */
  drive(
    body: CloudShellEarth,
    radiusKm: number,
    distanceInRadii: number,
    camera: THREE.PerspectiveCamera,
    viewportHeightPx: number
  ): void;
  /** Tuiles posées et voulues, pour le bandeau et les mesures. */
  stats(): {
    painted: number;
    requested: number;
    level: number;
    day: string | null;
  } | null;
  /** Carreaux de nuages en vol ou en fondu. */
  busy(): number;
  /** Retire les carreaux (le panneau de surface se désactive, ou la cible change). */
  release(): void;
  dispose(): void;
}

export function createCloudShell(options: {
  budget: { maxTiles: number; maxConcurrentLoads: number };
  /** Un jeu de rechange pour les essais. */
  engine?: PlanetarySurfaceEngine;
}): CloudShell {
  const engine =
    options.engine ?? new PlanetarySurfaceEngine({ budget: options.budget });
  let host: ReturnType<typeof createCloudShellHost> | null = null;
  let hostFor: CloudShellEarth | null = null;
  let inBand = false;

  // Le MÊME objet tant que la source ne change pas : `attach` compare les jeux par identité, et un jeu
  // neuf à chaque image relancerait toute la génération (mesuré : 37 tuiles redemandées ~370 fois en 18 s).
  let memo: { id: string; tileset: SurfaceTileset | undefined } | null = null;
  const tilesetNow = (): SurfaceTileset | undefined => {
    const id =
      cloudsOnScreen.value && cloudsOnScreen.source
        ? cloudsOnScreen.source.id
        : null;
    if (id === null) return undefined;
    if (memo?.id !== id)
      memo = { id, tileset: cloudTilesetForSource('earth', id) };
    return memo.tileset;
  };

  return {
    serves: () => tilesetNow() !== undefined,
    drive(body, radiusKm, distanceInRadii, camera, viewportHeightPx) {
      const ceiling = inBand
        ? CLOUD_SHELL_CEILING_EXIT_RADII
        : CLOUD_SHELL_CEILING_RADII;
      const tileset = tilesetNow();
      inBand = tileset !== undefined && distanceInRadii < ceiling;
      if (!inBand || !tileset) {
        engine.detach();
        return;
      }
      const scale = LAYER_RADIUS_SCALE['clouds'] ?? 1.01;
      if (!host || hostFor !== body) {
        host = createCloudShellHost(body, { scale });
        hostFor = body;
      }
      engine.attach(host, tileset, radiusKm * scale, null);
      engine.update(camera, viewportHeightPx);
    },
    stats: () => {
      const state = engine.state;
      return state
        ? {
            painted: state.painted,
            requested: state.requested,
            level: state.level,
            day: state.day,
          }
        : null;
    },
    busy: () => engine.busyCount,
    release: () => {
      inBand = false;
      engine.detach();
    },
    dispose: () => engine.dispose(),
  };
}
