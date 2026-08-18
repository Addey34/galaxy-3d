/** Couche satellite MERRA-2 temperature. Configuration fine de observedTextureLayer. */
import { THERMAL_SETTINGS } from '@/config/engine';
import { GIBS_LST_LAYER, gibsLegendUrl } from '@/core/gibsClouds';
import { resolveThermalSources } from '@/core/layerSource';
import { getEarth, type WeatherLayerHandle } from './earthLayer';
import { setupObservedTextureLayer } from './observedTextureLayer';
import type { PublicAPI } from '@/SolarSystemApp';

export function setupThermalLayer(api: PublicAPI): WeatherLayerHandle | null {
  const settings = THERMAL_SETTINGS;
  return setupObservedTextureLayer(api, {
    name: 'ThermalLayer',
    id: 'thermal',
    labelKey: 'weather.thermal',
    noteKey: 'weather.thermal.note',
    enabled: settings.enabled,
    initial: settings.visibleByDefault,
    earth: getEarth(api, 'ThermalLayer', settings.enabled),
    targetLayer: 'thermal',
    resolveSources: (simDate, now) =>
      resolveThermalSources(simDate, now, {
        latencyMonths: settings.latencyMonths,
        minDate: settings.minDate,
        stepBackMonths: settings.stepBackMonths,
        resolution: settings.resolution,
      }),
    minTileBytes: settings.minTileBytes,
    legendUrl: gibsLegendUrl(settings.layer ?? GIBS_LST_LAYER, 'H'),
    apply: (earth, texture) =>
      earth.setThermalTexture(texture, { opacity: settings.opacity }),
  });
}