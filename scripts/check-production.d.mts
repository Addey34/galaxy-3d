/**
 * Déclarations de `check-production.mjs`, pour que `src/config/productionHealth.test.ts` en
 * confronte les juges SOUS TYPES. Écrit à la main, comme `check-source-health.d.mts` : une
 * déclaration qui dériverait de l'implémentation ferait rougir la garde.
 */

export interface Verdict {
  ok: boolean;
  detail: string;
}

export interface ServedResponse {
  status: number;
  contentType: string | null;
  headers?: Record<string, string>;
  body: string;
}

export const PLACE_NAME: string;
export function canonicalOf(html: string): string | null;
export function sitemapSamples(xml: string): {
  count: number;
  samples: { family: string; path: string }[];
};
export function judgePage(
  path: string,
  response: ServedResponse,
  shell: ServedResponse
): Verdict;
export function judgeShell(response: ServedResponse): Verdict;
export function expectedHeaders(
  firebase: unknown,
  path: string
): Record<string, string>;
export function judgeHeaders(
  expected: Record<string, string>,
  served: Record<string, string>
): Verdict;
export function judgeConsole(errors: string[]): Verdict;
