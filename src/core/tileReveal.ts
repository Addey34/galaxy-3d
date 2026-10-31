/**
 * LA RÉVÉLATION GROUPÉE DES CARREAUX (2026-10-30).
 *
 * Les carreaux d'un même niveau arrivent étalés dans le temps (mesuré sur Mercure à 1,05 rayon :
 * 63 à 79 carreaux sur 3,4 à 4,7 s, `requestfinished` des requêtes Trek). Chacun se fondait dès
 * qu'il était décodé, donc la surface se couvrait par îlots qui poussent un à un, sur la texture
 * de base de netteté différente. Un carreau retenu reste à l'opacité 0 jusqu'à ce que l'ensemble
 * voulu soit là ; tous se fondent alors ENSEMBLE, du même instant.
 *
 * La rétention ne doit jamais bloquer la descente : au bout de `REVEAL_MAX_WAIT_MS` ce qui est
 * arrivé se montre, même s'il en manque (service lent, carreau en échec). Le plafond était de
 * 1,5 s (2026-10-30), plus court que l'arrivée d'un groupe mesurée à 3,4 à 4,7 s : la révélation
 * partielle se déclenchait presque toujours, et des îlots poussaient un à un dans le champ.
 * Il vaut 8 s depuis le 2026-10-31 (immersion d'abord) ; une panne totale libère déjà le groupe
 * sans attendre (`inFlight === 0`). NON réglé sur téléphone ni GPU réel. Piloté par le TEMPS,
 * comme le fondu (`core/tileFade.ts`) : en rendu logiciel une image dure plusieurs secondes.
 */

/** Attente maximale d'un groupe de carreaux retenus, en millisecondes. */
export const REVEAL_MAX_WAIT_MS = 8000;

export interface RevealState {
  /** Instant (ms) où le premier carreau du groupe a été retenu. */
  heldSinceMs: number;
  nowMs: number;
  /** Carreaux voulus qui ne sont pas encore posés. */
  missing: number;
  /** Carreaux en vol ou en file : plus rien à attendre quand il n'y en a plus. */
  inFlight: number;
}

/** Faut-il montrer le groupe retenu ? */
export function shouldReveal(state: RevealState): boolean {
  return (
    state.missing === 0 ||
    state.inFlight === 0 ||
    state.nowMs - state.heldSinceMs >= REVEAL_MAX_WAIT_MS
  );
}
