/**
 * Bascule « garder les nuages et la pluie visibles de près » — surface Réglages, section rendu.
 *
 * Par défaut une couche d'apparence s'efface quand sa donnée est trop grossie
 * (`core/dataMagnification.ts`). Cochée, elle garde un voile à la place. Réglage de RENDU, donc il
 * persiste ; éteint par défaut, parce que c'est la règle du lot 48 qui reste la valeur mesurée.
 */
import { STORAGE_KEYS } from '@/config/storageKeys';
import { setKeepAppearanceLayers } from '@/core/dataMagnification';
import { onLocaleChange, t } from '@/i18n';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.keepAppearance) === '1';
  } catch {
    return false;
  }
}

function writeStored(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.keepAppearance, enabled ? '1' : '0');
  } catch {
    // Stockage plein/refusé (mode privé) : le réglage reste actif pour la session.
  }
}

export function setupKeepAppearanceToggle(): void {
  const wrapper = document.createElement('label');
  wrapper.id = 'keep-appearance-toggle-wrapper';
  wrapper.className = 'settings-switch';

  const checkbox = document.createElement('input');
  checkbox.id = 'keep-appearance-toggle';
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';

  const text = document.createElement('span');
  text.className = 'settings-switch-label';

  wrapper.append(checkbox, text);
  const host =
    document.getElementById('settings-section-rendering') ?? document.body;
  host.append(wrapper);

  const refresh = (): void => {
    text.textContent = t('settings.keepAppearance');
    checkbox.setAttribute('aria-label', t('settings.keepAppearance'));
  };

  const initial = readStored();
  checkbox.checked = initial;
  setKeepAppearanceLayers(initial);
  refresh();

  checkbox.addEventListener('change', () => {
    setKeepAppearanceLayers(checkbox.checked);
    writeStored(checkbox.checked);
  });
  onLocaleChange(refresh);
}
