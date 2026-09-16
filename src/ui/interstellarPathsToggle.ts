/**
 * Bascule « trajectoires des objets interstellaires » — vit dans la surface Réglages, comme la
 * palette daltonienne, et réutilise le même `.settings-switch` générique.
 *
 * DÉSACTIVÉE par défaut. Une trajectoire hyperbolique ne se referme jamais : trois courbes
 * ouvertes traversant la vue d'ensemble se lisaient comme des orbites cassées. Les marqueurs
 * restent visibles ; tracer le chemin est un choix, pas l'état de départ — même retenue que les
 * orbites des lunes, des naines et des petits corps.
 */
import { STORAGE_KEYS } from '@/config/storageKeys';
import { onLocaleChange, t } from '@/i18n';
import type { InterstellarOverlay } from './interstellarOverlay';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.interstellarPaths) === '1';
  } catch {
    return false;
  }
}

function writeStored(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.interstellarPaths, enabled ? '1' : '0');
  } catch {
    // Stockage plein/refusé (mode privé) : le réglage reste actif pour la session.
  }
}

export function setupInterstellarPathsToggle(
  overlay: Pick<InterstellarOverlay, 'setTrajectoriesVisible'>
): void {
  const wrapper = document.createElement('label');
  wrapper.id = 'interstellar-paths-toggle-wrapper';
  wrapper.className = 'settings-switch';

  const checkbox = document.createElement('input');
  checkbox.id = 'interstellar-paths-toggle';
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';

  const text = document.createElement('span');
  text.className = 'settings-switch-label';

  wrapper.append(checkbox, text);

  const host =
    document.querySelector('#orbit-options .surface-body') ?? document.body;
  host.append(wrapper);

  const refresh = (): void => {
    text.textContent = t('settings.interstellarPaths');
    checkbox.setAttribute('aria-label', t('settings.interstellarPaths'));
  };

  const initial = readStored();
  checkbox.checked = initial;
  overlay.setTrajectoriesVisible(initial);
  refresh();

  checkbox.addEventListener('change', () => {
    overlay.setTrajectoriesVisible(checkbox.checked);
    writeStored(checkbox.checked);
  });
  onLocaleChange(refresh);
}
