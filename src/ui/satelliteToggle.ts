/**
 * La case « Satellites en orbite » (Réglages, section scène) et son état, dit en toutes lettres.
 *
 * Contenu de la scène, donc ÉTEINTE par défaut et JAMAIS mémorisée. La couche (`satelliteLayer`, avec
 * SGP4 et le fichier du service) n'est chargée qu'à la première activation. Une ligne sous la case dit
 * d'où viennent les éléments, et, quand la date sort de leur fenêtre de validité, qu'aucun satellite
 * n'est dessiné plutôt que mal placé.
 */
import type { PerspectiveCamera } from 'three';
import type { ScreenOcclusion } from '@/core/screenOcclusion';
import type { LabelSpace } from '@/core/labelSpace';
import { onLocaleChange, t } from '@/i18n';
import type {
  SatelliteLayer,
  SatelliteLayerEnvironment,
  SatelliteStatus,
} from './satelliteLayer';
import { mount } from './skyLayerToggles';

export interface SatelliteToggle {
  /** À appeler chaque image : ne fait rien tant que la couche est éteinte ou pas encore chargée. */
  update(
    camera: PerspectiveCamera,
    date: Date,
    morph: number,
    occlusion: ScreenOcclusion | null,
    space: LabelSpace | null
  ): void;
}

export function setupSatelliteToggle(
  env: SatelliteLayerEnvironment
): SatelliteToggle {
  let layer: Promise<SatelliteLayer | null> | null = null;
  let loaded: SatelliteLayer | null = null;
  let wanted = false;
  let status: HTMLElement | null = null;
  let shown = '';
  let lastStatus: SatelliteStatus | null = null;
  let lastValid = false;

  const render = (): void => {
    if (!status) return;
    let text = '';
    if (wanted && lastStatus) {
      text = lastValid
        ? t('settings.satellites.valid', {
            count: String(lastStatus.valid),
            date: lastStatus.fetchedAt.slice(0, 16).replace('T', ' '),
          })
        : t('settings.satellites.outside');
    } else if (wanted && layer && !loaded) {
      text = t('settings.satellites.loading');
    }
    if (text !== shown) {
      shown = text;
      status.textContent = text;
      status.hidden = text === '';
    }
  };

  mount({
    id: 'satellites-toggle',
    labelKey: 'settings.satellites',
    ready: () => true,
    set: (on) => {
      wanted = on;
      if (on || layer) {
        void (layer ??= import('./satelliteLayer').then((m) =>
          m.setupSatelliteLayer(env)
        )).then((l) => {
          loaded = l;
          if (!l) {
            // Le service n'a pas répondu : la case se décoche et le dit, au lieu de promettre.
            wanted = false;
            const box = document.getElementById(
              'satellites-toggle'
            ) as HTMLInputElement | null;
            if (box) box.checked = false;
            if (status) {
              shown = t('settings.satellites.unavailable');
              status.textContent = shown;
              status.hidden = false;
            }
            layer = null;
            return;
          }
          l.setActive(wanted);
          render();
        });
      }
      render();
    },
  });
  const wrapper = document.getElementById('satellites-toggle-wrapper');
  status = document.createElement('p');
  status.id = 'satellites-status';
  status.className = 'settings-hint';
  status.hidden = true;
  wrapper?.after(status);
  onLocaleChange(() => {
    shown = '\u0000';
    render();
  });

  return {
    update(camera, date, morph, occlusion, space) {
      if (!wanted || !loaded) return;
      loaded.update(camera, date, morph, occlusion, space);
      const s = loaded.status(date);
      const valid = s.valid > 0;
      if (
        !lastStatus ||
        lastStatus.valid !== s.valid ||
        lastValid !== valid ||
        lastStatus.fetchedAt !== s.fetchedAt
      ) {
        lastStatus = s;
        lastValid = valid;
        render();
      }
    },
  };
}
