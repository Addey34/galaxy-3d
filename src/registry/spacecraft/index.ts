/** Entrée/sortie des fiches de sondes ; la conversion est pure et conserve l'ordre déclaré. */
import type { SpacecraftMission } from '@/config/spacecraft';
import type { RealData } from '@/types';
import type { SpacecraftRecord } from '../schema/spacecraft';
import { decode, spreadFacts } from '../load';
import orderFile from './order.json';

/**
 * Où va la VALEUR d'un fait de sonde. `launchDate` n'y figure pas : elle est déjà en tête de
 * fiche, et `spreadFacts` refuse alors une valeur répétée dans le fait — c'est la garde qui
 * empêche deux dates de lancement de diverger dans le même fichier.
 */
const SPACECRAFT_VALUE_FIELD = {
  massKg: 'massKg',
  launchVehicle: 'launchVehicle',
  launchSite: 'launchSite',
} as const;

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
    new Set(order).size !== order.length ||
    order.some((id) => !byId.has(id))
  )
    throw new Error('registre des sondes : ordre, doublon ou fiche manquante');
  return order.map((id) => {
    const record = byId.get(id)!;
    const facts: Partial<RealData> = { launchDate: record.launchDate };
    const { sources, unknown } = spreadFacts(
      record.facts ?? {},
      facts as Record<string, unknown>,
      SPACECRAFT_VALUE_FIELD,
      `spacecraft/${id}`
    );
    if (Object.keys(sources).length > 0) facts.sources = sources;
    if (Object.keys(unknown).length > 0) facts.unknown = unknown;
    return {
      name: record.id,
      displayName: record.displayName,
      description: record.description,
      launchDate: record.launchDate,
      color: decode(record.color, `spacecraft/${id}.color`, 'color') as number,
      facts,
      satelliteOf: (record.satelliteOf ?? []).map((phase) => ({
        body: phase.body,
        fromMs: Date.parse(phase.from),
        toMs: Date.parse(phase.to),
      })),
    };
  });
}

export const loadSpacecraftMissions = (): SpacecraftMission[] =>
  loadSpacecraft(SPACECRAFT_RECORDS, SPACECRAFT_ORDER);
