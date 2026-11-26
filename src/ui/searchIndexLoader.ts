/**
 * L'INDEX DE LA RECHERCHE UNIVERSELLE, lu une fois (lot 47) et partagé : la palette de recherche et la
 * fiche « Poursuivre l'observation » (GAL-OBSERVATION-001) lisent le MÊME fichier, par la MÊME requête.
 * Une panne n'est pas gardée : la lecture suivante réessaie.
 */
import type { SearchIndexFile } from '@/core/search';
import Logger from '@/utils/Logger';

/** Adresse ABSOLUE : une adresse relative résoudrait sous `/titan/` quand on démarre sur une page de corps. */
export const SEARCH_INDEX_URL = '/assets/search/index.json';

let file: Promise<SearchIndexFile | null> | null = null;

export function loadSearchIndex(): Promise<SearchIndexFile | null> {
  file ??= fetch(SEARCH_INDEX_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SearchIndexFile>;
    })
    .catch((error: unknown) => {
      file = null;
      Logger.warn(`[Recherche] index indisponible : ${String(error)}`);
      return null;
    });
  return file;
}
