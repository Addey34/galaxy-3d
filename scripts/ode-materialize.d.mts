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
  rmSync?: (path: string, options?: { force?: boolean }) => void;
  writeSync?: (...args: unknown[]) => number;
  statSync?: (path: string, options?: { bigint?: boolean }) => unknown;
  readFileSync?: (path: string) => Buffer;
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
/** Ce que `commitPage` lit d'un plan : celui d'un jeu d'une page ou celui d'une fenêtre multipage. */
export type CommitPlan = Pick<
  MaterializePlan,
  | 'cacheDir'
  | 'count'
  | 'excludedIds'
  | 'footprintIds'
  | 'bytes'
  | 'pageSha256'
  | 'pageBytes'
  | 'dir'
  | 'target'
>;
export function commitPage(
  plan: CommitPlan,
  options?: { fs?: CommitFs; cacheDir?: string; allowSiblingPages?: boolean }
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
