/**
 * Fabrique commune des couches satellite/GIBS simples.
 *
 * Les couches qui ne font que resoudre une texture datee, l appliquer a un mesh et exposer un
 * handle de panneau passent ici. Les nuages satellite restent dans realtimeClouds car ils ont une
 * seconde texture nocturne et un cycle de reapplication specifique.
 */
import * as THREE from 'three';
import type { LayerSourceResolver } from '@/core/layerSource';
import { createDatedTextureLayer } from './datedTextureLayer';
import {
  createResolvedRelay,
  type WeatherLayerHandle,
} from './earthLayer';
import type CelestialObject from '@/components/celestial/CelestialObject';
import type { MeteoLayerDiagnostics } from '@/core/meteoDiagnostics';
import type { PublicAPI } from '@/SolarSystemApp';

export interface ObservedTextureLayerConfig {
  name: string;
  id: string;
  labelKey: string;
  noteKey?: string;
  enabled: boolean;
  initial: boolean;
  earth: CelestialObject | undefined;
  targetLayer: string;
  resolveSources: LayerSourceResolver;
  minTileBytes?: number;
  legendUrl?: string;
  legendGradient?: { css: string; loKey: string; hiKey: string };
  apply: (earth: CelestialObject, texture: THREE.Texture) => void;
}

export function setupObservedTextureLayer(
  api: PublicAPI,
  config: ObservedTextureLayerConfig
): WeatherLayerHandle | null {
  const earth = config.earth;
  if (!config.enabled || !earth) return null;

  const relay = createResolvedRelay();
  let lastSource: MeteoLayerDiagnostics['source'];
  let lastTexture: THREE.Texture | null = null;
  let phase: MeteoLayerDiagnostics['phase'] = 'idle';
  let visible = config.initial;

  const dispose = createDatedTextureLayer(api, {
    name: config.name,
    enabled: true,
    resolveSources: config.resolveSources,
    minTileBytes: config.minTileBytes,
    apply: (texture) => {
      lastTexture = texture;
      phase = 'ready';
      config.apply(earth, texture);
    },
    onResolved: (source) => {
      lastSource = source;
      relay.push(source);
    },
  });

  return {
    id: config.id,
    labelKey: config.labelKey,
    initial: config.initial,
    noteKey: config.noteKey,
    legendUrl: config.legendUrl,
    legendGradient: config.legendGradient,
    setVisible: (next) => {
      visible = next;
      earth.setLayerVisible(config.targetLayer, next);
    },
    diagnostics: () => {
      const render = earth.getLayerDiagnostics(config.targetLayer);
      return {
        id: config.id,
        family: 'observed',
        targetLayer: config.targetLayer,
        visible,
        phase,
        updatedAt: Date.now(),
        source: lastSource,
        render: lastTexture ? render : { ...render, map: undefined },
      };
    },
    onResolved: relay.subscribe,
    dispose,
  };
}