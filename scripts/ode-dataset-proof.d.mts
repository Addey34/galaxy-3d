import type { Freeze } from './ode-multipage.mjs';

export class DatasetProofError extends Error {}
export interface DatasetProof {
  format: 'historique' | 'multipage-v3';
  catalogued: number;
  footprints: number;
  excludedIds: ReadonlySet<string>;
  footprintIds: ReadonlySet<string>;
  [name: string]: unknown;
}
export function loadDatasetProof(options: {
  cacheDir: string;
  key: string;
  freeze: Freeze;
  catalogueCount: number;
  pageSize: number;
  checkSources?: boolean;
  exists?: (path: string) => boolean;
  loadHistoric?: (options: Record<string, unknown>) => unknown;
  loadMultipage?: (options: { cacheDir: string; key: string }) => unknown;
}): DatasetProof | null;
export function compactProof(
  proof: DatasetProof,
  key: string
): Record<string, unknown>;
