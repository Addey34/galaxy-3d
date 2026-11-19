/**
 * LE DERNIER GESTE GAGNE (GAL-TOUR-SCALE-001) : un chargement différé que l'utilisateur peut
 * remplacer, annuler ou voir échouer, sans qu'une résolution tardive ne fasse rien d'obsolète.
 *
 * `request(id)` prend une intention numérotée. Quand le chargement se résout, il ne rend `ready`
 * que si c'est toujours la dernière : sinon `stale`, et l'appelant ne démarre rien. `cancel()`
 * (fermeture de l'interface, changement d'intention) invalide d'un coup toute demande en vol.
 *
 * Rien n'est mis en cache ici : un refus (`failed`) n'est pas mémorisé, le prochain `request`
 * relance `load`. Le cache des modules réussis est celui du navigateur. Pur et sans DOM, donc
 * testé sans navigateur (`intentLoader.test.ts`) ; le patron est celui du morceau de l'inspecteur
 * météo (`e2e/weatherInspector.spec.ts`, « dernier geste »).
 */
export type IntentResult<T> =
  | { readonly status: 'ready'; readonly value: T }
  /** `load` a répondu `null` : l'identifiant ne désigne rien. */
  | { readonly status: 'unknown' }
  /** Une autre demande, ou une annulation, est passée depuis : ne rien faire de ce résultat. */
  | { readonly status: 'stale' }
  | { readonly status: 'failed'; readonly error: unknown };

export interface IntentLoader<T> {
  request(id: string): Promise<IntentResult<T>>;
  cancel(): void;
}

export function createIntentLoader<T>(
  load: (id: string) => Promise<T | null>
): IntentLoader<T> {
  let intent = 0;
  return {
    async request(id) {
      const mine = ++intent;
      let value: T | null;
      try {
        value = await load(id);
      } catch (error) {
        return mine === intent
          ? { status: 'failed', error }
          : { status: 'stale' };
      }
      if (mine !== intent) return { status: 'stale' };
      return value === null
        ? { status: 'unknown' }
        : { status: 'ready', value };
    },
    cancel() {
      intent++;
    },
  };
}
