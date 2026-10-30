/** Pluie modele Open-Meteo. Configuration fine du socle meteorologique commun. */
import { PRECIP_MODEL_SETTINGS } from '@/config/engine';
import {
  scalarGridToRGBA,
  PRECIP_PALETTE,
  PRECIP_DOMAIN,
  paletteToCss,
} from '@/core/meteoPalette';
import { intlLocale } from '@/i18n';
import { rainBound } from '@/core/legendBounds';
import { setupMeteoModelLayer } from './meteoModelLayer';
import { getEarth, type WeatherLayerHandle } from './earthLayer';
import type { PublicAPI } from '@/SolarSystemApp';

export function setupPrecipModelLayer(
  api: PublicAPI
): WeatherLayerHandle | null {
  const settings = PRECIP_MODEL_SETTINGS;
  if (!settings.enabled) return null;

  return setupMeteoModelLayer(api, getEarth(api, 'PrecipModelLayer'), {
    id: 'precip-model',
    labelKey: 'weather.precipModel',
    noteKey: 'weather.precipModel.note',
    variable: settings.variable,
    forecastGrid: { step: settings.gridStep, maxLat: settings.maxLat },
    archiveGrid: { step: settings.archiveGridStep, maxLat: settings.maxLat },
    opacity: settings.opacity,
    targetLayer: 'precip',
    encodeGrid: (grid) =>
      scalarGridToRGBA(grid, PRECIP_PALETTE, {
        min: PRECIP_DOMAIN.min,
        max: PRECIP_DOMAIN.max,
        transparentBelow: settings.transparentBelow,
        alphaRamp: settings.alphaRamp,
      }),
    legendGradient: {
      css: paletteToCss(PRECIP_PALETTE),
      loText: () =>
        rainBound(settings.transparentBelow, { locale: intlLocale() }),
      hiText: () =>
        rainBound(PRECIP_DOMAIN.max, { saturates: true, locale: intlLocale() }),
    },
  });
}
