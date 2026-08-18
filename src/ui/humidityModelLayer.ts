/** Humidité relative à 2 m modélisée par Open-Meteo. Thin layer du socle météo commun. */
import { HUMIDITY_MODEL_SETTINGS } from '@/config/engine';
import {
  HUMIDITY_DOMAIN,
  HUMIDITY_PALETTE,
  paletteToCss,
  scalarGridToRGBA,
} from '@/core/meteoPalette';
import { setupMeteoModelLayer } from './meteoModelLayer';
import { getEarth, type WeatherLayerHandle } from './earthLayer';
import type { PublicAPI } from '@/SolarSystemApp';

export function setupHumidityModelLayer(
  api: PublicAPI
): WeatherLayerHandle | null {
  const settings = HUMIDITY_MODEL_SETTINGS;
  if (!settings.enabled) return null;

  return setupMeteoModelLayer(api, getEarth(api, 'HumidityModelLayer'), {
    id: 'humidity-model',
    labelKey: 'weather.humidityModel',
    noteKey: 'weather.humidityModel.note',
    variable: settings.variable,
    forecastGrid: { step: settings.gridStep, maxLat: settings.maxLat },
    archiveGrid: { step: settings.archiveGridStep, maxLat: settings.maxLat },
    opacity: settings.opacity,
    targetLayer: 'thermal',
    legendGradient: {
      css: paletteToCss(HUMIDITY_PALETTE),
      loKey: 'weather.humidityModel.lo',
      hiKey: 'weather.humidityModel.hi',
    },
    encodeGrid: (grid) =>
      scalarGridToRGBA(grid, HUMIDITY_PALETTE, {
        min: HUMIDITY_DOMAIN.min,
        max: HUMIDITY_DOMAIN.max,
      }),
  });
}
