/**
 * REGISTRE DES VISITES GUIDÉES : une fiche JSON par visite (`./*.json`), l'ordre du sélecteur dans
 * `order.json`, la conversion PURE ci-dessous.
 *
 * Ce module est PUR et ne lit aucune fiche : il ne fait donc entrer aucun texte de visite dans
 * les morceaux qui l'importent (GAL-TOUR-SCALE-001). Les trois façons de lire les fiches vivent à
 * côté, chacune pour son usage :
 *   - `all.ts`       : TOUTES les fiches, `eager`, pour le build et les tests ;
 *   - `lazy.ts`      : UNE fiche à la demande, ce que le navigateur télécharge à l'ouverture ;
 *   - `catalogue.ts` : les identifiants et titres, dérivés au build, pour le sélecteur.
 * Ajouter une visite est donc une fiche de plus et une ligne dans `order.json`, sans toucher une
 * ligne de TypeScript — c'est le contrat du lot 21, et il tient toujours.
 */
import type { TourScript, TourStep } from '@/core/tourEngine';
import type { TourRecord, TourStepRecord } from '../schema/tour';
import { decode } from '../load';
import orderFile from './order.json';
import { orderTourRecords } from './catalogue';

/** L'ordre du sélecteur de visites, et le seul propriétaire de cet ordre. */
export const TOUR_ORDER: readonly string[] = orderFile.order;

function toStep(step: TourStepRecord, where: string): TourStep {
  switch (step.kind) {
    case 'flyTo':
      return {
        kind: 'flyTo',
        body: step.body,
        ...(step.from !== undefined ? { from: step.from } : {}),
        ...(step.side !== undefined && step.from === undefined
          ? { side: step.side }
          : {}),
        ...(step.distanceRadii !== undefined
          ? { distanceRadii: step.distanceRadii }
          : {}),
      };
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
    case 'setMode':
      return { kind: 'setMode', mode: step.mode };
    case 'diveTo':
      return step.frameKm === undefined
        ? { kind: 'diveTo', place: step.place }
        : { kind: 'diveTo', place: step.place, frameKm: step.frameKm };
    case 'setSurface':
      return { kind: 'setSurface', base: step.base };
    case 'caption':
      return step.durationMs === undefined
        ? { kind: 'caption', text: step.text }
        : { kind: 'caption', text: step.text, durationMs: step.durationMs };
    case 'wait':
      return { kind: 'wait', ms: step.ms };
  }
}

/** Une fiche convertie en script exécutable. */
export function toTourScript(record: TourRecord): TourScript {
  return {
    id: record.id,
    title: record.title,
    steps: record.steps.map((step, index) =>
      toStep(step, `tours/${record.id}.steps[${index}]`)
    ),
  };
}

/** Les visites dans l'ordre déclaré (refus d'un ordre qui ne recouvre pas les fiches). */
export function loadTours(
  records: readonly TourRecord[],
  order: readonly string[]
): TourScript[] {
  return orderTourRecords(records, order).map(toTourScript);
}
