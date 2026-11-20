/**
 * « Éclairage de lecture » (GAL-IMMERSION-003) : une aide d'observation, éteinte par défaut et
 * jamais mémorisée, rangée dans la section Rendu des Réglages. Elle relève la luminance MINIMALE
 * de la surface pour lire un relief côté nuit ; ce n'est pas de la lumière solaire, et un
 * indicateur visible le dit tant qu'elle agit (`config/readingLight.ts` porte le contrat).
 */
import './readingLightToggle.css';
import { setReadingLight } from '@/config/readingLight';
import { onLocaleChange, t } from '@/i18n';
import { getAnnouncer } from './announcer';
import { formatFixed } from './localNumber';

/** Intensité proposée à l'allumage (0 à 1). */
const DEFAULT_INTENSITY = 0.5;

export function setupReadingLightToggle(
  /** Le corps nommé porte-t-il le plancher sur sa surface ? (`'overview'` : la scène entière.) */
  appliesTo: (body: string) => boolean
): { setTarget: (body: string) => void } {
  let applies = true;
  const group = document.createElement('div');
  group.id = 'reading-light';
  group.className = 'reading-light';

  const wrapper = document.createElement('label');
  wrapper.className = 'settings-switch';
  const checkbox = document.createElement('input');
  checkbox.id = 'reading-light-toggle';
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';
  const text = document.createElement('span');
  text.className = 'settings-switch-label';
  wrapper.append(checkbox, text);

  const hint = document.createElement('p');
  hint.className = 'reading-light-hint';

  const level = document.createElement('label');
  level.className = 'render-exposure-label';
  level.htmlFor = 'reading-light-range';
  const levelCaption = document.createElement('span');
  const levelValue = document.createElement('output');
  levelValue.htmlFor = 'reading-light-range';
  level.append(levelCaption, levelValue);
  const range = document.createElement('input');
  range.id = 'reading-light-range';
  range.className = 'render-exposure-range';
  range.type = 'range';
  range.min = '0.1';
  range.max = '1';
  range.step = '0.05';
  range.value = String(DEFAULT_INTENSITY);
  group.append(wrapper, hint, level, range);

  // Indicateur visible sur la scène tant que l'assistance agit : l'image n'est plus naturelle.
  const badge = document.createElement('div');
  badge.id = 'reading-light-badge';
  badge.className = 'reading-light-badge';
  badge.hidden = true;
  document.body.append(badge);

  const host =
    document.getElementById('settings-section-rendering') ?? document.body;
  host.append(group);

  const refresh = (): void => {
    text.textContent = t('settings.readingLight');
    checkbox.setAttribute('aria-label', t('settings.readingLight'));
    hint.textContent = t('settings.readingLight.hint');
    levelCaption.textContent = t('settings.readingLight.level');
    range.setAttribute('aria-label', t('settings.readingLight.level'));
    const value = formatFixed(Number(range.value), 2);
    levelValue.textContent = value;
    range.setAttribute('aria-valuetext', value);
    badge.textContent = t(
      applies ? 'readingLight.badge' : 'readingLight.badge.none'
    );
  };

  const apply = (): void => {
    const on = checkbox.checked;
    setReadingLight(on ? Number(range.value) : 0);
    badge.hidden = !on;
    level.hidden = !on;
    range.hidden = !on;
  };

  checkbox.addEventListener('change', () => {
    apply();
    getAnnouncer().announce(
      t(checkbox.checked ? 'readingLight.on' : 'readingLight.off'),
      'reading-light'
    );
  });
  range.addEventListener('input', () => {
    apply();
    refresh();
  });
  apply();
  refresh();
  onLocaleChange(refresh);
  return {
    // Le visiteur est prévenu quand l'assistance est allumée mais n'agit pas sur le corps suivi.
    setTarget: (body) => {
      applies = body === 'overview' || appliesTo(body);
      refresh();
    },
  };
}
