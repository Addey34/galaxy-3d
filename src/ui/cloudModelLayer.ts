/** Modele de couverture nuageuse Open-Meteo. La logique commune vit dans meteoModelLayer. */
import { CLOUD_MODEL_SETTINGS } from '@/config/engine';
import { cloudCoverToRGBA } from '@/core/meteoGrid';
import { getEarth, type WeatherLayerHandle } from './earthLayer';
import { setupMeteoModelLayer } from './meteoModelLayer';
import type { PublicAPI } from '@/SolarSystemApp';

export function setupCloudModelLayer(
  api: PublicAPI
): WeatherLayerHandle | null {
  const settings = CLOUD_MODEL_SETTINGS;
  if (!settings.enabled) return null;

  return setupMeteoModelLayer(api, getEarth(api, 'CloudModelLayer'), {
    id: 'clouds-model',
    labelKey: 'weather.cloudsModel',
    noteKey: 'weather.cloudsModel.note',
    variable: 'cloud_cover',
    forecastGrid: { step: settings.gridStep, maxLat: settings.maxLat },
    archiveGrid: { step: settings.archiveGridStep, maxLat: settings.maxLat },
    opacity: settings.opacity,
    targetLayer: 'clouds',
    initial: settings.initial,
    // Activation MANUELLE (pas de chargement au boot) : le modèle comble les trous de fauchée
    // VIIRS (bande polaire Sud) via setRealCloudsModelFallback quand on active « Nuages (modèle) »
    // dans le panneau. Le chargement automatique en arrière-plan est écarté : au boot systématique
    // il déclenchait une rafale de requêtes Open-Meteo (instable sous quota 429). À réévaluer avec
    // une stratégie de charge différée quand l'API est disponible pour tester en conditions réelles.
    background: false,
    applyFallback: (earth, texture) =>
      earth.setRealCloudsModelFallbackTexture(texture),

    sourceIdPrefix: 'openmeteo-cloud',
    encodeGrid: (grid) => cloudCoverToRGBA(grid, settings.gamma),
  });
}
