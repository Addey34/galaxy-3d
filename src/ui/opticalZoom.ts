import './opticalZoom.css';
import { CAMERA_SETTINGS } from '@/config/engine';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import { onLocaleChange, t } from '@/i18n';

export interface OpticalZoomControl {
  setMode(mode: 'educ' | 'explo'): void;
  dispose(): void;
}

/**
 * Zoom optique (FOV) — contrôle occasionnel, propre au mode Exploration. Il vit dans la
 * surface Réglages (pas dans l'overlay permanent) et n'apparaît qu'en Explo : c'est là
 * que la vraie échelle rend l'ajustement d'angle de champ utile. Ne change JAMAIS l'échelle
 * des objets (invariant du mode Exploration), seulement `PerspectiveCamera.fov`.
 */
export function setupOpticalZoom(camera: CameraSystem): OpticalZoomControl {
  const group = document.createElement('div');
  group.id = 'optical-zoom';
  group.className = 'optical-zoom';
  group.hidden = true;

  const label = document.createElement('label');
  label.className = 'optical-zoom-label';
  label.htmlFor = 'optical-zoom-range';
  const caption = document.createElement('span');
  caption.className = 'optical-zoom-caption';
  const value = document.createElement('output');
  value.className = 'optical-zoom-value';
  value.htmlFor = 'optical-zoom-range';
  label.append(caption, value);

  const range = document.createElement('input');
  range.id = 'optical-zoom-range';
  range.className = 'optical-zoom-range';
  range.type = 'range';
  range.min = String(CAMERA_SETTINGS.opticalMinFov);
  range.max = String(CAMERA_SETTINGS.opticalMaxFov);
  range.step = '1';
  group.append(label, range);

  // Rangé dans la surface Réglages, sous les options d'affichage.
  const host =
    document.querySelector('#orbit-options .surface-body') ?? document.body;
  host.append(group);

  const refresh = (): void => {
    caption.textContent = t('zoom.optical');
    range.setAttribute('aria-label', t('zoom.optical'));
    range.value = String(Math.round(camera.opticalFov));
    value.textContent = `${Math.round(camera.opticalFov)}°`;
  };

  range.addEventListener('input', () => {
    camera.setOpticalFov(Number(range.value));
    refresh();
  });
  onLocaleChange(refresh);
  camera.setOpticalFov(camera.opticalFov);
  refresh();

  return {
    // FOV n'a de sens qu'en Explo (vraie échelle). Masqué en Éducatif.
    setMode: (mode) => {
      group.hidden = mode !== 'explo';
      camera.setOpticalFov(camera.opticalFov);
      refresh();
    },
    dispose: () => group.remove(),
  };
}
