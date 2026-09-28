/**
 * REGISTRE DES VISITES GUIDÉES : une fiche JSON par visite (`./*.json`), l'ordre du sélecteur dans
 * `order.json`, la conversion PURE ci-dessous.
 *
 * Ce module est le seul à faire de l'entrée/sortie ; `config/tourScripts.ts` est la façade que
 * l'application lit. Ajouter une visite est donc une fiche de plus et une ligne dans `order.json`,
 * sans toucher une ligne de TypeScript — c'est le contrat du lot 21, et il est vérifié par une
 * quatrième visite ajoutée exactement comme ça.
 */
import type { TourScript, TourStep } from '@/core/tourEngine';
import type { TourRecord, TourStepRecord } from '../schema/tour';
import { decode } from '../load';
import orderFile from './order.json';

/** Toutes les fiches, sans `order.json`. */
export const TOUR_RECORDS: readonly TourRecord[] = Object.values(
  import.meta.glob(['./*.json', '!./order.json'], {
    eager: true,
    import: 'default',
  })
) as TourRecord[];

/** L'ordre du sélecteur de visites, et le seul propriétaire de cet ordre. */
export const TOUR_ORDER: readonly string[] = orderFile.order;

function toStep(step: TourStepRecord, where: string): TourStep {
  switch (step.kind) {
    case 'flyTo':
      return { kind: 'flyTo', body: step.body };
    case 'jumpToDate':
      // Même forme déclarée que partout dans le registre : `{"$date": "…Z"}`, décodée par le
      // chargeur commun plutôt que par un `new Date` recopié ici.
      return {
        kind: 'jumpToDate',
        date: decode(step.date, `${where}.date`) as Date,
      };
    case 'jumpToEvent':
      return step.body === undefined
        ? { kind: 'jumpToEvent', event: step.event }
        : { kind: 'jumpToEvent', event: step.event, body: step.body };
    case 'setTimeScale':
      return { kind: 'setTimeScale', scale: step.scale };
    case 'caption':
      return step.durationMs === undefined
        ? { kind: 'caption', text: step.text }
        : { kind: 'caption', text: step.text, durationMs: step.durationMs };
    case 'wait':
      return { kind: 'wait', ms: step.ms };
  }
}

/**
 * Les visites dans l'ordre déclaré. Refuse un ordre qui ne recouvre pas exactement les fiches :
 * une fiche oubliée dans `order.json` serait une visite invisible, et un identifiant en trop une
 * entrée de sélecteur qui ne lance rien.
 */
export function loadTours(
  records: readonly TourRecord[],
  order: readonly string[]
): TourScript[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (
    byId.size !== records.length ||
    order.length !== records.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !byId.has(id))
  )
    throw new Error('registre des visites : ordre, doublon ou fiche manquante');
  return order.map((id) => {
    const record = byId.get(id)!;
    return {
      id: record.id,
      title: record.title,
      steps: record.steps.map((step, index) =>
        toStep(step, `tours/${id}.steps[${index}]`)
      ),
    };
  });
}

export const loadTourScripts = (): TourScript[] =>
  loadTours(TOUR_RECORDS, TOUR_ORDER);
