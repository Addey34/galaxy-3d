/** Déclarations de `scripts/ode-selection.mjs`, pour les tests de `src/config/`. */

export const COLLECTABLE_BODIES: readonly string[];

export interface OdeDataset {
  key: string;
  target: string;
  IHID: string;
  [field: string]: unknown;
}

export function selectDatasets(
  list: readonly OdeDataset[],
  options: { body: string | null | undefined; only?: string | null }
): OdeDataset[];

export function resolveCacheDir(options: {
  arg: string | null | undefined;
  env: string | null | undefined;
  root: string;
  requireExternal: boolean;
}): string;

export function assertMetadataComplete(options: {
  list: readonly OdeDataset[];
  counts: Record<string, number>;
  redundancy: Record<string, { verdict?: string }>;
  unfrozen: Record<string, unknown> | null | undefined;
  freezeOnDisk: { mincreationtime: string; maxcreationtime: string } | null;
  freeze: { mincreationtime: string; maxcreationtime: string };
}): void;

export function acquireLock(
  cacheDir: string,
  options?: { isAlive?: (pid: number) => boolean }
): () => void;
