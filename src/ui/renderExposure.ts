/**
 * Curseur d'exposition (tone mapping) — vit dans la surface Réglages, toujours visible (pas
 * propre à un mode). Complète le sélecteur de qualité graphique existant : celui-ci ajuste la
 * fluidité, celui-ci ajuste la luminosité perçue selon l'écran du visiteur.
 */
import { STORAGE_KEYS } from '@/config/storageKeys';
import { onLocaleChange, t } from '@/i18n';
import type { SceneSystem } from '@/components/systems/SceneSystem';

const MIN_EXPOSURE = 0.4;
const MAX_EXPOSURE = 2.0;
const DEFAULT_EXPOSURE = 1.0;

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.exposure);
    const n = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= MIN_EXPOSURE && n <= MAX_EXPOSURE
      ? n
      : DEFAULT_EXPOSURE;
  } catch {
    return DEFAULT_EXPOSURE;
  }
}

function writeStored(value: number): void {
  try {
    localStorage.setItem(STORAGE_KEYS.exposure, String(value));
  } catch {
    // Stockage plein/refusé (mode privé) : le réglage reste actif pour la session.
  }
}

export function setupRenderExposure(scene: SceneSystem): void {
  const group = document.createElement('div');
  group.id = 'render-exposure';
  group.className = 'render-exposure';

  const label = document.createElement('label');
  label.className = 'render-exposure-label';
  label.htmlFor = 'render-exposure-range';
  const caption = document.createElement('span');
  caption.className = 'render-exposure-caption';
  const value = document.createElement('output');
  value.className = 'render-exposure-value';
  value.htmlFor = 'render-exposure-range';
  label.append(caption, value);

  const range = document.createElement('input');
  range.id = 'render-exposure-range';
  range.className = 'render-exposure-range';
  range.type = 'range';
  range.min = String(MIN_EXPOSURE);
  range.max = String(MAX_EXPOSURE);
  range.step = '0.05';
  group.append(label, range);

  // Rangé dans la surface Réglages, sous les autres contrôles (FOV inclus).
  const host =
    document.querySelector('#orbit-options .surface-body') ?? document.body;
  host.append(group);

  const refresh = (): void => {
    caption.textContent = t('settings.exposure');
    range.setAttribute('aria-label', t('settings.exposure'));
    const current = Number(range.value);
    const text = current.toFixed(2);
    value.textContent = text;
    range.setAttribute('aria-valuetext', text);
  };

  const initial = readStored();
  range.value = String(initial);
  scene.setToneMappingExposure(initial);
  refresh();

  range.addEventListener('input', () => {
    const next = Number(range.value);
    scene.setToneMappingExposure(next);
    writeStored(next);
    refresh();
  });
  onLocaleChange(refresh);
}
