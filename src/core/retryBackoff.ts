/**
 * Backoff exponentiel borné pour les fetch réseau des couches météo (imagerie GIBS,
 * données Open-Meteo…). Module PUR (pas de DOM/three/réseau, horloge injectée) →
 * unit-testable comme les autres modules `core/`.
 *
 * Motivation : sans frein, un fetch qui échoue et se réautorise à la frame suivante
 * (aggravé par le time-travel rapide) déclenche une cascade de gros fetch qui saturent
 * le thread réseau. On attend `retryAt` avant tout nouvel essai, délai doublé à chaque
 * échec (borné), réarmé au premier succès.
 *
 * L'horloge est passée en argument (`now`, typiquement `performance.now()`) plutôt que
 * lue en interne : l'appelant a déjà `now` sous la main dans sa boucle de frame, et ça
 * rend le module testable sans faux timers.
 */

export interface BackoffOptions {
  /** Délai initial (ms) après le premier échec. Défaut 15 000. */
  baseMs?: number;
  /** Délai maximal (ms) atteint par doublements successifs. Défaut 120 000. */
  maxMs?: number;
}

export interface Backoff {
  /** true si un nouvel essai est autorisé à l'instant `now` (aucun échec en attente). */
  shouldRetry(now: number): boolean;
  /** Enregistre un échec à `now` : bloque les essais jusqu'à `now + délai`, puis double le délai. */
  noteFailure(now: number): void;
  /** Réarme le backoff (à appeler au premier succès). */
  noteSuccess(): void;
}

/** Crée un contrôleur de backoff exponentiel borné. */
export function createBackoff(options: BackoffOptions = {}): Backoff {
  const baseMs = options.baseMs ?? 15_000;
  const maxMs = options.maxMs ?? 120_000;

  let retryAt = 0; // instant avant lequel tout essai est refusé
  let delayMs = baseMs; // délai courant, doublé à chaque échec

  return {
    shouldRetry(now: number): boolean {
      return now >= retryAt;
    },
    noteFailure(now: number): void {
      retryAt = now + delayMs;
      delayMs = Math.min(delayMs * 2, maxMs);
    },
    noteSuccess(): void {
      retryAt = 0;
      delayMs = baseMs;
    },
  };
}
