import type { CommitFs, CommitPlan } from './ode-materialize.mjs';

export const MULTIPAGE_KIND: 'reconciliation-multipage';
export const MULTIPAGE_VERSION: 1;
export class ManifestWriteError extends Error {}
export class MultipageError extends Error {
  problems: string[];
}

export interface Freeze {
  mincreationtime: string;
  maxcreationtime: string;
}
export interface MultipageExclusion {
  odeId: string;
  productId: string;
  reason: string;
  metadataGeometry: string;
  inShapefiles: Record<string, boolean>;
}
export interface MultipageWindow {
  offset: number;
  limit: number;
  counts: { catalogued: number; footprints: number; excluded: number };
  geometry: {
    kind: 'a' | 'l';
    variants: Record<string, { records: number; distinct: number }>;
    shapes: number;
  };
  datasetIds: string[];
  target: { expected: string; check: string; observed: string[] };
  sources: Record<
    'metadata' | 'coverage',
    {
      file: string;
      sha256: string;
      receivedBytes: number;
      retrievedAt: string;
      httpStatus: number | null;
    }
  >;
  footprintIds: string[];
  productIds: string[];
  excluded: MultipageExclusion[];
  page: { sha256: string; bytes: number; products: number };
}
export interface MultipageManifest {
  version: number;
  kind: string;
  dataset: string;
  geometryKind: 'a' | 'l' | null;
  freeze: Freeze;
  pageSize: number;
  catalogueCount: number;
  target: string;
  allowedDatasetIds: string[];
  counts: {
    catalogued: number;
    footprints: number;
    excluded: number;
    windows: number;
  };
  status: string;
  windows: MultipageWindow[];
  builtAt: string;
  note: string;
}
export interface WindowPlan extends CommitPlan {
  key: string;
  kind: 'a' | 'l';
  offset: number;
  status: 'a-publier' | 'deja-publiee';
  catalogued: number;
}
export interface QualifiedDataset {
  cacheDir: string;
  key: string;
  manifest: MultipageManifest;
  file: string;
}

export function windowOffsets(count: number, pageSize?: number): number[];
export const multipageManifestPath: (cacheDir: string, key: string) => string;
export function buildPageBytes(products: unknown[]): Buffer;
export function analyzeWindow(options: Record<string, unknown>): {
  window: MultipageWindow | null;
  problems: string[];
};
export function validateMultipageManifest(
  manifest: unknown,
  options: {
    key: string;
    freeze: Freeze;
    catalogueCount: number;
    pageSize?: number;
  }
): string[];
export function buildMultipageManifest(
  options: Record<string, unknown>
): MultipageManifest;
export function allowedDatasetIdsFromIipt(iipt: unknown, key: string): string[];
export function discoverCaptures(
  cacheDir: string,
  key: string
): { found: Map<string, string>; problems: string[] };
export function qualifyDataset(options: {
  cacheDir: string;
  key: string;
  now?: Date;
}): MultipageManifest;
export function verifyWindowSources(
  manifest: MultipageManifest,
  offset: number,
  cacheDir: string
): string[];
export function requalificationDiffs(
  manifest: MultipageManifest,
  recomputed: MultipageManifest
): string[];
export function loadQualifiedDataset(options: {
  cacheDir: string;
  key: string;
}): QualifiedDataset;
export function planWindowPage(
  ctx: QualifiedDataset,
  offset: number
): WindowPlan;
export function materializeWindows(options: {
  cacheDir: string;
  key: string;
  offsets: number[] | 'all';
  write?: boolean;
  fs?: CommitFs;
}): {
  key: string;
  mode: string;
  report: { offset: number; status: string; sha256: string; bytes: number }[];
};
export function writeManifestExclusive(
  file: string,
  text: string,
  options?: { fs?: Record<string, unknown> }
): { file: string; sha256: string; bytes: number };
export function parseArgs(argv: string[]): {
  command: 'build' | 'materialize';
  cacheDir: string;
  key: string;
  offset: string | null;
  write: boolean;
};
export function run(argv: string[]): Record<string, unknown>;
