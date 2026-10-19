/**
 * REGISTRE DES PRÉRÉGLAGES D'AFFICHAGE (lot 59) : une fiche JSON par préréglage (`./*.json`),
 * l'ordre du sélecteur dans `order.json`. Même patron que les visites : un préréglage de plus est
 * une fiche et une ligne d'ordre, sans une ligne de TypeScript.
 *
 * L'application lit ce module à l'ouverture du tableau Réglages (`ui/orbitOptions.ts`) ; la
 * RÈGLE qui applique un écart est pure et vit dans `core/displayPreset.ts`.
 */
import type { PresetRecord } from '../schema/preset';
import orderFile from './order.json';

export const PRESET_RECORDS: readonly PresetRecord[] = Object.values(
  import.meta.glob(['./*.json', '!./order.json'], {
    eager: true,
    import: 'default',
  })
) as PresetRecord[];

/** L'ordre du sélecteur, et le seul propriétaire de cet ordre. */
export const PRESET_ORDER: readonly string[] = orderFile.order;

/**
 * Les préréglages dans l'ordre déclaré. Refuse un ordre qui ne recouvre pas exactement les
 * fiches : une fiche oubliée serait un préréglage invisible, un identifiant en trop une entrée
 * de sélecteur qui ne règle rien.
 */
export function loadPresets(
  records: readonly PresetRecord[],
  order: readonly string[]
): PresetRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (
    byId.size !== records.length ||
    order.length !== records.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !byId.has(id))
  )
    throw new Error(
      'registre des préréglages : ordre, doublon ou fiche manquante'
    );
  return order.map((id) => byId.get(id)!);
}

export const PRESETS: readonly PresetRecord[] = loadPresets(
  PRESET_RECORDS,
  PRESET_ORDER
);
