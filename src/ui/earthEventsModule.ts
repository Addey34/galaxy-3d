/**
 * Événements terrestres : MODULE DIFFÉRÉ (GAL-PERF-001B-02), importé par `ui/earthEventsLauncher`
 * au premier survol, focus ou clic sur `#earth-events-trigger`. Il regroupe tout ce qui n'a de sens
 * que pour ces couches : les deux sources (`core/earthEventLayers` : USGS, NASA EONET), le canvas
 * d'instrument, le panneau et le réglage des étiquettes. Rien de tout cela n'est dans le démarrage.
 *
 * `mountEarthEvents` est ATOMIQUE : tout ce qu'il pose (canvas, écouteurs, abonnements, rangée du
 * réglage) est défait si une étape lève, de sorte qu'un nouvel essai part d'un état vierge au lieu
 * d'empiler un canvas, des écouteurs et des callbacks de rendu résiduels. Aucune couche n'est
 * allumée au montage : le socle daté (donc la première requête USGS/EONET) naît de la case cochée.
 */
import type { PublicAPI } from '@/SolarSystemApp';
import { earthquakeLayer, naturalEventLayer } from '@/core/earthEventLayers';
import { setupEarthEvents, type EarthEventsPanel } from './earthEvents';
import { EarthEventsOverlay } from './earthEventsOverlay';
import { setupEventLabelsToggle } from './eventLabelsToggle';
import type { OverlayCoordinator } from './overlayCoordinator';

export interface MountedEarthEvents extends EarthEventsPanel {
  /** Le canvas d'instrument, mis à jour à chaque image par le lanceur. */
  readonly overlay: EarthEventsOverlay;
}

export function mountEarthEvents(
  api: PublicAPI,
  coordinator?: OverlayCoordinator
): MountedEarthEvents {
  const undo: Array<() => void> = [];
  const rollBack = (): void => {
    for (const step of undo.splice(0).reverse()) {
      try {
        step();
      } catch {
        // Un défaire qui échoue ne doit pas masquer l'erreur d'origine.
      }
    }
  };
  try {
    const layers = [earthquakeLayer(), naturalEventLayer()];
    const overlay = new EarthEventsOverlay(layers);
    undo.push(() => overlay.dispose());
    overlay.mount();
    undo.push(setupEventLabelsToggle(overlay));
    const panel = setupEarthEvents(api, layers, overlay, coordinator);
    undo.push(panel.dispose);
    return { overlay, open: panel.open, dispose: rollBack };
  } catch (error) {
    rollBack();
    throw error;
  }
}
