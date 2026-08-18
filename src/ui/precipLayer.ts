/** Couche satellite NASA IMERG. Configuration fine de observedTextureLayer. */
import { PRECIP_SETTINGS } from '@/config/engine';
import { resolvePrecipSources } from '@/core/layerSource';
import { getEarth, type WeatherLayerHandle } from './earthLayer';
import { setupObservedTextureLayer } from './observedTextureLayer';
import type { PublicAPI } from '@/SolarSystemApp';

export function setupPrecipLayer(api: PublicAPI): WeatherLayerHandle | null {
  const settings = PRECIP_SETTINGS;
  return setupObservedTextureLayer(api, {
    name: 'PrecipLayer',
    id: 'precip',
    labelKey: 'weather.precip',
    noteKey: 'weather.precip.note',
    enabled: settings.enabled,
    initial: settings.enabled,
    earth: getEarth(api, 'PrecipLayer', settings.enabled),
    targetLayer: 'precip',
    resolveSources: (simDate, now) =>
      resolvePrecipSources(simDate, now, {
        latencyHours: settings.latencyHours,
        minDate: settings.minDate,
        stepBack: settings.stepBack,
        resolution: settings.resolution,
      }),
    minTileBytes: settings.minTileBytes,
    legendGradient: {
      css: 'linear-gradient(90deg, rgb(191,230,255) 0%, rgb(51,133,242) 55%, rgb(8,26,107) 100%)',
      loKey: 'weather.precip.legendLo',
      hiKey: 'weather.precip.legendHi',
    },
    apply: (earth, texture) =>
      earth.setPrecipTexture(texture, { opacity: settings.opacity }),
  });
}