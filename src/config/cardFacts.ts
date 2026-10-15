/**
 * LA PROVENANCE DES FAITS, chargée à la PREMIÈRE ouverture d'une fiche (lot 52, 2026-10-15).
 *
 * Source, méthode, citation, incertitude, détail, date et raison de chaque fait ne sont lus que
 * par la fiche (`core/bodyFacts.ts`). Ils pesaient 61 363 octets du démarrage ; le navigateur ne
 * reçoit plus que les valeurs, et ce module repose le reste depuis
 * `virtual:registry-text/card-facts` (règle dans `core/registryText.ts::deferFactProvenance`).
 *
 * Tant qu'elle n'est pas là, la fiche n'affiche AUCUN fait, et c'est voulu : `bodyFact` rendrait
 * chaque valeur « pas encore sourcée », une affirmation fausse à l'écran. `ui/bodyInfo.ts` lit
 * donc `factProvenancePending()` et marque sa liste occupée.
 *
 * En test et dans les pages générées, les fiches ne sont pas allégées : rien n'est en attente, et
 * `loadCardFacts` rend 0 sans rien demander.
 */
import { NAVIGABLE_BODIES } from './navigable';
import { ENTITY_RECORDS } from '@/registry/entities';
import { SPACECRAFT_RECORDS } from '@/registry/spacecraft';
import { INTERSTELLAR_RECORDS } from '@/registry/interstellar';
import { hydrateFactProvenance } from '@/registry/load';
import { FACTS_DEFERRED_FLAG } from '@/core/registryText';

const deferred = [
  ...ENTITY_RECORDS,
  ...SPACECRAFT_RECORDS,
  ...INTERSTELLAR_RECORDS,
].some((record) => (record as Record<string, unknown>)[FACTS_DEFERRED_FLAG]);

let hydrated = false;
let pending: Promise<number> | null = null;

/** Vrai tant que la provenance des faits n'est pas reposée sur les corps. */
export function factProvenancePending(): boolean {
  return deferred && !hydrated;
}

/**
 * Repose la provenance une fois, et rend le nombre de faits reposés. Idempotent ; un échec de
 * réseau n'est PAS retenu, pour que la prochaine ouverture de fiche réessaie.
 */
export function loadCardFacts(): Promise<number> {
  if (!factProvenancePending()) return Promise.resolve(0);
  if (pending) return pending;
  const run = import('virtual:registry-text/card-facts').then((module) => {
    const count = hydrateFactProvenance(
      NAVIGABLE_BODIES as ReadonlyMap<
        string,
        { realData?: Record<string, unknown> }
      >,
      module.default
    );
    hydrated = true;
    return count;
  });
  pending = run;
  run.catch(() => {
    pending = null;
  });
  return run;
}
