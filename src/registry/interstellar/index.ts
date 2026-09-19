/** Entrée/sortie des fiches interstellaires ; conversion pure des formes déclarées. */
import type { InterstellarObject } from '@/config/interstellar';
import type { InterstellarRecord } from '../schema/interstellar';
import { decode } from '../load';
import orderFile from './order.json';

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
    order.some((id) => !byId.has(id))
  )
    throw new Error(
      'registre interstellaire : ordre, doublon ou fiche manquante'
    );
  return order.map((id) => {
    const record = byId.get(id)!;
    const e = record.elements;
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
    };
  });
}

export const loadInterstellarObjects = (): InterstellarObject[] =>
  loadInterstellar(INTERSTELLAR_RECORDS, INTERSTELLAR_ORDER);
