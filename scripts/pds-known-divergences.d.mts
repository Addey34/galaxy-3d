/**
 * Déclarations de `pds-known-divergences.mjs`, pour que `src/config/pdsKnownDivergences.test.ts`
 * le confronte sous types (même raison que `fact-source-cache.d.mts`).
 */
export interface DivergentRow {
  lid: string;
  name: string;
  start: string | null;
  end: string | null;
  refs: string[];
}

export function resolveKnownDivergence(
  a: DivergentRow,
  b: DivergentRow
): DivergentRow | null;
