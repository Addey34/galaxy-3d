/**
 * Bascules des COUCHES DU CIEL : figures des constellations et repères des systèmes d'exoplanètes.
 * Surface Réglages, section « scène ».
 *
 * Contenu de la scène, donc ÉTEINT par défaut et JAMAIS mémorisé (règle du dépôt : le rendu et la
 * lecture persistent, le contenu de la scène jamais). Chaque case reste désactivée tant que son
 * fichier n'est pas chargé : les fichiers sont facultatifs, un échec laisse le ciel intact.
 */
import type { PerspectiveCamera } from 'three';
import type { Starfield } from '@/components/celestial/Starfield';
import type { MessageKey } from '@/i18n/locales';
import { onLocaleChange, t } from '@/i18n';
import type { ConstellationNames } from './constellationNames';
import type { ExoplanetCard } from './exoplanetCard';
import type { OverlayCoordinator } from './overlayCoordinator';

interface SkyLayer {
  id: string;
  labelKey: MessageKey;
  ready: () => boolean;
  set: (on: boolean) => void;
}

/** Attente de l'arrivée d'un fichier : un court rappel, arrêté dès qu'il est là ou après 30 s. */
const POLL_MS = 500;
const GIVE_UP_MS = 30_000;

function mount(layer: SkyLayer): void {
  const wrapper = document.createElement('label');
  wrapper.id = `${layer.id}-wrapper`;
  wrapper.className = 'settings-switch';

  const checkbox = document.createElement('input');
  checkbox.id = layer.id;
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';
  checkbox.checked = false;
  checkbox.disabled = !layer.ready();

  const text = document.createElement('span');
  text.className = 'settings-switch-label';

  wrapper.append(checkbox, text);
  const host =
    document.getElementById('settings-section-scene') ?? document.body;
  host.append(wrapper);

  const refresh = (): void => {
    text.textContent = t(layer.labelKey);
    checkbox.setAttribute('aria-label', t(layer.labelKey));
  };
  refresh();

  checkbox.addEventListener('change', () => layer.set(checkbox.checked));
  onLocaleChange(refresh);

  if (checkbox.disabled) {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (layer.ready()) {
        checkbox.disabled = false;
        window.clearInterval(timer);
      } else if (Date.now() - started > GIVE_UP_MS) window.clearInterval(timer);
    }, POLL_MS);
  }
}

/** Ce dont la fiche d'un système a besoin : la caméra pour viser, le canvas pour cliquer, le coordinateur. */
export interface SkyLayerEnvironment {
  camera: PerspectiveCamera;
  canvas: HTMLElement;
  coordinator: OverlayCoordinator;
  /** Rappel de fin d'image (`AnimationSystem.onFrame`) : les noms des constellations y suivent la caméra. */
  onFrame: (cb: () => void) => () => void;
}

export function setupSkyLayerToggles(
  starfield: Starfield | null,
  environment: SkyLayerEnvironment
): void {
  if (!starfield) return;
  // La fiche n'existe pas au démarrage : elle se charge à la première activation de la couche.
  let card: Promise<ExoplanetCard> | null = null;
  let wanted = false;
  let names: Promise<ConstellationNames | null> | null = null;
  mount({
    id: 'constellations-toggle',
    labelKey: 'settings.constellations',
    ready: () => starfield.hasConstellations,
    set: (on) => {
      starfield.setConstellationsVisible(on);
      // Les noms se chargent à la première activation des figures, pas au démarrage.
      if (on || names)
        void (names ??= import('./constellationNames').then((m) =>
          m.setupConstellationNames({ starfield, ...environment })
        )).then((n) => n?.setActive(on));
    },
  });
  mount({
    id: 'exoplanets-toggle',
    labelKey: 'settings.exoplanets',
    ready: () => starfield.hasExoplanets,
    set: (on) => {
      starfield.setExoplanetsVisible(on);
      wanted = on;
      if (on && !card) {
        card = import('./exoplanetCard').then((m) =>
          m.setupExoplanetCard({ starfield, ...environment })
        );
      }
      void card?.then((c) => c.setActive(wanted));
    },
  });
}
