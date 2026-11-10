export class MaterializeError extends Error {}

export interface MaterializedProduct {
  id: string | number;
  shapes: Record<string, number[][][]>;
  [key: string]: unknown;
}

export interface MaterializePlan {
  key: string;
  kind: 'a' | 'l';
  cacheDir: string;
  count: number;
  catalogued: number;
  excludedIds: Set<string>;
  footprintIds: Set<string>;
  validated: unknown;
  bytes: Buffer;
  pageSha256: string;
  pageBytes: number;
  dir: string;
  target: string;
  manifestFile: string;
  coverageSha256: string;
  metadataSha256: string;
  products: MaterializedProduct[];
  report: { problems: string[]; distinct: number };
}

/** Pannes injectables, pour les tests seulement. */
export interface CommitFs {
  linkSync?: (existing: string, target: string) => void;
  writeSync?: (...args: unknown[]) => number;
  [name: string]: unknown;
}

export function shapesProblem(
  product: { shapes?: Record<string, unknown> },
  kind?: string
): string | null;
export function planReconciledPage(options: {
  cacheDir: string;
  key: string;
}): MaterializePlan;
export function commitPage(
  plan: MaterializePlan,
  options?: { fs?: CommitFs; cacheDir?: string }
): { target: string; sha256: string; bytes: number };
export function parseArgs(argv: string[]): {
  cacheDir: string;
  key: string;
  write: boolean;
};
export function run(argv: string[]): {
  report: Record<string, unknown>;
  published: { target: string; sha256: string; bytes: number } | null;
};
