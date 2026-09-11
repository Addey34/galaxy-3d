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
    // ÉTEINTE au démarrage, sur desktop comme sur mobile. La pluie est une couche
    // d'INSTRUMENT, pas l'apparence de la Terre (cf. la règle des couches dans
    // CONTRIBUTING.md). Imposée d'entrée, elle s'empilait avec les nuages et le vent et
    // noyait la surface : signalement d'un globe « délavé », puis « transparent », alors que
    // la Terre était simplement enfouie sous trois nappes de données que personne n'avait
    // demandées. Elle reste à un clic dans le panneau météo.
    initial: false,
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
