/** Déclarations de `scripts/place-observations-publish.mjs`, pour les tests de `src/config/`. */

export const COVERED_BODIES: readonly string[];
export const MAX_PRODUCT_DROP: number;

export function assertCoveredBody(only: string | null | undefined): void;

export interface BodyResult {
  missingPages: number;
  extraPages: number;
  pageProblems?: readonly string[];
  products: number;
  observed: number;
  formations: number;
  shards: number;
  observedIds: readonly string[];
  shardOf: (id: string) => number;
}

export function verifyBodyResult(
  body: string,
  result: BodyResult,
  options: {
    previous?: { products: number } | undefined;
    featureIds: readonly number[];
    partial?: boolean;
    acceptDrop?: boolean;
  }
): void;

export function assertStagedBody(dir: string, shards: number): void;

export function publishStaged(options: {
  staging: string;
  outRoot: string;
  indexPath: string;
  indexText: string;
  bodies: readonly { body: string; shards: number }[];
  hooks?: { afterStep?: (label: string) => void };
}): void;

export function byteLength(text: string): number;

export function expectedOffsets(count: number, page: number): number[];

export function checkPageNames(
  files: readonly string[],
  count: number,
  page: number
): { missing: number[]; extra: string[]; misnamed: string[] };

export interface DatasetReport {
  missing: number[];
  extra: string[];
  misnamed: string[];
  catalogued: number;
  excluded: number;
  forbidden: string[];
  unreadable: string[];
  distinct: number;
  duplicates: number;
  problems: string[];
}

export function scanDataset(
  dir: string,
  count: number,
  page: number,
  onProduct?: (product: { id: string; [key: string]: unknown }) => void,
  reconciliation?: { excludedIds: ReadonlySet<string> } | null
): DatasetReport;

export function recoverPublish(
  staging: string
): 'none' | 'cleaned' | 'rolled-back';
