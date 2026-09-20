/** Entrée/sortie des fiches interstellaires ; conversion pure des formes déclarées. */
import type { InterstellarObject } from '@/config/interstellar';
import type { RealData } from '@/types';
import type { InterstellarRecord } from '../schema/interstellar';
import { decode, spreadFacts } from '../load';
import orderFile from './order.json';

/**
 * Où va la VALEUR d'un fait interstellaire. Ni l'excentricité ni la périhélie n'y figurent :
 * la première EST un élément de la fiche, la seconde s'en dérive (q = a(1 − e)). Les répéter
 * dans le fait aurait créé deux vérités pour un même nombre.
 */
const INTERSTELLAR_VALUE_FIELD = {
  firstObservation: 'firstObservation',
} as const;

export const INTERSTELLAR_ORDER: readonly string[] = orderFile.order;
export const INTERSTELLAR_RECORDS = Object.values(
  import.meta.glob(['./*.json', '!./order.json'], {
    eager: true,
    import: 'default',
  })
) as InterstellarRecord[];

export function loadInterstellar(
  records: readonly InterstellarRecord[],
  order: readonly string[]
): InterstellarObject[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (
    byId.size !== records.length ||
    order.length !== records.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !byId.has(id))
  )
    throw new Error(
      'registre interstellaire : ordre, doublon ou fiche manquante'
    );
  return order.map((id) => {
    const record = byId.get(id)!;
    const e = record.elements;
    // q = a(1 − e) : sur une hyperbole a est négatif et (1 − e) aussi, la périhélie est donc
    // bien positive. C'est la seule grandeur affichée qui ne soit pas écrite dans la fiche.
    const facts: Partial<RealData> = {
      eccentricity: e.eccentricity,
      perihelionAU: e.semiMajorAxisAU * (1 - e.eccentricity),
    };
    const { sources, unknown } = spreadFacts(
      record.facts ?? {},
      facts as Record<string, unknown>,
      INTERSTELLAR_VALUE_FIELD,
      `interstellar/${id}`
    );
    if (Object.keys(sources).length > 0) facts.sources = sources;
    if (Object.keys(unknown).length > 0) facts.unknown = unknown;
    return {
      name: record.id,
      displayName: record.displayName,
      designation: record.designation,
      elements: {
        semiMajorAxisAU: e.semiMajorAxisAU,
        eccentricity: e.eccentricity,
        inclinationRad: decode(
          e.inclinationRad,
          `${id}.inclinationRad`
        ) as number,
        ascendingNodeRad: decode(
          e.ascendingNodeRad,
          `${id}.ascendingNodeRad`
        ) as number,
        argPerihelionRad: decode(
          e.argPerihelionRad,
          `${id}.argPerihelionRad`
        ) as number,
        meanAnomalyAtEpochRad: decode(
          e.meanAnomalyAtEpochRad,
          `${id}.meanAnomalyAtEpochRad`
        ) as number,
        epoch: decode(e.epoch, `${id}.epoch`) as Date,
      },
      color: decode(record.color, `${id}.color`, 'color') as number,
      facts,
    };
  });
}

export const loadInterstellarObjects = (): InterstellarObject[] =>
  loadInterstellar(INTERSTELLAR_RECORDS, INTERSTELLAR_ORDER);
