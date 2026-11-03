/**
 * Bascules des COUCHES DU CIEL : figures des constellations et repères des systèmes d'exoplanètes.
 * Surface Réglages, section « scène ».
 *
 * Contenu de la scène, donc ÉTEINT par défaut et JAMAIS mémorisé (règle du dépôt : le rendu et la
 * lecture persistent, le contenu de la scène jamais). Chaque case reste désactivée tant que son
 * fichier n'est pas chargé : les fichiers sont facultatifs, un échec laisse le ciel intact.
 */
import type { Starfield } from '@/components/celestial/Starfield';
import type { MessageKey } from '@/i18n/locales';
import { onLocaleChange, t } from '@/i18n';

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

export function setupSkyLayerToggles(starfield: Starfield | null): void {
  if (!starfield) return;
  mount({
    id: 'constellations-toggle',
    labelKey: 'settings.constellations',
    ready: () => starfield.hasConstellations,
    set: (on) => starfield.setConstellationsVisible(on),
  });
  mount({
    id: 'exoplanets-toggle',
    labelKey: 'settings.exoplanets',
    ready: () => starfield.hasExoplanets,
    set: (on) => starfield.setExoplanetsVisible(on),
  });
}
