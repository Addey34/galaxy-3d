/** Temperature modele Open-Meteo. Configuration fine du socle meteorologique commun. */
import { THERMAL_MODEL_SETTINGS } from '@/config/engine';
import {
  scalarGridToRGBA,
  TEMPERATURE_PALETTE,
  TEMPERATURE_DOMAIN,
  paletteToCss,
} from '@/core/meteoPalette';
import { intlLocale } from '@/i18n';
import { temperatureBound } from '@/core/legendBounds';
import { setupMeteoModelLayer } from './meteoModelLayer';
import { getEarth, type WeatherLayerHandle } from './earthLayer';
import type { PublicAPI } from '@/SolarSystemApp';

export function setupThermalModelLayer(
  api: PublicAPI
): WeatherLayerHandle | null {
  const settings = THERMAL_MODEL_SETTINGS;
  if (!settings.enabled) return null;

  return setupMeteoModelLayer(api, getEarth(api, 'ThermalModelLayer'), {
    id: 'thermal-model',
    labelKey: 'weather.thermalModel',
    noteKey: 'weather.thermalModel.note',
    variable: settings.variable,
    forecastGrid: { step: settings.gridStep, maxLat: settings.maxLat },
    archiveGrid: { step: settings.archiveGridStep, maxLat: settings.maxLat },
    opacity: settings.opacity,
    targetLayer: 'thermal',
    legendGradient: {
      css: paletteToCss(TEMPERATURE_PALETTE),
      loText: () => temperatureBound(TEMPERATURE_DOMAIN.min, intlLocale()),
      hiText: () => temperatureBound(TEMPERATURE_DOMAIN.max, intlLocale()),
    },
    encodeGrid: (grid) =>
      scalarGridToRGBA(grid, TEMPERATURE_PALETTE, {
        min: TEMPERATURE_DOMAIN.min,
        max: TEMPERATURE_DOMAIN.max,
      }),
  });
}
