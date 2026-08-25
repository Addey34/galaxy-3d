import {
  parsePermalink,
  serializePermalink,
  type PermalinkViewAngles,
} from '@/core/permalink';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { PlanetNavigation } from './planetNav';
import type { ModeSwitcher } from './modeSwitcher';

const MS_PER_DAY = 86_400_000;
// Garde-fou : n'attend jamais indéfiniment l'arrivée du vol caméra avant d'appliquer un
// cadrage précis restauré depuis un permalien (au cas où `isFlying` resterait bloqué à true).
const MAX_ARRIVAL_WAIT_MS = 3000;

export interface PermalinkController {
  applyInitialState(): void;
  /**
   * Synchronise l'URL depuis l'état courant. `view` est optionnel et volontairement PAS
   * lu automatiquement depuis la caméra à chaque appel : la plupart des interactions
   * (changer de corps, de date, de mode) invalident le cadrage précédemment partagé — sans
   * `view`, ces params sont retirés de l'URL. Seul le bouton Partager (`ui/share.ts`) capture
   * l'angle courant et le passe explicitement ici.
   */
  sync(view?: PermalinkViewAngles): void;
}

/** Attend que le vol caméra en cours se termine (ou le délai max), puis appelle `then`. */
function afterCameraArrival(camera: CameraSystem, then: () => void): void {
  const start = performance.now();
  const tick = (): void => {
    if (!camera.isFlying || performance.now() - start > MAX_ARRIVAL_WAIT_MS) {
      then();
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
}

export function setupPermalinks(
  om: OrbitalMechanics,
  navigation: PlanetNavigation,
  modeSwitcher: ModeSwitcher,
  validBodies: ReadonlySet<string>,
  camera: CameraSystem
): PermalinkController {
  let applying = false;

  const sync = (view?: PermalinkViewAngles): void => {
    if (applying) return;
    const selectedBody = navigation.getSelectedBody();
    const nextSearch = serializePermalink(
      {
        mode: modeSwitcher.getMode(),
        body: selectedBody ?? undefined,
        date: om.simulationDate,
        view,
      },
      window.location.search
    );
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(null, '', nextUrl);
  };

  const applyInitialState = (): void => {
    const state = parsePermalink(window.location.search, validBodies);
    if (!state.mode && !state.body && !state.date && !state.view) return;

    applying = true;
    try {
      if (state.mode) modeSwitcher.setMode(state.mode);
      if (state.date) {
        const deltaDays =
          (state.date.getTime() - om.simulationDate.getTime()) / MS_PER_DAY;
        om.addTimeOffset(deltaDays);
      }
      if (state.body) navigation.selectBody(state.body);
    } finally {
      applying = false;
    }

    const view = state.view;
    if (view && state.body) {
      // Le cadrage précis n'a de sens qu'une fois le vol vers le corps sélectionné terminé :
      // appliqué plus tôt, le tween en cours l'écraserait à son arrivée.
      afterCameraArrival(camera, () => {
        camera.applyViewAngles(view.azimuthDeg, view.polarDeg, view.distance);
        sync(view);
      });
    } else {
      sync();
    }
  };

  window.addEventListener('popstate', applyInitialState);
  return { applyInitialState, sync };
}
