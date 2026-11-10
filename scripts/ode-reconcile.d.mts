import type { Manifest, Source } from './ode-reconciliation.mjs';

export function readSource(cacheDir: string, file: string): Source;
export function buildReconciliation(options: {
  cacheDir: string;
  key: string;
  metadataFile: string;
  coverageFile: string;
  now?: Date;
}): { manifest: Manifest; file: string };
export function replayReconciled(options: {
  cacheDir: string;
  key: string;
  dryRun?: boolean;
}): {
  status: 'dry-run' | 'written' | 'already-valid';
  dataset: string;
  catalogued: number;
  withFootprint: number;
  withoutGeometry: string[];
  page: string;
  coverageSha256: string;
  metadataSha256: string;
};
export function hasGeometry(product: Record<string, unknown>): boolean;
