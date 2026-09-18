/**
 * REGISTRE DES ENTITÉS : une fiche JSON par corps (`./*.json`), l'ordre de premier niveau dans
 * `order.json`, le chargeur PUR dans `../load.ts`.
 *
 * Ce module est le seul à faire de l'entrée/sortie : le glob lit les fiches, `order.json` dit
 * dans quel ordre les poser. L'ordre des satellites, lui, est porté par chaque fiche parente.
 */
import { loadCatalogue, smallBodyElements, type EntityRecord } from '../load';
import orderFile from './order.json';

/** Toutes les fiches, sans `order.json`. */
export const ENTITY_RECORDS: readonly EntityRecord[] = Object.values(
  import.meta.glob(['./*.json', '!./order.json'], {
    eager: true,
    import: 'default',
  })
) as EntityRecord[];

/** Ordre de premier niveau : il pilote la navigation, le sitemap et les pages. */
export const ENTITY_ORDER: readonly string[] = orderFile.order;

/** Le catalogue tel que le produit le registre (textures non encore dérivées). */
export function loadEntityCatalogue() {
  return loadCatalogue(ENTITY_RECORDS, ENTITY_ORDER);
}

/** Les éléments publiés des petits corps, dans l'ordre du catalogue. */
export function loadSmallBodyElements() {
  return smallBodyElements(ENTITY_RECORDS, ENTITY_ORDER);
}
