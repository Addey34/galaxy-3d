/**
 * Bascule palette daltonienne — vit dans la surface Réglages, toujours visible. Réutilise le
 * style `.settings-switch` déjà générique (`ui/weatherLayers.ts`) : pas de CSS dédiée.
 */
import { STORAGE_KEYS } from '@/config/storageKeys';
import { onLocaleChange, t } from '@/i18n';
import type { SceneSystem } from '@/components/systems/SceneSystem';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.colorblind) === '1';
  } catch {
    return false;
  }
}

function writeStored(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.colorblind, enabled ? '1' : '0');
  } catch {
    // Stockage plein/refusé (mode privé) : le réglage reste actif pour la session.
  }
}

export function setupColorblindToggle(scene: SceneSystem): void {
  const wrapper = document.createElement('label');
  wrapper.id = 'colorblind-toggle-wrapper';
  wrapper.className = 'settings-switch';

  const checkbox = document.createElement('input');
  checkbox.id = 'colorblind-toggle';
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';

  const text = document.createElement('span');
  text.className = 'settings-switch-label';

  wrapper.append(checkbox, text);

  const host =
    document.querySelector('#orbit-options .surface-body') ?? document.body;
  host.append(wrapper);

  const refresh = (): void => {
    text.textContent = t('settings.colorblind');
    checkbox.setAttribute('aria-label', t('settings.colorblind'));
  };

  const initial = readStored();
  checkbox.checked = initial;
  scene.setColorblindMode(initial);
  refresh();

  checkbox.addEventListener('change', () => {
    scene.setColorblindMode(checkbox.checked);
    writeStored(checkbox.checked);
  });
  onLocaleChange(refresh);
}
