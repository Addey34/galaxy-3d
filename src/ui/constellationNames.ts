/**
 * LES NOMS DES CONSTELLATIONS : une couche 2D (instrument), jamais un mesh.
 *
 * Le nom est celui de la source des figures (d3-celestial, forme latine de l'UAI), affiché tel
 * quel dans les quatre langues : une traduction serait une seconde donnée à sourcer. Il se pose
 * dans la direction moyenne des étoiles de la figure, recalculée à chaque image sur les positions
 * COURANTES du tampon : le nom suit la figure quand la date change.
 *
 * Chargé à la première activation des figures (hors démarrage). Le noyau (projection, évitement,
 * boucle d'images) est `ui/skyLabels.ts`, partagé avec les noms du ciel profond.
 */
import type * as THREE from 'three';
import type { Starfield } from '@/components/celestial/Starfield';
import { CONSTELLATIONS_URL } from '@/components/celestial/Starfield';
import { constellationAnchor, distinctStars } from '@/core/constellationAnchor';
import type { ConstellationFile } from '@/core/constellations';
import Logger from '@/utils/Logger';
import { createSkyLabelLayer, type SkyLabelLayer } from './skyLabels';

export type ConstellationNames = SkyLabelLayer;

export interface ConstellationNamesEnvironment {
  starfield: Starfield;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
}

export async function setupConstellationNames(
  env: ConstellationNamesEnvironment,
  fetchImpl: typeof fetch = fetch
): Promise<ConstellationNames | null> {
  let file: ConstellationFile;
  try {
    const res = await fetchImpl(CONSTELLATIONS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    file = (await res.json()) as ConstellationFile;
  } catch (err) {
    Logger.warn('[constellationNames] noms illisibles', err);
    return null;
  }
  const sky = env.starfield.points;
  const positions = (): ArrayLike<number> | null =>
    sky.geometry.getAttribute('position')?.array ?? null;
  // Les figures les plus riches d'abord : à l'évitement, ce sont elles qui gardent leur place.
  return createSkyLabelLayer(
    file.constellations.map((c) => {
      const stars = distinctStars(c.lines);
      return {
        text: c.name,
        priority: stars.length,
        direction: (out) => {
          const p = positions();
          return p !== null && constellationAnchor(p, stars, out);
        },
      };
    }),
    {
      sky,
      radius: () => {
        const a = positions();
        return a ? Math.hypot(a[0]!, a[1]!, a[2]!) : 0;
      },
      camera: env.camera,
      canvas: env.canvas,
      className: 'constellation-names',
    }
  );
}
