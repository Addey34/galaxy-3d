/** Couche satellite MERRA-2 temperature. Configuration fine de observedTextureLayer. */
import { THERMAL_SETTINGS } from '@/config/engine';
import { intlLocale } from '@/i18n';
import { colormapRangeC, colormapToCss } from '@/core/gibsLegend';
import { temperatureBound } from '@/core/legendBounds';
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
    // Barème de la NASA, rendu par nous : sa légende officielle est une image distante que
    // notre CSP bloque (cf. `core/gibsLegend.ts`). Bornes DÉRIVÉES du barème, pas retapées.
    legendGradient: {
      css: colormapToCss(),
      loText: () => temperatureBound(colormapRangeC().lo, intlLocale()),
      hiText: () => temperatureBound(colormapRangeC().hi, intlLocale()),
    },
    apply: (earth, texture) =>
      earth.setThermalTexture(texture, { opacity: settings.opacity }),
  });
}
