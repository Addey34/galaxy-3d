/**
 * Déclarations de `check-ci-health.mjs`, pour que `src/config/ciHealth.test.ts` le confronte
 * SOUS TYPES plutôt qu'en `any`.
 *
 * Ce fichier est écrit à la main, et c'est voulu : le script doit tourner avec un `node` nu,
 * sans dépendance ni serveur Vite, parce que `.github/workflows/main-ci-watch.yml` ne fait pas
 * d'installation. Il ne peut donc pas vivre en TypeScript dans `src/` comme `src/inventory/`,
 * que `scripts/inventory-gaps.mjs` charge par `ssrLoadModule`.
 *
 * Une déclaration qui dériverait de l'implémentation ferait rougir la garde : le test appelle
 * ces fonctions et compare leurs résultats à des journaux réels.
 */

export const E2E_ENVELOPE_MINUTES: number;
export const E2E_WARN_FRACTION: number;

/** Le résumé d'une suite Playwright, lu dans le bloc final du rapporteur `list`. */
export interface PlaywrightSummary {
  passed: number | null;
  totalMinutes: number | null;
  failed: string[];
  flaky: string[];
  timedOut: string[];
  interrupted: string[];
  /** Renseigné quand le journal n'a pas pu être lu. */
  unreadable?: string;
}

/** Un job du run, tel que le script le retient. */
export interface InspectedJob {
  id: number;
  name: string;
  conclusion: string;
  minutes: number | null;
  shard: number | null;
  summary: PlaywrightSummary | null;
}

export interface Verdict {
  healthy: boolean;
  red: { job: string; test?: string; conclusion: string }[];
  retried: { job: string; test: string }[];
  full: { job: string; minutes: number }[];
  unreadable: { job: string; reason: string }[];
}

export function logLines(raw: string): string[];
export function parsePlaywrightSummary(lines: string[]): PlaywrightSummary;
export function judge(run: { jobs: InspectedJob[] }): Verdict;
export function inspectRun(
  runId: string | number,
  options?: { readLogs?: boolean }
): {
  id: number;
  title: string;
  sha: string;
  conclusion: string;
  attempt: number;
  url: string;
  createdAt: string;
  jobs: InspectedJob[];
};
