/** Déclarations de `scripts/e2e-shard.mjs`, pour les tests TypeScript de `src/config/`. */

export const DURATIONS_PATH: string;

export interface Shard {
  files: string[];
  seconds: number;
}

export function e2eSpecFiles(root?: string): string[];

export function assignShards(
  files: readonly string[],
  seconds: Readonly<Record<string, number>>,
  total: number
): Shard[];

/** Les specs sans durée enregistrée (mesurée ou estimée). */
export function unmeasuredFiles(
  files: readonly string[],
  seconds: Readonly<Record<string, number>>
): string[];

export function readDurations(path?: string): {
  unit: string;
  runs: number[];
  cpuFactors: Record<string, number>;
  seconds: Record<string, number>;
  /** Les entrées qui ne sont qu'une estimation, à remplacer par une mesure. */
  estimated?: string[];
};
