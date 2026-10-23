/**
 * Déclarations de `check-data-drift.mjs`, pour que `src/config/dataDrift.test.ts` le confronte
 * sous types (même raison que `check-ci-health.d.mts`).
 */
export interface DriftGenerator {
  id: string;
  script: string;
  about: string;
}

export const DRIFT_GENERATORS: DriftGenerator[];

export function classify(
  code: number | null,
  output: string
): 'ok' | 'drift' | 'unmeasured';

export function excerpt(output: string, lines?: number): string;
