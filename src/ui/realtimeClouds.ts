/**
 * Couverture nuageuse RÉELLE de la Terre (NASA GIBS), synchronisée sur la date de la
 * simulation. Fine configuration du socle générique `datedTextureLayer` : ne décrit que
 * ce qui est propre aux nuages — dérivation clé/URL (via `core/gibsClouds`) et application
 * (extraction shader via `CelestialObject.setRealCloudsTexture`). Tout le cycle
 * charger/cache/dédup/synchro-date/repli vit dans le socle.
 *
 * Repli : hors plage ou échec réseau, le socle n'applique rien → la texture nuages statique
 * déjà en place reste affichée (repli non destructif).
 */
import type * as THREE from 'three';
import { REALTIME_CLOUDS_SETTINGS } from '@/config/engine';
import {
  resolveCloudSources,
  resolveCloudFractionDaySource,
  resolveCloudFractionNightSource,
} from '@/core/layerSource';
import { createDatedTextureLayer } from './datedTextureLayer';
import {
  getEarth,
  createResolvedRelay,
  type WeatherLayerHandle,
} from './earthLayer';
import type { MeteoLayerDiagnostics } from '@/core/meteoDiagnostics';
import type { PublicAPI } from '@/SolarSystemApp';
import { hasDebugFlag } from '@/utils/debugFlags';

const DEBUG_CLOUDS_RAW = hasDebugFlag('debug-clouds-raw');
const DEBUG_CLOUDS = hasDebugFlag('debug-clouds') || DEBUG_CLOUDS_RAW;

async function debugTexture(
  label: string,
  texture: THREE.Texture
): Promise<void> {
  if (!DEBUG_CLOUDS) return;
  const image = texture.image as
    (CanvasImageSource & { width?: number; height?: number }) | undefined;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (!image || !width || !height || typeof OffscreenCanvas === 'undefined') {
    console.info(
      '[cloud-debug]',
      JSON.stringify({ label, width, height, hasImage: !!image })
    );
    return;
  }
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, width, height);
    const rows = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const y = Math.min(height - 1, Math.round(ratio * (height - 1)));
      const pixels = ctx.getImageData(0, y, width, 1).data;
      let dark = 0;
      let transparent = 0;
      for (let x = 0; x < width; x += 4) {
        const o = x * 4;
        if (Math.max(pixels[o], pixels[o + 1], pixels[o + 2]) < 12) dark++;
        if (pixels[o + 3] < 12) transparent++;
      }
      const samples = Math.ceil(width / 4);
      return {
        row: y,
        darkRatio: dark / samples,
        transparentRatio: transparent / samples,
      };
    });
    console.info(
      '[cloud-debug]',
      JSON.stringify({ label, width, height, rows })
    );
  } catch (error) {
    console.info(
      '[cloud-debug]',
      JSON.stringify({ label, width, height, pixelProbeError: String(error) })
    );
  }
}
export function setupRealtimeClouds(api: PublicAPI): WeatherLayerHandle {
  const settings = REALTIME_CLOUDS_SETTINGS;
  const earth = getEarth(api, 'RealtimeClouds', settings.enabled);
  const relay = createResolvedRelay();

  // La texture statique historique reste cachée tant qu'une observation NASA n'est pas
  // disponible, sauf si le fallback hors-ligne est explicitement activé dans la configuration.
  earth?.setLayerVisible('clouds', false);
  // Applique une texture satellite à la couche nuages (extraction shader). Mémorisée pour
  // pouvoir la RÉ-APPLIQUER quand on revient du modèle (la couche modèle a écrasé la map).
  const applySatellite = (texture: THREE.Texture): void => {
    if (DEBUG_CLOUDS)
      console.info(
        '[cloud-debug] mode',
        DEBUG_CLOUDS_RAW
          ? 'True Color only (raw diagnostic)'
          : 'True Color + Cloud Fraction Day/Night masks'
      );
    void debugTexture('true-color-after-orientation', texture);
    earth!.setRealCloudsTexture(texture, {
      opacity: settings.opacity,
      lumLow: settings.cloudLuminanceLow,
      lumLowLand: settings.cloudLuminanceLowLand,
      lumHigh: settings.cloudLuminanceHigh,
      satMax: settings.cloudSaturationMax,
      supplementalMaps: !DEBUG_CLOUDS_RAW,
      // Comblement des TROUS de fauchée VIIRS (bande polaire Sud « en marches ») par le modèle
      // Open-Meteo, chargé en arrière-plan. Le shader ne l'applique QUE là où le satellite est
      // absent (`modelAlpha * (1 - satelliteCoverage)`) : le VIIRS détaillé prime partout où il
      // existe, le modèle ne bouche que les vides. Pas en mode diagnostic brut (True Color pur).
      syntheticFill: !DEBUG_CLOUDS_RAW,
    });
  };

  let lastTexture: THREE.Texture | null = null;
  let lastSource: MeteoLayerDiagnostics['source'];
  let lastDayMaskSource: MeteoLayerDiagnostics['source'];
  let lastNightMaskSource: MeteoLayerDiagnostics['source'];
  let satelliteVisible = false;

  const disposeSatellite = createDatedTextureLayer(api, {
    name: 'RealtimeClouds',
    enabled: settings.enabled && !!earth,
    // Fallback en chaîne : VIIRS (≥2015) → MODIS Terra (≥2000) → MODIS Aqua (≥2002).
    // Latence config propagée (défaut 2 j) : l'imagerie satellite de J-1 est souvent
    // incomplète (fauchée orbitale) → J-2 pour une image complète sans bande « chauve ».
    resolveSources: (simDate, now) =>
      resolveCloudSources(simDate, now, { latencyDays: settings.latencyDays }),
    minTileBytes: settings.minTileBytes,
    apply: (texture) => {
      lastTexture = texture;
      if (satelliteVisible) {
        applySatellite(texture);
        earth?.setLayerVisible('clouds', true);
      }
    },
    onResolved: (candidate) => {
      lastSource = candidate;
      if (DEBUG_CLOUDS)
        console.info('[cloud-debug] true-color source', candidate);
      relay.push(candidate);
    },
  });

  // Masque satellite de jour : il remplace l'heuristique True Color dès qu'un pixel
  // possède une mesure scientifique de couverture nuageuse.
  const disposeDayMask = createDatedTextureLayer(api, {
    name: 'RealtimeCloudsDayMask',
    enabled: settings.enabled && !!earth && !DEBUG_CLOUDS_RAW,
    resolveSources: (simDate, now) => {
      const candidate = resolveCloudFractionDaySource(simDate, now, {
        latencyDays: settings.latencyDays,
        resolution: settings.resolution,
      });
      return candidate ? [candidate] : [];
    },
    minTileBytes: settings.minTileBytes,
    apply: (texture) => {
      if (DEBUG_CLOUDS) console.info('[cloud-debug] day mask applied');
      void debugTexture('cloud-fraction-day', texture);
      earth!.setRealCloudsDayTexture(texture);
    },
    onResolved: (candidate) => {
      lastDayMaskSource = candidate;
    },
  });

  // Complément satellite : MODIS Cloud Fraction Night remplit uniquement les pixels True Color
  // noirs (nuit polaire). Ce n'est ni le modèle Open-Meteo ni une seconde couche visible.
  const disposeNightFallback = createDatedTextureLayer(api, {
    name: 'RealtimeCloudsNightFallback',
    enabled: settings.enabled && !!earth && !DEBUG_CLOUDS_RAW,
    resolveSources: (simDate, now) => {
      const candidate = resolveCloudFractionNightSource(simDate, now, {
        latencyDays: settings.latencyDays,
        resolution: settings.resolution,
      });
      return candidate ? [candidate] : [];
    },
    minTileBytes: settings.minTileBytes,
    apply: (texture) => {
      if (DEBUG_CLOUDS) console.info('[cloud-debug] night fallback applied');
      void debugTexture('cloud-fraction-night', texture);
      earth!.setRealCloudsNightFallbackTexture(texture);
    },
    onResolved: (candidate) => {
      lastNightMaskSource = candidate;
    },
  });
  return {
    id: 'clouds',
    labelKey: 'weather.clouds',
    initial: true, // couche satellite par défaut ; le modèle est un secours explicite.
    // Nuages : couleur non quantitative (blanc réaliste) → texte explicatif, pas de barre.
    noteKey: 'weather.clouds.note',
    setVisible: (next) => {
      satelliteVisible = next;
      // Devient visible : la couche modèle a pu écraser la map nuages (extraction OFF, alphaMap).
      // On ré-applique la dernière image satellite pour restaurer l'extraction et la texture.
      if (next && lastTexture) {
        applySatellite(lastTexture);
        earth?.setLayerVisible('clouds', true);
        return;
      }
      earth?.setLayerVisible(
        'clouds',
        next && settings.cloudStaticTextureFallbackEnabled
      );
    },
    diagnostics: () => {
      const render = earth?.getLayerDiagnostics('clouds');
      return {
        id: 'clouds',
        family: 'realtime',
        targetLayer: 'clouds',
        visible: render?.visible ?? satelliteVisible,
        phase: lastTexture ? 'ready' : 'idle',
        updatedAt: Date.now(),
        source: lastSource,
        message:
          (DEBUG_CLOUDS_RAW ? 'raw=true; ' : '') +
          'day mask=' +
          (lastDayMaskSource?.label ?? 'none') +
          '; night mask=' +
          (lastNightMaskSource?.label ?? 'none'),
        render,
      };
    },
    onResolved: relay.subscribe,
    dispose: () => {
      disposeSatellite();
      disposeDayMask();
      disposeNightFallback();
    },
  };
}
