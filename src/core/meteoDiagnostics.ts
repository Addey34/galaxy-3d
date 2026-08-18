/**
 * Contrats de diagnostic météo.
 *
 * Ce module ne dépend ni du DOM ni de Three.js : il décrit uniquement les informations utiles
 * pour distinguer une erreur de donnée, de grille, de texture, de matériau ou de visibilité.
 */
import type { SourceCandidate } from './layerSource';

export type MeteoLayerFamily = 'observed' | 'model' | 'vector' | 'realtime';
export type MeteoLayerPhase = 'idle' | 'ready' | 'error';

export interface MeteoGridDiagnostics {
  step: number;
  latMin: number;
  latMax: number;
  nLat: number;
  nLon: number;
  sampleCount: number;
  longitudeSpan: number;
}

export interface MeteoTextureDiagnostics {
  width: number;
  height: number;
  wrapS: string;
  wrapT: string;
  minFilter: string;
  magFilter: string;
  generateMipmaps: boolean;
  colorSpace: string;
}

export interface MeteoGeometryDiagnostics {
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
}

export function describeMeteoGrid(grid: MeteoGridShape): MeteoGridDiagnostics {
  return {
    step: grid.step,
    latMin: grid.latMin,
    latMax: grid.latMin + (grid.nLat - 1) * grid.step,
    nLat: grid.nLat,
    nLon: grid.nLon,
    sampleCount: grid.nLat * grid.nLon,
    longitudeSpan: grid.nLon * grid.step,
  };
}
