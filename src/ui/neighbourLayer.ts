/**
 * LA COUCHE DES ÉTOILES VOISINES : repères (`NeighbourMarkers`) et noms avec leur distance
 * (`skyLabels`), chargés à la première activation de la case « Étoiles voisines ». Éteinte au
 * démarrage, jamais mémorisée.
 *
 * Le nom d'un repère dit la distance en années-lumière (« Proxima Centauri · 4,2 al ») : c'est la
 * seule façon de la montrer sans la dessiner. Les repères suivent le mouvement propre jusqu'à la
 * date de la scène ; une étoile qui bouge de 10″ par an (Barnard) s'est déplacée de plus de 4′
 * depuis J2000.
 */
import { loadNeighbours } from './neighbourData';
import type * as THREE from 'three';
import type { Starfield } from '@/components/celestial/Starfield';
import {
  NEIGHBOUR_SKY_RADIUS,
  NeighbourMarkers,
} from '@/components/celestial/NeighbourMarkers';
import {
  distanceFacts,
  groupSystems,
  markerLabel,
  systemPrimary,
  type NeighbourFile,
} from '@/core/neighbours';
import { yearsSinceJ2000 } from '@/core/starCatalogue';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { getLocale, onLocaleChange, t } from '@/i18n';
import Logger from '@/utils/Logger';
import { createSkyLabelLayer, type SkyLabelLayer } from './skyLabels';

const NAMES_CLASS = 'neighbour-names';
/** Les repères se replacent au plus toutes les 500 ms : `setYears` ignore moins de 3 mois d'écart. */
const REFRESH_MS = 500;

export interface NeighbourLayer extends SkyLabelLayer {
  markers: NeighbourMarkers;
  file: NeighbourFile;
}

export interface NeighbourLayerEnvironment {
  starfield: Starfield;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
  /** Date de la scène : les repères suivent le mouvement propre jusqu'à elle. */
  simulationDate: () => Date;
}

export async function setupNeighbourLayer(
  env: NeighbourLayerEnvironment,
  fetchImpl: typeof fetch = fetch
): Promise<NeighbourLayer | null> {
  let file: NeighbourFile;
  try {
    file = await loadNeighbours(fetchImpl);
    if (file.stars.length === 0) throw new Error('fichier vide');
  } catch (err) {
    Logger.warn('[neighbourLayer] étoiles voisines illisibles', err);
    return null;
  }
  // Les noms portent l'unité (« al », « ly ») : elle est hors démarrage, comme la fiche.
  await loadDeferredMessages();

  const systems = groupSystems(file.stars);
  const markers = new NeighbourMarkers(systems);
  const sky = env.starfield.points;
  sky.add(markers.points);

  const formatLightYears = (ly: number): string =>
    `${new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(ly)} ${t('nb.unit.ly')}`;

  let active = false;
  let labels: SkyLabelLayer | null = null;
  const buildLabels = (): void => {
    // Un nom ne se réécrit pas : on recrée la couche (langue changée), l'ancienne est retirée du DOM.
    labels?.setActive(false);
    document.querySelectorAll(`.${NAMES_CLASS}`).forEach((el) => el.remove());
    labels = createSkyLabelLayer(
      systems.map((system, index) => ({
        text: markerLabel(system, formatLightYears),
        // Le plus proche d'abord : à distance égale, le plus brillant.
        priority:
          -distanceFacts(systemPrimary(system)).lightYears * 10 -
          systemPrimary(system)[7],
        direction: (out: [number, number, number]) =>
          markers.directionOf(index, out),
      })),
      {
        sky,
        radius: () => NEIGHBOUR_SKY_RADIUS,
        camera: env.camera,
        canvas: env.canvas,
        className: NAMES_CLASS,
        // Sous le carré : centré dessus, il le traverserait.
        offsetY: 14,
      }
    );
    labels.setActive(active);
  };
  buildLabels();

  let timer = 0;
  const follow = (): void =>
    markers.setYears(yearsSinceJ2000(env.simulationDate()));
  onLocaleChange(() => {
    void loadDeferredMessages().then(buildLabels);
  });

  return {
    markers,
    file,
    setActive(on) {
      active = on;
      markers.points.visible = on;
      labels?.setActive(on);
      window.clearInterval(timer);
      if (on) {
        follow();
        timer = window.setInterval(follow, REFRESH_MS);
      }
    },
  };
}
