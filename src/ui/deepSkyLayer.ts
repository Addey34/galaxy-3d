/**
 * LA COUCHE DU CIEL PROFOND : repères (`DeepSkyMarkers`) et noms (`skyLabels`), chargés à la première
 * activation de la case « Objets du ciel profond ». Éteinte au démarrage, jamais mémorisée.
 *
 * Les noms écrits sont ceux des objets Messier et des objets qui ont un nom d'usage dans la source
 * (anglais, non traduits) ; les autres ne portent que leur repère. Un objet brillant garde sa place
 * à l'évitement (priorité = éclat), un Messier passe devant un objet qui ne l'est pas.
 */
import type * as THREE from 'three';
import type { Starfield } from '@/components/celestial/Starfield';
import { DeepSkyMarkers } from '@/components/celestial/DeepSkyMarkers';
import { DEEPSKY_SKY_RADIUS } from '@/components/celestial/DeepSkyMarkers';
import { deepSkyLabel, type DeepSkyFile } from '@/core/deepsky';
import Logger from '@/utils/Logger';
import {
  createSkyLabelLayer,
  skyLabelStyle,
  type SkyLabelLayer,
} from './skyLabels';

export const DEEPSKY_URL = '/assets/sky/deepsky.json';

/** La couche, plus ce dont la fiche d'un objet a besoin : les repères (sélection) et le fichier daté. */
export interface DeepSkyLayer extends SkyLabelLayer {
  markers: DeepSkyMarkers;
  file: DeepSkyFile;
}

export interface DeepSkyLayerEnvironment {
  starfield: Starfield;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
}

export async function setupDeepSkyLayer(
  env: DeepSkyLayerEnvironment,
  fetchImpl: typeof fetch = fetch
): Promise<DeepSkyLayer | null> {
  let file: DeepSkyFile;
  try {
    const res = await fetchImpl(DEEPSKY_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    file = (await res.json()) as DeepSkyFile;
    if (!Array.isArray(file.objects) || file.objects.length === 0)
      throw new Error('fichier vide');
  } catch (err) {
    Logger.warn('[deepSkyLayer] ciel profond illisible', err);
    return null;
  }

  const sky = env.starfield.points;
  const markers = new DeepSkyMarkers(
    file.objects,
    sky.material as THREE.Material
  );
  sky.add(markers.points);

  const labels = createSkyLabelLayer(
    file.objects.flatMap((o, index) => {
      const text = deepSkyLabel(o);
      if (text === null) return [];
      return [
        {
          text,
          // Messier d'abord, puis du plus brillant au plus faible (V absent = tout en bas).
          priority: (o[1] !== null ? 100 : 0) - (o[7] ?? 30),
          direction: (out: [number, number, number]) =>
            markers.directionOf(index, out),
        },
      ];
    }),
    {
      sky,
      radius: () => DEEPSKY_SKY_RADIUS,
      camera: env.camera,
      canvas: env.canvas,
      className: 'deepsky-names',
      // Sous le losange : centré dessus, il le traverserait.
      offsetY: 13,
      style: skyLabelStyle('deepsky-names', 'rgba(255, 205, 150, 0.8)'),
    }
  );

  return {
    markers,
    file,
    setActive(on) {
      markers.points.visible = on;
      labels.setActive(on);
    },
  };
}
