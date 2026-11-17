/**
 * Événements terrestres : LANCEUR seulement (GAL-PERF-001B-02). Le module (`ui/earthEventsModule` :
 * couches USGS et NASA EONET, canvas d'instrument, panneau, réglage des étiquettes) n'est plus dans
 * le démarrage. Le déclencheur `#earth-events-trigger` est statique dans le HTML ; son premier clic
 * charge le module et ouvre le panneau, SANS second clic. Même famille que
 * `astronomicalEventsLauncher`, avec une différence voulue sur les échecs.
 *
 * Le contrat, un point par risque :
 *   - une seule charge en vol, une seule instance : un clic pendant le chargement ne fait rien ;
 *   - survol et focus PRÉCHARGENT le module (l'import seul) : rien n'est monté, aucun canvas,
 *     aucun écouteur, aucune requête USGS/EONET. Seule la case d'une couche en déclenche une ;
 *   - l'ouverture est une INTENTION qui expire si une autre surface s'ouvre ou si tout se ferme
 *     (coordinateur, y compris le début d'une visite), si Échap est pressé ou si le focus est parti
 *     ailleurs : jamais de focus volé. Le module se monte quand même, le clic suivant ouvre ;
 *   - DEUX échecs distincts, tous deux DITS (`announceLoadFailure`) et tous deux réessayables :
 *     l'import (oublié, il sera redemandé) et le montage (le module le défait lui-même, et le
 *     lanceur garde ses écouteurs). Les écouteurs du lanceur ne sont retirés qu'APRÈS un montage
 *     réussi : la version astronomique les retire avant d'initialiser, donc une exception à ce
 *     moment-là la laisserait sans reprise possible ;
 *   - la boucle de rendu appelle `update` : sans module monté, c'est un retour immédiat, sans
 *     canvas ni calcul ; une fois monté, l'overlay garde son rang et son `labelSpace`.
 */
import type * as THREE from 'three';
import type CelestialObject from '@/components/celestial/CelestialObject';
import type { LabelSpace } from '@/core/labelSpace';
import type { PublicAPI } from '@/SolarSystemApp';
import type { MountedEarthEvents } from './earthEventsModule';
import { announceLoadFailure } from './loadFailure';
import type { OverlayCoordinator } from './overlayCoordinator';

export interface EarthEventsLauncher {
  /** À appeler chaque image, à la place d'`EarthEventsOverlay.update`. */
  update(
    camera: THREE.PerspectiveCamera,
    earth: CelestialObject | null,
    space?: LabelSpace | null
  ): void;
}

type EarthEventsModule = typeof import('./earthEventsModule');

export function setupEarthEventsOnDemand(
  api: PublicAPI,
  coordinator?: OverlayCoordinator
): EarthEventsLauncher {
  let mounted: MountedEarthEvents | null = null;
  const launcher: EarthEventsLauncher = {
    update(camera, earth, space = null) {
      mounted?.overlay.update(camera, earth, space);
    },
  };
  const trigger = document.getElementById('earth-events-trigger');
  if (!trigger) return launcher;

  let loading = false;
  let imported: Promise<EarthEventsModule> | null = null;
  const fetchModule = (): Promise<EarthEventsModule> =>
    (imported ??= import('./earthEventsModule').catch((error: unknown) => {
      imported = null;
      throw error;
    }));
  const warm = (): void => {
    fetchModule().catch(() => undefined);
  };

  let wanted = false;
  let releaseGuards: (() => void) | null = null;
  const abandon = (): void => {
    wanted = false;
  };

  const watchIntent = (): (() => void) => {
    const unsubscribe = coordinator?.onOpen((id) => {
      if (id !== 'earth-events') abandon();
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') abandon();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      unsubscribe?.();
      document.removeEventListener('keydown', onKey, true);
    };
  };

  /**
   * Le focus a-t-il bougé DEPUIS le clic ? Comparé à celui du clic et non au déclencheur : un clic
   * tactile ou programmatique ne focalise pas le bouton, et le focus peut être dans la surface
   * qu'on remplace (le panneau météo) ; ce n'est pas un visiteur qui est parti ailleurs. « Nulle
   * part » (`body`, ou rien sous Safari après un clic) vaut « nulle part ».
   */
  const nowhere = (element: Element | null): boolean =>
    element === null || element === document.body;
  const focusStayed = (atClick: Element | null): boolean => {
    const active = document.activeElement;
    return active === atClick || (nowhere(active) && nowhere(atClick));
  };

  const release = (): void => {
    releaseGuards?.();
    releaseGuards = null;
  };

  const onClick = (): void => {
    if (loading || mounted) return;
    loading = true;
    wanted = true;
    const focusAtClick = document.activeElement;
    trigger.setAttribute('aria-busy', 'true');
    releaseGuards = watchIntent();
    void fetchModule()
      .then(
        (module) => {
          // Décidé AVANT de monter : le montage peut déplacer le focus et le coordinateur.
          const open = wanted && focusStayed(focusAtClick);
          release();
          try {
            mounted = module.mountEarthEvents(api, coordinator);
          } catch {
            // Le module a défait son montage ; les écouteurs restent, le clic suivant réessaie.
            if (wanted) announceLoadFailure('earthEventsMount');
            return;
          }
          trigger.removeEventListener('click', onClick);
          trigger.removeEventListener('pointerenter', warm);
          trigger.removeEventListener('focus', warm);
          if (open) mounted.open();
        },
        () => {
          release();
          if (wanted) announceLoadFailure('earthEvents');
        }
      )
      .finally(() => {
        loading = false;
        wanted = false;
        trigger.removeAttribute('aria-busy');
      });
  };
  trigger.addEventListener('click', onClick);
  trigger.addEventListener('pointerenter', warm);
  trigger.addEventListener('focus', warm);
  return launcher;
}
