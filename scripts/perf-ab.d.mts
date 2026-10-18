/**
 * Déclarations de `perf-ab.mjs`, pour que `src/config/perfAb.test.ts` en confronte le calcul sous
 * types. Écrit à la main, comme `check-production.d.mts`.
 */
export interface PerfRun {
  steady: { frames: { p50Ms: number }; driver: { total: number } | null };
  approach: { longTasks: { totalMs: number } };
}
export const METRICS: Record<string, (r: PerfRun) => number>;
export function median(values: number[]): number;
export function compare(
  samples: Record<string, { a: PerfRun[]; b: PerfRun[] }>
): Record<string, Record<string, { a: number; b: number; ratio: number }>>;
export const THRESHOLDS: Record<string, number>;
export function verdict(
  name: string,
  ratio: number
): 'regression' | 'gain' | 'noise' | 'unmeasured';
export function regressions(
  ratios: Record<string, Record<string, { verdict: string }>>
): string[];
