/**
 * REGISTRE DES ACTIVITÉS PÉDAGOGIQUES (lot 58) : une fiche JSON par activité (`./*.json`), l'ordre
 * de publication dans `order.json`. Même patron que le registre des visites : ce module ne fait
 * que lire, le schéma (`../schema/activity.ts`) valide dans les tests, et aucun `.ts` ne change
 * quand une activité s'ajoute.
 *
 * Seul le build le lit (`seo/activityPages.ts`) : une activité est une FICHE IMPRIMABLE, et ce
 * que l'élève joue dans la scène est la visite qu'elle nomme (`?tour=`).
 */
import type { ActivityRecord } from '../schema/activity';
import orderFile from './order.json';

export const ACTIVITY_RECORDS: readonly ActivityRecord[] = Object.values(
  import.meta.glob(['./*.json', '!./order.json'], {
    eager: true,
    import: 'default',
  })
) as ActivityRecord[];

export const ACTIVITY_ORDER: readonly string[] = orderFile.order;

/**
 * Les activités dans l'ordre déclaré. Refuse un ordre qui ne recouvre pas exactement les fiches,
 * et une activité dont la visite n'existe pas : la fiche imprimée renverrait vers une scène qui
 * ne lance rien.
 */
export function loadActivities(
  records: readonly ActivityRecord[],
  order: readonly string[],
  tourIds: readonly string[]
): ActivityRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (
    byId.size !== records.length ||
    order.length !== records.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !byId.has(id))
  )
    throw new Error(
      'registre des activités : ordre, doublon ou fiche manquante'
    );
  return order.map((id) => {
    const record = byId.get(id)!;
    if (!tourIds.includes(record.tour))
      throw new Error(
        `activité « ${id} » : visite « ${record.tour} » inconnue`
      );
    return record;
  });
}
