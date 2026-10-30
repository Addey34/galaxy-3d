/**
 * Bascule des ÉTIQUETTES DES ÉVÉNEMENTS de la Terre (séismes USGS, événements NASA EONET) —
 * surface Réglages, section « lecture ».
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

export function setupEventLabelsToggle(overlay: EarthEventsOverlay): void {
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
    document.getElementById('settings-section-scene') ?? document.body;
  host.append(wrapper);

  const refresh = (): void => {
    text.textContent = t('settings.eventLabels');
    checkbox.setAttribute('aria-label', t('settings.eventLabels'));
  };

  const initial = readStored();
  checkbox.checked = initial;
  overlay.setLabelsActive(initial);
  refresh();

  checkbox.addEventListener('change', () => {
    overlay.setLabelsActive(checkbox.checked);
    writeStored(checkbox.checked);
  });
  onLocaleChange(refresh);
}
