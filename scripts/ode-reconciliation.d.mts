export const RECONCILIATION_DIR: string;
export const MANIFEST_VERSION: number;
export const REASON_NO_GEOMETRY: string;
export const GEOMETRY_FIELDS: readonly string[];
export const SHAPEFILE_VARIANTS: readonly string[];

export class ReconciliationError extends Error {
  problems: string[];
  constructor(problems: string | string[]);
}

export interface Freeze {
  mincreationtime: string;
  maxcreationtime: string;
}

export interface Source {
  file: string;
  buffer: Buffer;
  provenance: Record<string, unknown> & { sha256?: string };
  sidecarSha256?: string;
}

export interface Manifest {
  version: number;
  kind: string;
  dataset: string;
  counts: { catalogued: number; footprints: number; excluded: number };
  excluded: {
    odeId: string;
    productId: string;
    reason: string;
    metadataGeometry: string;
    inShapefiles: Record<string, boolean>;
  }[];
  footprintIds: string[];
  freeze: Freeze;
  sources: Record<
    string,
    {
      sha256: string;
      file: string;
      variants: Record<string, { records: number; distinct: number }>;
    } & Record<string, unknown>
  >;
  note: string;
}

export interface LoadedReconciliation {
  manifest: Manifest;
  file: string;
  catalogued: number;
  footprints: number;
  excludedIds: ReadonlySet<string>;
  footprintIds: ReadonlySet<string>;
}

export function manifestPath(cacheDir: string, key: string): string;
export function sha256(buffer: Buffer): string;
export function hasGeometry(product: Record<string, unknown>): boolean;
export function readCatalogue(buffer: Buffer): {
  products: { id: string; productId: string; geometry: boolean }[];
  problems: string[];
};
export function readShapefiles(buffer: Buffer): {
  variants: Record<
    string,
    {
      records: number;
      ids: Set<string>;
      productIds: Map<string, string>;
    }
  >;
  problems: string[];
};
export function buildManifest(options: {
  key: string;
  freeze: Freeze;
  pageSize: number;
  catalogueCount: number;
  metadata: Source;
  coverage: Source;
  now?: Date;
}): Manifest;
export function validateManifest(
  manifest: unknown,
  options: {
    key: string;
    freeze: Freeze;
    catalogueCount: number;
    pageSize: number;
  }
): string[];
export function verifySources(
  manifest: Manifest,
  cacheDir: string,
  readFile?: (file: string) => Buffer
): void;
export function loadReconciliation(options: {
  cacheDir: string;
  key: string;
  freeze: Freeze;
  catalogueCount: number;
  pageSize: number;
  checkSources?: boolean;
  exists?: (file: string) => boolean;
  readFile?: (file: string, encoding?: string) => never;
}): LoadedReconciliation | null;
export function pageExpectation(options: {
  count: number;
  offset: number;
  pageSize: number;
  reconciliation: LoadedReconciliation | null | undefined;
}): {
  expected: number;
  excludedIds: ReadonlySet<string> | undefined;
  allowedIds: ReadonlySet<string> | undefined;
};
