/**
 * Bascule des NOMS DE SURFACE — surface Réglages, section « lecture ».
 *
 * Réglage de LECTURE, donc il persiste (cf. la règle du dépôt : le rendu et la lecture
 * persistent, le contenu de la scène jamais). Activé par défaut : les noms ne paraissent qu'à
 * l'approche d'un corps qui en porte, et un réglage éteint par défaut serait une fonction que
 * personne ne verrait.
 */
import { STORAGE_KEYS } from '@/config/storageKeys';
import { onLocaleChange, t } from '@/i18n';
import type { GazetteerOverlay } from './gazetteerOverlay';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.gazetteer) !== '0';
  } catch {
    return true;
  }
}

function writeStored(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.gazetteer, enabled ? '1' : '0');
  } catch {
    // Stockage plein/refusé (mode privé) : le réglage reste actif pour la session.
  }
}

export function setupGazetteerToggle(overlay: GazetteerOverlay): void {
  const wrapper = document.createElement('label');
  wrapper.id = 'gazetteer-toggle-wrapper';
  wrapper.className = 'settings-switch';

  const checkbox = document.createElement('input');
  checkbox.id = 'gazetteer-toggle';
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';

  const text = document.createElement('span');
  text.className = 'settings-switch-label';

  wrapper.append(checkbox, text);
  const host =
    document.getElementById('settings-section-reading') ?? document.body;
  host.append(wrapper);

  const refresh = (): void => {
    text.textContent = t('settings.gazetteer');
    checkbox.setAttribute('aria-label', t('settings.gazetteer'));
  };

  const initial = readStored();
  checkbox.checked = initial;
  overlay.setActive(initial);
  refresh();

  checkbox.addEventListener('change', () => {
    overlay.setActive(checkbox.checked);
    writeStored(checkbox.checked);
  });
  onLocaleChange(refresh);
}
