/**
 * L'INTENTION DU REPÈRE D'UNE PLONGÉE (GAL-IMMERSION-002) : machine d'états pure, sans DOM, qui
 * décide si un repère DOIT être posé. Elle sépare trois choses que l'état « lieu déjà demandé »
 * confondait :
 *  - un ÉCHEC de chargement (`failed`) : la plongée rejouée a le droit de retenter ;
 *  - un ABANDON explicite (`abandoned` : Échap, geste) : plus rien ne se pose sans une nouvelle
 *    demande, même si le chargement avait d'abord échoué ;
 *  - une demande NEUVE (`request(key, false)`) : elle prend toujours la main sur la précédente.
 * Chaque tentative reçoit un jeton ; seul le jeton courant peut poser ou déclarer un échec, de
 * sorte qu'une réponse tardive d'une ancienne demande (même lieu compris) ne touche à rien.
 */
export type MarkerStatus =
  'idle' | 'pending' | 'posed' | 'failed' | 'abandoned';

export interface MarkerIntent {
  /**
   * Ouvre une tentative et rend son jeton, ou `null` si aucune n'est permise : une relance n'en
   * ouvre que pour le MÊME lieu après un échec ; une demande neuve n'en ouvre pas quand le repère
   * de ce lieu est déjà à l'écran (`alreadyShown`).
   */
  request(key: string, replay: boolean, alreadyShown: boolean): number | null;
  /** Vrai si ce jeton est encore le courant : le repère peut alors être posé. */
  resolved(token: number): boolean;
  /** Un chargement refusé : ouvre la voie à une relance, seulement pour le jeton courant. */
  rejected(token: number): void;
  /** Échap, geste, changement de cible : plus rien ne se pose sans nouvelle demande. */
  abandon(): void;
  status(): MarkerStatus;
}

export function createMarkerIntent(): MarkerIntent {
  let token = 0;
  let key = '';
  let status: MarkerStatus = 'idle';
  return {
    request(next, replay, alreadyShown) {
      if (replay) {
        if (next !== key || status !== 'failed') return null;
      } else if (next === key && status === 'posed' && alreadyShown) {
        return null;
      }
      token += 1;
      key = next;
      status = 'pending';
      return token;
    },
    resolved(candidate) {
      if (candidate !== token || status !== 'pending') return false;
      status = 'posed';
      return true;
    },
    rejected(candidate) {
      if (candidate === token && status === 'pending') status = 'failed';
    },
    abandon() {
      token += 1;
      if (status !== 'idle') status = 'abandoned';
    },
    status: () => status,
  };
}
