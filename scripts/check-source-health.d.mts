/**
 * Déclarations de `check-source-health.mjs`, pour que `src/config/sourceHealth.test.ts` le
 * confronte SOUS TYPES plutôt qu'en `any`.
 *
 * Écrit à la main, et c'est voulu, pour la même raison que `check-ci-health.d.mts` : le script
 * doit tourner avec un `node` nu, sans dépendance ni serveur Vite, parce que le workflow qui le
 * joue ne fait pas d'installation. Une déclaration qui dériverait de l'implémentation ferait
 * rougir la garde, qui appelle ces fonctions sur des fragments de réponses RÉELLES.
 */

/** Ce qu'une réponse doit contenir pour que la source soit dite vivante. */
export interface MarkerRule {
  /** Préfixe d'URL auquel cette règle s'applique ; le premier qui correspond gagne. */
  prefix: string;
  /** Le marqueur attendu, parfois DÉRIVÉ de l'URL (arXiv, NASA Science). */
  marker: (url: string) => string;
  /** Ce que la source est, en clair, pour le message. */
  what: string;
}

export const MARKER_RULES: readonly MarkerRule[];

export function markerFor(url: string): MarkerRule | undefined;

export type SourceVerdict =
  'vivante' | 'muette' | 'détournée' | 'non-mesurée' | 'sans-marqueur';

export interface SourceResult {
  url: string;
  verdict: SourceVerdict;
  what?: string;
  status?: number;
  bytes?: number;
  expected?: string;
  /** L'adresse où le client a ATTERRI, quand ce n'est pas celle demandée. */
  finalUrl?: string;
  detail?: string;
}

/** Le verdict d'une réponse, sans réseau : la partie qui se teste. */
export function judgeResponse(input: {
  url: string;
  finalUrl?: string;
  body: string;
  status?: number;
}): SourceResult;

/** Le code de sortie que ces résultats commandent. Un seul endroit décide. */
export function exitCodeFor(results: readonly SourceResult[]): number;

/** La liste des sources, DÉRIVÉE du relevé livré et des fiches de jeux de tuiles. */
export function derivedSources(): string[];
