/**
 * Bascule système d'unités (métrique/impérial) — vit dans la surface Réglages, toujours
 * visible. Réutilise le style `.settings-switch` déjà générique : pas de CSS dédiée.
 */
import { onLocaleChange, t } from '@/i18n';
import { getUnitSystem, setUnitSystem } from '@/core/units';

export function setupUnitsToggle(): void {
  const wrapper = document.createElement('label');
  wrapper.id = 'units-toggle-wrapper';
  wrapper.className = 'settings-switch';

  const checkbox = document.createElement('input');
  checkbox.id = 'units-toggle';
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';

  const text = document.createElement('span');
  text.className = 'settings-switch-label';

  wrapper.append(checkbox, text);

  const host =
    document.querySelector('#orbit-options .surface-body') ?? document.body;
  host.append(wrapper);

  const refresh = (): void => {
    text.textContent = t('settings.units');
    checkbox.setAttribute('aria-label', t('settings.units'));
  };

  checkbox.checked = getUnitSystem() === 'imperial';
  refresh();

  checkbox.addEventListener('change', () => {
    setUnitSystem(checkbox.checked ? 'imperial' : 'metric');
  });
  onLocaleChange(refresh);
}
