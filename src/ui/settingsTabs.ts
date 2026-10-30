/**
 * Onglets de la surface Réglages d'affichage (audit des panneaux, C5) : scène, image, lecture,
 * données. Six sections empilées obligeaient à défiler ; un seul groupe à l'écran garde le
 * panneau de la même taille sur bureau et sur téléphone. Chaque section porte son groupe
 * (`data-tab-group` dans index.html) et RESTE dans le DOM : les modules qui s'y rangent par id
 * n'ont rien à savoir des onglets, et c'est le CSS (`[data-settings-tab]`) qui masque le reste.
 * L'onglet courant ne persiste pas : on rouvre toujours sur la scène.
 */
import { onLocaleChange, t } from '@/i18n';

const TABS = [
  { id: 'scene', key: 'settings.tab.scene' },
  { id: 'image', key: 'settings.tab.image' },
  { id: 'reading', key: 'settings.tab.reading' },
  { id: 'data', key: 'settings.tab.data' },
] as const;

export type SettingsTabId = (typeof TABS)[number]['id'];

export function setupSettingsTabs(): void {
  const body = document.querySelector<HTMLElement>(
    '#orbit-options .surface-body'
  );
  if (!body) return;

  const strip = document.createElement('div');
  strip.id = 'settings-tabs';
  strip.className = 'settings-tabs';
  strip.setAttribute('role', 'tablist');

  const buttons = TABS.map((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `settings-tab-${tab.id}`;
    button.className = 'settings-tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'settings-tabpanel');
    strip.append(button);
    return button;
  });
  body.id = 'settings-tabpanel';
  body.setAttribute('role', 'tabpanel');
  body.before(strip);

  const select = (id: SettingsTabId, focus = false): void => {
    body.dataset['settingsTab'] = id;
    body.setAttribute('aria-labelledby', `settings-tab-${id}`);
    TABS.forEach((tab, index) => {
      const active = tab.id === id;
      const button = buttons[index];
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    body.scrollTop = 0;
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(TABS[index].id));
    button.addEventListener('keydown', (event) => {
      const last = TABS.length - 1;
      const target =
        event.key === 'ArrowRight'
          ? (index + 1) % TABS.length
          : event.key === 'ArrowLeft'
            ? (index + last) % TABS.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? last
                : -1;
      if (target < 0) return;
      event.preventDefault();
      select(TABS[target].id, true);
    });
  });

  const refresh = (): void => {
    strip.setAttribute('aria-label', t('settings.tabs.aria'));
    TABS.forEach((tab, index) => {
      buttons[index].textContent = t(tab.key);
    });
  };
  select('scene');
  refresh();
  onLocaleChange(refresh);
}
