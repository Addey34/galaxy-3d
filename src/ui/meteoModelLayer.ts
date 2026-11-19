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
  holdField,
  readScalar,
  type EmptyReason,
  type HeldField,
  type InspectVariable,
} from '@/core/meteoInspect';
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
import { PROVIDER_NAMES } from '@/core/providerNames';

interface MeteoTextureData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MeteoModelLayerConfig {
  id: string;
  labelKey: string;
  noteKey?: string;
  legendGradient?: WeatherLayerHandle['legendGradient'];
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
  /**
   * Ce que la couche répond à l'inspection d'un point (GAL-METEO-INSPECT-002). Absent : la couche
   * ne s'inspecte pas. La grille courante est gardée PAR RÉFÉRENCE (jamais copiée) et libérée
   * hors plage et à la destruction.
   */
  inspect?: {
    variable: Exclude<InspectVariable, 'wind'>;
    /** Unité de la valeur ; la précipitation prend la sienne de la nature du produit. */
    unit: string;
  };
  sourceIdPrefix?: string;
  sourceLabel?: (data: MeteoGridData) => string;
}

function defaultSourceLabel(
  data: Pick<MeteoGridData, 'plan' | 'provider'>
): string {
  if (data.provider) return data.provider;
  return data.plan.source === 'archive'
    ? PROVIDER_NAMES.era5
    : PROVIDER_NAMES.openMeteo;
}

/**
 * La source qu'une grille Open-Meteo a RÉELLEMENT servie, pour le badge du panneau. Exportée
 * pour la couche de vent (2026-10-12), qui n'est pas une texture et ne passe donc pas par
 * `setupMeteoModelLayer`, mais dont la donnée vient du même socle et se badge de même.
 */
export function meteoSourceCandidate(
  config: Pick<MeteoModelLayerConfig, 'id' | 'sourceIdPrefix' | 'sourceLabel'>,
  data: Pick<MeteoGridData, 'plan' | 'realDate' | 'provider'>
): SourceCandidate {
  const prefix = config.sourceIdPrefix ?? 'openmeteo-' + config.id;
  return {
    id: prefix + ':' + data.plan.source + ':' + data.realDate.slice(0, 13),
    label: (config.sourceLabel ?? defaultSourceLabel)(data as MeteoGridData),
    url: '',
    realDate: data.realDate,
    // L'heure servie est celle demandée : une prévision n'est pas une « date approchée »,
    // c'est sa catégorie temporelle (prédite) qui le dit.
    approx: false,
    product: data.plan.product,
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
  /** Dernière demande hors de la plage du modèle : rien à montrer pour la date de la scène. */
  let outOfRange = false;
  let lastSource: MeteoLayerDiagnostics['source'];
  let lastGrid: MeteoLayerDiagnostics['grid'];
  let phase: MeteoLayerDiagnostics['phase'] = 'idle';
  let stopData: (() => void) | null = null;
  /**
   * La grille courante, gardée pour l'inspection (référence, pas une copie) et la clé horaire de
   * la scène pour laquelle elle a été chargée. `null` hors plage du modèle et après `dispose`.
   */
  let held: HeldField<ScalarGrid> | null = null;
  /** Heure (clé `meteoHourKey`) que décrit `currentTexture` : elle ne se montre que si elle est celle de la scène. */
  let textureHourKey: string | null = null;
  /**
   * Une couche masquée ne demande plus rien à Open-Meteo (quota par IP, time-travel rapide),
   * SAUF si elle alimente une autre couche : `background`, ou un secours (`applyFallback`) qui
   * continue de combler les trous de l'observation même masquée.
   */
  const keepsLoadingWhenHidden = Boolean(
    config.background || config.applyFallback
  );

  const applyIfVisible = (): void => {
    if (!currentTexture) return;
    config.applyFallback?.(earth, currentTexture);
    if (!visible || outOfRange) return;
    earth.setDataOverlay(config.targetLayer, currentTexture, {
      opacity: config.opacity,
    });
    // La couche cible ne devient visible qu'après réception de sa propre grille :
    // elle partage parfois le mesh d'une observation (MERRA-2 ou IMERG).
    earth.setLayerVisible(config.targetLayer, true);
  };

  const startData = (): void => {
    if (stopData) return;

    stopData = createDatedDataLayer<MeteoGridData & { requestedKey: string }>(
      api,
      {
        name: config.id + 'Layer',
        enabled: true,
        keyForDate: meteoHourKey,
        fetchForKey: async (key, signal) => {
          const simDate = new Date(key + ':00:00Z');
          const data = await fetchMeteoGrid(simDate, {
            variable: config.variable,
            forecastGrid: config.forecastGrid,
            archiveGrid: config.archiveGrid,
            signal,
          });
          // La clé DEMANDÉE accompagne la donnée : `realDate` peut décrire un autre instant (pas de
          // 3 h de GFS), et seule la clé dit pour quelle heure de la scène la grille a été chargée.
          return { ...data, requestedKey: key };
        },
        onStateChange: (next) => {
          phase = next;
          loadState.push(next);
        },
        apply: (data) => {
          if (!data.grid) {
            // Hors de la plage du modèle (avant 1940, au-delà de l'horizon de prévision) : la
            // grille précédente décrit un AUTRE instant. La garder à l'écran sous l'étiquette de
            // cette date serait afficher une donnée qui n'existe pas.
            // La texture n'est pas libérée : elle peut rester branchée comme secours d'une
            // observation (`applyFallback`). Limite connue : ce secours décrit alors la dernière
            // heure chargée, pas forcément le jour de la tuile satellite qu'il complète.
            outOfRange = true;
            lastGrid = undefined;
            // Plus aucune grille pour cette date : l'inspection ne doit pas lire l'ancienne.
            held = null;
            if (visible) {
              earth.restoreLayerMaterial(config.targetLayer);
              earth.setLayerVisible(config.targetLayer, false);
            }
          } else {
            outOfRange = false;
            held = holdField(data.grid, data.requestedKey, data);
            textureHourKey = data.realDate.slice(0, 13);
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
          const source = meteoSourceCandidate(config, data);
          lastSource = source;
          relay.push(source);
        },
        checkIntervalMs: 1000,
      }
    );
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
        // La texture gardée d'une activation précédente décrit peut-être une AUTRE heure que
        // la scène : elle reste masquée jusqu'à l'arrivée de la donnée de la bonne heure.
        if (
          currentTexture &&
          textureHourKey === meteoHourKey(api.orbitalMechanics.simulationDate)
        )
          applyIfVisible();
        return;
      }

      earth.restoreLayerMaterial(config.targetLayer);
      earth.setLayerVisible(config.targetLayer, false);
      if (!keepsLoadingWhenHidden && stopData) {
        stopData();
        stopData = null;
        phase = 'idle';
        loadState.push('idle');
      }
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
    ...(config.inspect
      ? {
          inspect: (lat: number, lon: number) =>
            readScalar(
              config.inspect!.variable,
              config.inspect!.unit,
              held,
              {
                sceneDate: api.orbitalMechanics.simulationDate,
                active: visible,
                phase,
                emptyReason: (outOfRange
                  ? 'outOfRange'
                  : 'notLoaded') satisfies EmptyReason,
              },
              lat,
              lon
            ),
        }
      : {}),
    dispose: () => {
      stopData?.();
      stopData = null;
      held = null;
      currentTexture?.dispose();
      currentTexture = null;
    },
  };
}
