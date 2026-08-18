/** Pression au niveau de la mer modélisée par Open-Meteo. Thin layer du socle météo commun. */
import { PRESSURE_MODEL_SETTINGS } from '@/config/engine';
import {
  paletteToCss,
  PRESSURE_DOMAIN,
  PRESSURE_PALETTE,
  scalarGridToRGBA,
} from '@/core/meteoPalette';
import { setupMeteoModelLayer } from './meteoModelLayer';
import { getEarth, type WeatherLayerHandle } from './earthLayer';
import type { PublicAPI } from '@/SolarSystemApp';

export function setupPressureModelLayer(
  api: PublicAPI
): WeatherLayerHandle | null {
  const settings = PRESSURE_MODEL_SETTINGS;
  if (!settings.enabled) return null;

  return setupMeteoModelLayer(api, getEarth(api, 'PressureModelLayer'), {
    id: 'pressure-model',
    labelKey: 'weather.pressureModel',
    noteKey: 'weather.pressureModel.note',
    variable: settings.variable,
    forecastGrid: { step: settings.gridStep, maxLat: settings.maxLat },
    archiveGrid: { step: settings.archiveGridStep, maxLat: settings.maxLat },
    opacity: settings.opacity,
    targetLayer: 'thermal',
    legendGradient: {
      css: paletteToCss(PRESSURE_PALETTE),
      loKey: 'weather.pressureModel.lo',
      hiKey: 'weather.pressureModel.hi',
    },
    encodeGrid: (grid) =>
      scalarGridToRGBA(grid, PRESSURE_PALETTE, {
        min: PRESSURE_DOMAIN.min,
        max: PRESSURE_DOMAIN.max,
      }),
  });
}
