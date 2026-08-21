/**
 * Socle commun des couches meteorologiques modele Open-Meteo.
 *
 * Une couche specifique ne fournit que :
 * - la variable Open-Meteo et les reglages de grille ;
 * - l encodage d une ScalarGrid en octets RGBA ;
 * - la couche cible et les metadonnees du panneau.
 *
 * Le cycle date -> fetch -> texture -> badge -> visibility vit ici une seule fois.
 */
import * as THREE from 'three';
import { fetchMeteoGrid, type MeteoGridData } from '@/core/meteoClient';
import { meteoHourKey } from '@/core/meteoTimeTravel';
import type { ScalarGrid, MeteoGridOptions } from '@/core/meteoGrid';
import {
  describeMeteoGrid,
  type MeteoLayerDiagnostics,
} from '@/core/meteoDiagnostics';
import { createDatedDataLayer } from './datedDataLayer';
import { createMeteoDataTexture } from './meteoTexture';
import {
  createResolvedRelay,
  createLoadStateRelay,
  type WeatherLayerHandle,
} from './earthLayer';
import type { SourceCandidate } from '@/core/layerSource';
import type { PublicAPI } from '@/SolarSystemApp';

export interface MeteoTextureData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MeteoModelLayerConfig {
  id: string;
  labelKey: string;
  noteKey?: string;
  legendGradient?: { css: string; loKey: string; hiKey: string };
  variable: string;
  forecastGrid: MeteoGridOptions;
  archiveGrid: MeteoGridOptions;
  opacity: number;
  targetLayer: string;
  initial?: boolean;
  /** Charge la donnée même masquée pour combler les trous d’une observation. */
  background?: boolean;
  /** Applique la donnée comme secours sans remplacer le renderer principal. */
  applyFallback?: (
    earth: import('@/components/celestial/CelestialObject').default,
    tex: THREE.DataTexture
  ) => void;

  encodeGrid: (grid: ScalarGrid) => MeteoTextureData;
  sourceIdPrefix?: string;
  sourceLabel?: (data: MeteoGridData) => string;
}

function defaultSourceLabel(data: MeteoGridData): string {
  return data.plan.source === 'archive' ? 'ERA5' : 'Open-Meteo';
}

function sourceCandidate(
  config: MeteoModelLayerConfig,
  data: MeteoGridData
): SourceCandidate {
  const prefix = config.sourceIdPrefix ?? 'openmeteo-' + config.id;
  return {
    id: prefix + ':' + data.plan.source + ':' + data.realDate.slice(0, 13),
    label: (config.sourceLabel ?? defaultSourceLabel)(data),
    url: '',
    realDate: data.realDate,
    approx: data.plan.status !== 'observed' && data.plan.status !== 'analysis',
  };
}

export function setupMeteoModelLayer(
  api: PublicAPI,
  earth: import('@/components/celestial/CelestialObject').default | undefined,
  config: MeteoModelLayerConfig
): WeatherLayerHandle | null {
  if (!earth) return null;

  const relay = createResolvedRelay();
  const loadState = createLoadStateRelay();
  let currentTexture: THREE.DataTexture | null = null;
  let visible = config.initial ?? false;
  let lastSource: MeteoLayerDiagnostics['source'];
  let lastGrid: MeteoLayerDiagnostics['grid'];
  let phase: MeteoLayerDiagnostics['phase'] = 'idle';
  let stopData: (() => void) | null = null;

  const applyIfVisible = (): void => {
    if (!currentTexture) return;
    config.applyFallback?.(earth, currentTexture);
    if (!visible) return;
    earth.setDataOverlay(config.targetLayer, currentTexture, {
      opacity: config.opacity,
    });
    // La couche cible ne devient visible qu'après réception de sa propre grille :
    // elle partage parfois le mesh d'une observation (MERRA-2 ou IMERG).
    earth.setLayerVisible(config.targetLayer, true);
  };

  const startData = (): void => {
    if (stopData) return;

    stopData = createDatedDataLayer<MeteoGridData>(api, {
      name: config.id + 'Layer',
      enabled: true,
      keyForDate: meteoHourKey,
      fetchForKey: async (key) => {
        const simDate = new Date(key + ':00:00Z');
        return fetchMeteoGrid(simDate, {
          variable: config.variable,
          forecastGrid: config.forecastGrid,
          archiveGrid: config.archiveGrid,
        });
      },
      onStateChange: (next) => {
        phase = next;
        loadState.push(next);
      },
      apply: (data) => {
        if (data.grid) {
          const encoded = config.encodeGrid(data.grid);
          const nextTexture = createMeteoDataTexture(
            encoded.data,
            encoded.width,
            encoded.height
          );
          currentTexture?.dispose();
          currentTexture = nextTexture;
          lastGrid = describeMeteoGrid(data.grid);
          phase = 'ready';
          applyIfVisible();
        }
        const source = sourceCandidate(config, data);
        lastSource = source;
        relay.push(source);
      },
      checkIntervalMs: 1000,
    });
  };

  if (visible || config.background) startData();

  return {
    id: config.id,
    labelKey: config.labelKey,
    initial: visible,
    noteKey: config.noteKey,
    legendGradient: config.legendGradient,
    setVisible: (next) => {
      visible = next;
      if (next) {
        startData();
        // Tant qu'aucune donnée modèle n'est disponible, garder le mesh caché
        // pour ne pas révéler par erreur le matériau de la couche d'observation.
        if (currentTexture) applyIfVisible();
        return;
      }

      earth.restoreLayerMaterial(config.targetLayer);
      earth.setLayerVisible(config.targetLayer, false);
    },
    diagnostics: () => {
      const render = earth.getLayerDiagnostics(config.targetLayer);
      return {
        id: config.id,
        family: 'model',
        targetLayer: config.targetLayer,
        visible,
        phase,
        updatedAt: Date.now(),
        source: lastSource,
        grid: lastGrid,
        render,
      };
    },
    onResolved: relay.subscribe,
    onLoadStateChange: loadState.subscribe,
    dispose: () => {
      stopData?.();
      stopData = null;
      currentTexture?.dispose();
      currentTexture = null;
    },
  };
}
