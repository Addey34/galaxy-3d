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
    // ÉTEINTE au démarrage, sur desktop comme sur mobile. Imposée d'entrée, elle s'empilait
    // avec les nuages et le vent et noyait la surface : signalement d'un globe « délavé »
    // puis « transparent », alors que la Terre était simplement enfouie sous trois nappes de
    // données que personne n'avait demandées. Elle reste à un clic dans le panneau météo.
    //
    // CHOIX DE SOBRIÉTÉ, pas une règle — et la nuance a déjà coûté une erreur. La règle des
    // couches (CONTRIBUTING.md) range les précipitations AVEC les nuages, en apparence
    // physique, et elle décide de la largeur du TERMINATEUR, pas de la visibilité au
    // démarrage. L'invoquer ici serait s'autoriser une décision produit au nom d'un texte qui
    // ne la porte pas. Le vent, lui, est bien une couche d'instrument à ce sens-là.
    // Réversible en une ligne ; `e2e/weather.spec.ts` tient l'état attendu.
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
