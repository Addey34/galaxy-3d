/**
 * Bascule des ÉTIQUETTES DES ÉVÉNEMENTS de la Terre (séismes USGS, événements NASA EONET) —
 * panneau Événements de la Terre (il règle ses couches).
 *
 * Les marqueurs d'une couche ne se coupent que par la couche entière ; ce réglage retire leur
 * TEXTE seul. Réglage de lecture, donc il persiste ; activé par défaut, comme les noms de surface.
 */
import { STORAGE_KEYS } from '@/config/storageKeys';
import { onLocaleChange, t } from '@/i18n';
import type { EarthEventsOverlay } from './earthEventsOverlay';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.eventLabels) !== '0';
  } catch {
    return true;
  }
}

function writeStored(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.eventLabels, enabled ? '1' : '0');
  } catch {
    // Stockage plein/refusé (mode privé) : le réglage reste actif pour la session.
  }
}

export function setupEventLabelsToggle(
  overlay: EarthEventsOverlay
): () => void {
  const wrapper = document.createElement('label');
  wrapper.id = 'event-labels-toggle-wrapper';
  wrapper.className = 'settings-switch';

  const checkbox = document.createElement('input');
  checkbox.id = 'event-labels-toggle';
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';

  const text = document.createElement('span');
  text.className = 'settings-switch-label';

  wrapper.append(checkbox, text);
  const host =
    document.getElementById('earth-events-section-display') ?? document.body;

  // ATOMIQUE (AUD-531-01) : la fonction ne rend son `dispose` qu'à la fin ; une exception après
  // `host.append` (dans `refresh`, par exemple) laisserait sinon un réglage résiduel que le
  // montage suivant doublerait. `undo` défait, dans l'ordre inverse, ce qui a été posé.
  const undo: Array<() => void> = [];
  try {
    host.append(wrapper);
    undo.push(() => wrapper.remove());

    const refresh = (): void => {
      text.textContent = t('settings.eventLabels');
      checkbox.setAttribute('aria-label', t('settings.eventLabels'));
    };

    const initial = readStored();
    checkbox.checked = initial;
    overlay.setLabelsActive(initial);
    refresh();

    const onChange = (): void => {
      overlay.setLabelsActive(checkbox.checked);
      writeStored(checkbox.checked);
    };
    checkbox.addEventListener('change', onChange);
    undo.push(() => checkbox.removeEventListener('change', onChange));
    undo.push(onLocaleChange(refresh));
  } catch (error) {
    for (const step of undo.splice(0).reverse()) {
      try {
        step();
      } catch {
        // Un défaire qui échoue ne doit pas masquer l'erreur d'origine.
      }
    }
    throw error;
  }
  return () => {
    for (const step of undo.splice(0).reverse()) step();
  };
}
