/**
 * Couche TEMPÉRATURE DE SURFACE DE LA MER (GHRSST MUR de niveau 4, lot 53). Configuration fine de
 * observedTextureLayer, sur le mesh `thermal` : elle appartient au groupe exclusif des
 * températures, une seule à la fois sur ce mesh. La terre est transparente dans la source.
 */
import { SEA_SURFACE_TEMPERATURE_SETTINGS } from '@/config/engine';
import {
  colormapBoundsC,
  colormapToCss,
  gibsColormap,
} from '@/core/gibsLegend';
import { resolveSeaSurfaceTemperatureSources } from '@/core/layerSource';
import { getEarth, type WeatherLayerHandle } from './earthLayer';
import { setupObservedTextureLayer } from './observedTextureLayer';
import type { PublicAPI } from '@/SolarSystemApp';

export function setupSeaTemperatureLayer(
  api: PublicAPI
): WeatherLayerHandle | null {
  const settings = SEA_SURFACE_TEMPERATURE_SETTINGS;
  const colormap = gibsColormap('GHRSST_L4_MUR_Sea_Surface_Temperature');
  const bounds = colormapBoundsC(colormap);
  return setupObservedTextureLayer(api, {
    name: 'SeaTemperatureLayer',
    id: 'sea-temperature',
    labelKey: 'weather.seaTemperature',
    noteKey: 'weather.seaTemperature.note',
    enabled: settings.enabled,
    initial: settings.visibleByDefault,
    earth: getEarth(api, 'SeaTemperatureLayer', settings.enabled),
    targetLayer: 'thermal',
    resolveSources: (simDate, now) =>
      resolveSeaSurfaceTemperatureSources(simDate, now, {
        latencyDays: settings.latencyDays,
        stepBackDays: settings.stepBackDays,
        resolution: settings.resolution,
      }),
    minTileBytes: settings.minTileBytes,
    // Barème de la NASA (°C), rendu par nous : bornes DÉRIVÉES du barème, pas retapées.
    legendGradient: {
      css: colormapToCss(colormap),
      loText: bounds.lo,
      hiText: bounds.hi,
    },
    apply: (earth, texture) =>
      earth.setThermalTexture(texture, { opacity: settings.opacity }),
  });
}
