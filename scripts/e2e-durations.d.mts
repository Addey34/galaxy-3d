/** Déclarations de `scripts/e2e-durations.mjs`, pour les tests TypeScript de `src/config/`. */

export const REFERENCE_CPU: string;

export interface Observation {
  file: string;
  cpu: string;
  seconds: number;
}

export function fileSeconds(lines: readonly string[]): Record<string, number>;

export function cpuKey(model: string | undefined): string;

export function cpuFactors(
  observations: readonly Observation[],
  reference?: string
): Record<string, number>;

export function normalisedSeconds(
  observations: readonly Observation[],
  factors: Readonly<Record<string, number>>
): Record<string, number>;
