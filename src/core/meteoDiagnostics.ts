/**
 * Contrats de diagnostic météo.
 *
 * Ce module ne dépend ni du DOM ni de Three.js : il décrit uniquement les informations utiles
 * pour distinguer une erreur de donnée, de grille, de texture, de matériau ou de visibilité.
 */
import type { SourceCandidate } from './layerSource';
import { countFiniteCells } from './meteoGrid';

type MeteoLayerFamily = 'observed' | 'model' | 'vector' | 'realtime';
export type MeteoLayerPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface MeteoGridDiagnostics {
  step: number;
  latMin: number;
  latMax: number;
  nLat: number;
  nLon: number;
  sampleCount: number;
  /** Cellules à valeur finie : `validCount < sampleCount` = grille partiellement indisponible. */
  validCount: number;
  longitudeSpan: number;
}

interface MeteoTextureDiagnostics {
  width: number;
  height: number;
  wrapS: string;
  wrapT: string;
  minFilter: string;
  magFilter: string;
  generateMipmaps: boolean;
  colorSpace: string;
}

interface MeteoGeometryDiagnostics {
  type: string;
  radius: number;
  vertexCount: number;
  uvCount: number;
}

export interface MeteoRenderDiagnostics {
  exists: boolean;
  visible: boolean;
  geometry?: MeteoGeometryDiagnostics;
  materialType?: string;
  materialName?: string;
  opacity?: number;
  /** Largeur du crépuscule appliquée par le matériau, `undefined` = couche d'instrument. */
  twilightWrap?: number;
  map?: MeteoTextureDiagnostics;
}

export interface MeteoLayerDiagnostics {
  id: string;
  family: MeteoLayerFamily;
  targetLayer?: string;
  visible: boolean;
  phase: MeteoLayerPhase;
  updatedAt: number;
  source?: Pick<
    SourceCandidate,
    'id' | 'label' | 'realDate' | 'approx' | 'coverage'
  >;
  grid?: MeteoGridDiagnostics;
  render?: MeteoRenderDiagnostics;
  message?: string;
}

export interface MeteoGridShape {
  step: number;
  latMin: number;
  nLat: number;
  nLon: number;
  /** Les valeurs de la grille, pour compter les cellules valides (absent : toutes comptées). */
  values?: ArrayLike<number>;
  /**
   * Cellules réellement disponibles quand elles ne se lisent pas dans `values` : le vent est
   * composé de deux grilles, et ce qui compte est le nombre de cellules où u ET v sont finis.
   */
  validCount?: number;
}

export function describeMeteoGrid(grid: MeteoGridShape): MeteoGridDiagnostics {
  return {
    step: grid.step,
    latMin: grid.latMin,
    latMax: grid.latMin + (grid.nLat - 1) * grid.step,
    nLat: grid.nLat,
    nLon: grid.nLon,
    sampleCount: grid.nLat * grid.nLon,
    validCount:
      grid.validCount ??
      (grid.values ? countFiniteCells(grid.values) : grid.nLat * grid.nLon),
    longitudeSpan: grid.nLon * grid.step,
  };
}
