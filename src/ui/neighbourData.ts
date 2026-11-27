/**
 * LES ÉTOILES VOISINES, LUES CHEZ LEURS DEUX FOURNISSEURS (GAL-UNIVERSE-008, séparation des données).
 * HYG v4.4 (CC BY-SA 4.0) et Gaia DR3 (CC BY-NC 3.0 IGO) sont livrés dans deux fichiers distincts, chacun
 * avec sa licence ; le rapprochement se fait ici, à l'exécution (`core/neighbours`, `combineNeighbours`).
 *
 * HYG est le fournisseur de la liste (les étoiles, leurs noms) : sans lui, pas de voisinage, et l'appelant
 * le dit comme avant. Gaia affine distance et mouvement : un refus ou une absence n'empêche rien, chaque
 * étoile garde alors la ligne de HYG (sauf un mouvement propre plafonné par HYG, écarté, comme le fait
 * le générateur). Une seule lecture par page : les trois vues qui en ont besoin partagent la promesse.
 */
import Logger from '@/utils/Logger';
import {
  combineNeighbours,
  type NeighbourFile,
  type NeighbourGaiaFile,
  type NeighbourHygFile,
} from '@/core/neighbours';

export const NEIGHBOUR_FILES = {
  hyg: '/assets/sky/neighbours/hyg-v44.json',
  gaia: '/assets/sky/neighbours/gaia-dr3.json',
} as const;

const readJson = async <T>(
  fetchImpl: typeof fetch,
  url: string
): Promise<T> => {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
};

const shared = new WeakMap<typeof fetch, Promise<NeighbourFile>>();

/** Le voisinage rapproché ; rejette si HYG est illisible ou vide (Gaia seul ne fait pas une liste). */
export function loadNeighbours(
  fetchImpl: typeof fetch = fetch
): Promise<NeighbourFile> {
  const known = shared.get(fetchImpl);
  if (known) return known;
  const request = (async () => {
    const [hyg, gaia] = await Promise.all([
      readJson<NeighbourHygFile>(fetchImpl, NEIGHBOUR_FILES.hyg),
      readJson<NeighbourGaiaFile>(fetchImpl, NEIGHBOUR_FILES.gaia).catch(
        (error: unknown) => {
          Logger.warn(
            '[neighbours] Gaia DR3 illisible : lignes de HYG seules',
            error
          );
          return null;
        }
      ),
    ]);
    if (!Array.isArray(hyg.stars) || hyg.stars.length === 0)
      throw new Error('fichier HYG vide');
    return combineNeighbours(hyg, gaia);
  })();
  shared.set(fetchImpl, request);
  // Un refus n'est pas retenu : la prochaine demande relit.
  request.catch(() => shared.delete(fetchImpl));
  return request;
}
