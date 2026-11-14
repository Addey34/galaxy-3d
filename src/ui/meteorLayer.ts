/**
 * LA COUCHE DES PLUIES DE MÉTÉORES : radiants (`MeteorRadiants`) et noms (`skyLabels`), chargés à la
 * première activation de la case « Pluies de météores ». Éteinte au démarrage, jamais mémorisée.
 *
 * Seules les pluies ACTIVES à la date de la scène sont dessinées et nommées (cf. `core/meteors`) : la
 * case n'affiche donc rien hors des quelques semaines où une pluie est en cours, et le dit.
 * Les noms sont ceux de la source (latins, identiques dans les quatre langues).
 */
import type * as THREE from 'three';
import type { Starfield } from '@/components/celestial/Starfield';
import {
  METEOR_SKY_RADIUS,
  MeteorRadiants,
} from '@/components/celestial/MeteorRadiants';
import { meteorLabel, parseMeteorsFile } from '@/core/meteors';
import Logger from '@/utils/Logger';
import { createSkyLabelLayer, type SkyLabelLayer } from './skyLabels';

export const METEORS_URL = '/assets/sky/meteors.json';

export interface MeteorLayer extends SkyLabelLayer {
  /** Pluies actives à la date de la scène (0 : la couche n'a rien à montrer). */
  activeCount(): number;
}

export interface MeteorLayerEnvironment {
  starfield: Starfield;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
  simulationDate: () => Date;
}

export async function setupMeteorLayer(
  env: MeteorLayerEnvironment,
  fetchImpl: typeof fetch = fetch
): Promise<MeteorLayer | null> {
  let radiants: MeteorRadiants;
  try {
    const res = await fetchImpl(METEORS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = parseMeteorsFile(await res.json());
    const sky = env.starfield.points;
    radiants = new MeteorRadiants(
      file.showers,
      sky.material as THREE.Material,
      env.simulationDate
    );
    sky.add(radiants.points);
  } catch (err) {
    Logger.warn('[meteorLayer] pluies de météores illisibles', err);
    return null;
  }

  const labels = createSkyLabelLayer(
    radiants.showers.map((shower, index) => ({
      text: meteorLabel(shower),
      // Les plus rapides d'abord : leur nom garde sa place quand deux pluies se recouvrent.
      priority: shower[10],
      direction: (out: [number, number, number]) =>
        radiants.directionOf(index, out),
    })),
    {
      sky: env.starfield.points,
      radius: () => METEOR_SKY_RADIUS,
      camera: env.camera,
      canvas: env.canvas,
      className: 'meteor-names',
      // Sous l'anneau : centré dessus, il le traverserait.
      offsetY: 15,
    }
  );

  return {
    setActive(on) {
      radiants.points.visible = on;
      labels.setActive(on);
    },
    activeCount: () => radiants.active,
  };
}
