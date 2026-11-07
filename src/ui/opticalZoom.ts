import './opticalZoom.css';
import { CAMERA_SETTINGS } from '@/config/engine';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import { onLocaleChange, t } from '@/i18n';
import { formatFixed } from './localNumber';
import {
  ZOOM_POSITION_MAX,
  ZOOM_POSITION_STEP,
  fovFromZoomPosition,
  zoomPositionFromFov,
} from '@/core/opticalZoomScale';

const { opticalMinFov: MIN_FOV, opticalMaxFov: MAX_FOV } = CAMERA_SETTINGS;
const fovText = (fov: number): string => `${formatFixed(fov, 1)}°`;

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
  // Course LOGARITHMIQUE en grossissement (`core/opticalZoomScale`) : la valeur du curseur est une
  // position, le champ en degrés est dans `aria-valuetext` et dans la sortie affichée.
  range.min = '0';
  range.max = String(ZOOM_POSITION_MAX);
  range.step = String(ZOOM_POSITION_STEP);
  group.append(label, range);

  // Seul occupant de la section « Vue » des Réglages, qui se montre et se masque avec lui.
  const host =
    document.getElementById('settings-section-view') ?? document.body;
  host.append(group);

  const refresh = (): void => {
    caption.textContent = t('zoom.optical');
    range.setAttribute('aria-label', t('zoom.optical'));
    const text = fovText(camera.opticalFov);
    range.value = String(
      zoomPositionFromFov(camera.opticalFov, MIN_FOV, MAX_FOV)
    );
    value.textContent = text;
    // Le natif expose déjà aria-valuenow/min/max depuis les attributs value/min/max,
    // mais un lecteur d'écran annoncerait juste "50" sans unité : valuetext donne le
    // libellé humain ("50°") qu'il annonce à la place.
    range.setAttribute('aria-valuetext', text);
  };

  range.addEventListener('input', () => {
    camera.setOpticalFov(
      fovFromZoomPosition(Number(range.value), MIN_FOV, MAX_FOV)
    );
    refresh();
  });
  onLocaleChange(refresh);
  camera.setOpticalFov(camera.opticalFov);
  refresh();

  return {
    // FOV n'a de sens qu'en Explo (vraie échelle). Masqué en Éducatif.
    setMode: (mode) => {
      group.hidden = mode !== 'explo';
      const section = group.closest<HTMLElement>('.settings-section');
      if (section) section.hidden = group.hidden;
      camera.setOpticalFov(camera.opticalFov);
      refresh();
    },
    dispose: () => group.remove(),
  };
}
