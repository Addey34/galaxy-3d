/** Entrée/sortie des fiches de sondes ; la conversion est pure et conserve l'ordre déclaré. */
import type { SpacecraftMission } from '@/config/spacecraft';
import type { SpacecraftRecord } from '../schema/spacecraft';
import { decode } from '../load';
import orderFile from './order.json';

export const SPACECRAFT_ORDER: readonly string[] = orderFile.order;

export const SPACECRAFT_RECORDS = Object.values(
  import.meta.glob(['./*.json', '!./order.json'], {
    eager: true,
    import: 'default',
  })
) as SpacecraftRecord[];

export function loadSpacecraft(
  records: readonly SpacecraftRecord[],
  order: readonly string[]
): SpacecraftMission[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (
    byId.size !== records.length ||
    order.length !== records.length ||
    order.some((id) => !byId.has(id))
  )
    throw new Error('registre des sondes : ordre, doublon ou fiche manquante');
  return order.map((id) => {
    const record = byId.get(id)!;
    return {
      name: record.id,
      displayName: record.displayName,
      description: record.description,
      launchDate: record.launchDate,
      color: decode(record.color, `spacecraft/${id}.color`, 'color') as number,
    };
  });
}

export const loadSpacecraftMissions = (): SpacecraftMission[] =>
  loadSpacecraft(SPACECRAFT_RECORDS, SPACECRAFT_ORDER);
