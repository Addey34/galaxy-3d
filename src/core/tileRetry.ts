/**
 * REPRISE DES CARREAUX EN ÉCHEC : un retard qui double, plafonné, jamais définitif.
 *
 * Un carreau dont le chargement échoue est redemandé, car un échec passager (limite de débit,
 * coupure) ne doit pas laisser un trou durable (#480). Mais un délai FIXE redemande à vie un
 * carreau que rien ne servira (hôte injoignable, jeu absent) : mesuré en CI, 16 carreaux de
 * Blue Marble redemandés 11 à 12 fois en 190 s, par rafales toutes les 10 à 12 s, ce qui
 * empêche la scène de jamais se calmer. Le retard double donc à chaque échec consécutif d'un même
 * carreau, jusqu'à un plafond : le débit de redemande tombe à une par minute et par carreau, et
 * le carreau reste récupérable (jamais de trou permanent).
 *
 * Fonctions pures : l'horloge est celle de l'appelant.
 */

/** Retard après le premier échec (ms). */
export const TILE_RETRY_BASE_MS = 8000;

/** Plafond du retard (ms) : une redemande par minute et par carreau au plus. */
export const TILE_RETRY_MAX_MS = 60_000;

/** Retard à attendre après `failures` échecs consécutifs (au moins un). */
export function tileRetryDelayMs(failures: number): number {
  const n = Number.isNaN(failures) ? 1 : Math.max(1, Math.floor(failures));
  // Au-delà de 20 doublements le plafond est de toute façon atteint ; l'exposant reste fini.
  return Math.min(
    TILE_RETRY_BASE_MS * 2 ** Math.min(n - 1, 20),
    TILE_RETRY_MAX_MS
  );
}

/** Un échec enregistré à `at` retient-il encore le carreau à l'instant `now` ? */
export function isTileRetryPending(
  at: number,
  failures: number,
  now: number
): boolean {
  return now - at < tileRetryDelayMs(failures);
}
