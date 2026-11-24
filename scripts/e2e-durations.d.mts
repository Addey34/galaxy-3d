/** Déclarations de `scripts/e2e-durations.mjs`, pour les tests TypeScript de `src/config/`. */

export const REFERENCE_CPU: string;

export interface Observation {
  file: string;
  cpu: string;
  seconds: number;
}

export function fileSeconds(lines: readonly string[]): Record<string, number>;

export function isMeasurableJob(job: {
  shard: number | null;
  conclusion: string | null;
}): boolean;

export function cpuKey(model: string | undefined): string;

export function cpuFactors(
  observations: readonly Observation[],
  reference?: string
): Record<string, number>;

export function normalisedSeconds(
  observations: readonly Observation[],
  factors: Readonly<Record<string, number>>
): Record<string, number>;

export interface StaleEntry {
  file: string;
  seconds: number;
  before?: number;
}

/** Ce que la répartition enregistrée ne dit plus juste, d'après des durées mesurées normalisées. */
export function staleEntries(
  measured: Readonly<Record<string, number>>,
  recorded: Readonly<Record<string, number>>,
  estimated?: readonly string[]
): { unmeasured: StaleEntry[]; estimated: StaleEntry[]; moved: StaleEntry[] };
