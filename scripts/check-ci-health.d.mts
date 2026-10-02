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

/** L'étape dont la durée est l'enveloppe (ligne 44.2). */
export const E2E_TEST_STEP: string;
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
export interface RunnerCpu {
  model: string;
  cores: number;
}

export interface InspectedJob {
  id: number;
  name: string;
  conclusion: string;
  minutes: number | null;
  shard: number | null;
  summary: PlaywrightSummary | null;
  /** Processeur de la machine du shard (ligne 44.3) ; absent avant l'étape « Runner CPU ». */
  cpu?: RunnerCpu | null;
}

/** Le run qui a remplacé celui-ci, quand `cancel-in-progress` l'a annulé. */
export interface SupersedingRun {
  id: number;
  number: number;
  url: string;
}

export interface Verdict {
  healthy: boolean;
  /**
   * Le run a été REMPLACÉ, pas cassé : `cancel-in-progress` l'a annulé au profit d'un run plus
   * récent, et aucun job n'a échoué. Il est alors `healthy`, parce qu'un guetteur qui crie au
   * loup finit ignoré, et c'est le run suivant qui fait foi.
   */
  superseded: boolean;
  red: { job: string; test?: string; conclusion: string }[];
  retried: { job: string; test: string }[];
  full: { job: string; minutes: number }[];
  unreadable: { job: string; reason: string }[];
}

export function logLines(raw: string): string[];
export function parsePlaywrightSummary(lines: string[]): PlaywrightSummary;
export const RUNNER_CPU_LINE: RegExp;
export function parseRunnerCpu(lines: string[]): RunnerCpu | null;
export function judge(run: {
  jobs: InspectedJob[];
  supersededBy?: SupersedingRun | null;
}): Verdict;
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
  supersededBy: SupersedingRun | null;
  jobs: InspectedJob[];
};
