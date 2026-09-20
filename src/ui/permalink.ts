import {
  parsePermalink,
  pathnameForBody,
  serializePermalink,
  type PermalinkViewAngles,
} from '@/core/permalink';
import {
  eclipseFocusBody,
  eclipseFromPathname,
  eclipseViewFrom,
  eclipsePathname,
  eclipseStillDescribed,
  type EclipseEvent,
} from '@/core/eclipsePages';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { PlanetNavigation } from './planetNav';
import type { ModeSwitcher } from './modeSwitcher';
import type { PlaybackControls } from './playback';

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
  /**
   * Suspend `sync()` (no-op tant que suspendu) — utilisé par `ui/tourPlayer.ts` pour ne pas
   * écraser le permalien de l'utilisateur à chaque étape intermédiaire d'un tour scénarisé.
   * Lever la suspension ne resynchronise pas automatiquement : appeler `sync()` explicitement.
   */
  setSuspended(suspended: boolean): void;
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

export interface PermalinkEclipseHooks {
  /** Fige la lecture à l'arrivée sur une éclipse, comme le panneau d'événements. */
  playback?: Pick<PlaybackControls, 'pause'>;
  /** Éclipse que l'adresse nomme après chaque écriture (`null` dès qu'elle ne la nomme plus). */
  onEclipseAddress?: (event: EclipseEvent | null) => void;
}

export function setupPermalinks(
  om: OrbitalMechanics,
  navigation: PlanetNavigation,
  modeSwitcher: ModeSwitcher,
  validBodies: ReadonlySet<string>,
  camera: CameraSystem,
  eclipseHooks: PermalinkEclipseHooks = {},
  /**
   * Tout ce qui peut être SÉLECTIONNÉ, y compris les objets d'instrument. Distinct de
   * `validBodies`, qui ne contient que les corps AYANT UNE PAGE : un chemin `/voyager1/`
   * n'existe pas et ne doit pas être écrit, alors que `?body=voyager1` doit être relu.
   * Sans cette distinction, l'application écrivait une adresse qu'elle refusait ensuite de
   * rouvrir : sélectionner une sonde, partager le lien, et le lien ramenait à la vue d'ensemble.
   */
  selectableBodies: ReadonlySet<string> = validBodies
): PermalinkController {
  let applying = false;
  let suspended = false;
  // Éclipse nommée par le chemin d'ENTRÉE (`/eclipse/2026-08-12/`). Recalculée une seule fois :
  // tant que l'état la décrit, l'adresse la garde ; dès qu'il ne la décrit plus, elle est
  // oubliée et l'adresse redevient le permalien ordinaire, sans retour possible.
  let eclipse: EclipseEvent | null =
    eclipseFromPathname(window.location.pathname) ?? null;

  const sync = (view?: PermalinkViewAngles): void => {
    if (applying || suspended) return;
    const selectedBody = navigation.getSelectedBody();
    if (
      eclipse &&
      !view &&
      eclipseStillDescribed(eclipse, selectedBody, om.simulationDate)
    ) {
      // L'état décrit encore l'éclipse : son adresse indexable reste la bonne. Ni `?date=` ni
      // `?body=` — le chemin les porte, et deux URL pour un même contenu est précisément ce
      // que le canonique existe pour éviter. Le mode, lui, n'est pas porté par le chemin.
      const eclipseUrl = `${eclipsePathname(eclipse)}${serializePermalink(
        { mode: modeSwitcher.getMode() },
        window.location.search
      )}${window.location.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (eclipseUrl !== currentUrl)
        window.history.replaceState(null, '', eclipseUrl);
      eclipseHooks.onEclipseAddress?.(eclipse);
      return;
    }
    if (eclipse) {
      eclipse = null;
      eclipseHooks.onEclipseAddress?.(null);
    }
    // Le CHEMIN suit la sélection, il n'est plus seulement lu. Chaque corps a déjà son adresse
    // indexable ; la parcourir sans recharger, c'est la lui rendre. `serializePermalink` voit
    // ce chemin et omet alors `?body=`, devenu redondant. Cf. `pathnameForBody`.
    const nextPathname = pathnameForBody(selectedBody, validBodies);
    const nextSearch = serializePermalink(
      {
        mode: modeSwitcher.getMode(),
        body: selectedBody ?? undefined,
        date: om.simulationDate,
        view,
      },
      window.location.search,
      nextPathname
    );
    const nextUrl = `${nextPathname}${nextSearch}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(null, '', nextUrl);
  };

  const applyInitialState = (): void => {
    const state = parsePermalink(
      window.location.search,
      selectableBodies,
      window.location.pathname
    );
    // Une page d'éclipse porte sa date et son corps dans le CHEMIN (la CSP interdit de les
    // transmettre par un script en ligne). La query, si quelqu'un en ajoute une, prime encore.
    const pathEclipse = eclipseFromPathname(window.location.pathname);
    if (pathEclipse) {
      state.date ??= pathEclipse.date;
      state.body ??= eclipseFocusBody(pathEclipse);
    }
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
      // Au pic, et pas une seconde plus tard : sans pause, l'horloge repart en temps réel et
      // l'état cesse de décrire l'éclipse avant même que le visiteur l'ait regardée.
      if (pathEclipse) eclipseHooks.playback?.pause();
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
    } else if (pathEclipse && state.body) {
      // Aucun angle demandé : on impose celui qui MONTRE l'éclipse (cf. eclipseViewFrom),
      // une fois le vol terminé, sinon le tween écraserait la pose.
      const from = eclipseViewFrom(pathEclipse);
      if (from)
        afterCameraArrival(camera, () => {
          camera.viewFromBody(from);
          sync();
        });
      else sync();
    } else {
      sync();
    }
  };

  window.addEventListener('popstate', applyInitialState);
  return {
    applyInitialState,
    sync,
    setSuspended: (v) => {
      suspended = v;
    },
  };
}
