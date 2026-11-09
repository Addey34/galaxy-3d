/** Déclarations de `scripts/place-observations-publish.mjs`, pour les tests de `src/config/`. */

export const COVERED_BODIES: readonly string[];
export const MAX_PRODUCT_DROP: number;

export function assertCoveredBody(only: string | null | undefined): void;

export interface BodyResult {
  missingPages: number;
  extraPages: number;
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
