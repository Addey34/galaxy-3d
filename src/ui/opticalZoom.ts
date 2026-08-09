import './opticalZoom.css';
import { CAMERA_SETTINGS } from '@/config/engine';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import { onLocaleChange, t } from '@/i18n';

export interface OpticalZoomControl {
  setMode(mode: 'educ' | 'explo'): void;
  dispose(): void;
}

export function setupOpticalZoom(camera: CameraSystem): OpticalZoomControl {
  const panel = document.createElement('div');
  panel.id = 'optical-zoom';
  panel.className = 'optical-zoom scene-panel';
  panel.hidden = false;

  const label = document.createElement('label');
  label.className = 'optical-zoom-label';
  const title = document.createElement('span');
  title.className = 'optical-zoom-title';
  const value = document.createElement('output');
  value.className = 'optical-zoom-value';
  value.htmlFor = 'optical-zoom-range';
  label.append(title, value);

  const range = document.createElement('input');
  range.id = 'optical-zoom-range';
  range.className = 'optical-zoom-range';
  range.type = 'range';
  range.min = String(CAMERA_SETTINGS.opticalMinFov);
  range.max = String(CAMERA_SETTINGS.opticalMaxFov);
  range.step = '1';
  range.setAttribute('aria-label', t('zoom.optical'));
  panel.append(label, range);
  const host = document.getElementById('bottom-controls') ?? document.body;
  host.append(panel);

  const refresh = (): void => {
    title.textContent = t('zoom.optical');
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
    setMode: (_mode) => {
      panel.hidden = false;
      camera.setOpticalFov(camera.opticalFov);
      refresh();
    },
    dispose: () => panel.remove(),
  };
}
