/**
 * Couverture nuageuse RÉELLE de la Terre (NASA GIBS), synchronisée sur la date de la
 * simulation. Fine configuration du socle générique `datedTextureLayer` : ne décrit que
 * ce qui est propre aux nuages — dérivation clé/URL (via `core/gibsClouds`) et application
 * (extraction shader via `CelestialObject.setRealCloudsTexture`). Tout le cycle
 * charger/cache/dédup/synchro-date/repli vit dans le socle.
 *
 * Repli : hors plage ou échec réseau, le socle n'applique rien → la texture nuages statique
 * déjà en place reste affichée (repli non destructif).
 */
import Logger from '@/utils/Logger';
import { REALTIME_CLOUDS_SETTINGS } from '@/config/engine';
import { gibsCloudDateFor, gibsCloudUrl } from '@/core/gibsClouds';
import { createDatedTextureLayer } from './datedTextureLayer';
import type { PublicAPI } from '@/SolarSystemApp';

const EARTH_NAME = 'earth';

export function setupRealtimeClouds(api: PublicAPI): () => void {
  const settings = REALTIME_CLOUDS_SETTINGS;
  const earth = api.sceneSystem.getBody(EARTH_NAME);
  if (settings.enabled && !earth) {
    Logger.warn('[RealtimeClouds] Terre introuvable — nuages réels désactivés.');
  }

  return createDatedTextureLayer(api, {
    name: 'RealtimeClouds',
    enabled: settings.enabled && !!earth,
    keyForDate: (date) =>
      gibsCloudDateFor(date, {
        latencyDays: settings.latencyDays,
        minDate: settings.minDate,
      }),
    urlForKey: (key) =>
      gibsCloudUrl(key, {
        layer: settings.layer,
        width: settings.resolution,
      }),
    apply: (texture) =>
      earth!.setRealCloudsTexture(texture, {
        opacity: settings.opacity,
        lumLow: settings.cloudLuminanceLow,
        lumLowLand: settings.cloudLuminanceLowLand,
        lumHigh: settings.cloudLuminanceHigh,
        satMax: settings.cloudSaturationMax,
      }),
  });
}
