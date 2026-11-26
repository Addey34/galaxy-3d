/**
 * LE CATALOGUE LÉGER DES VISITES (GAL-TOUR-SCALE-001) : ce que le sélecteur lit avant qu'aucune
 * visite ne soit ouverte, c'est-à-dire un identifiant et un titre dans les quatre langues, dans
 * l'ordre de `order.json`.
 *
 * Il est DÉRIVÉ des fiches, jamais recopié : le greffon `deriveRegistryText` de `vite.config.ts`
 * lit les fiches et `order.json`, appelle `buildTourCatalogue`, et sert le résultat comme module
 * virtuel `virtual:tour-catalogue`. Ajouter une visite reste une fiche et une ligne dans
 * `order.json` : le sélecteur la voit sans que personne ne touche une liste.
 *
 * Ce module est PUR et sans entrée/sortie : le greffon (Node) et les tests l'importent tels quels.
 * Imports relatifs seulement, car la configuration de Vite ne résout pas l'alias `@/`.
 */
import type { LocalizedText } from '../../types';

export interface TourCatalogueEntry {
  readonly id: string;
  readonly title: LocalizedText;
  /**
   * Les corps que la visite REJOINT (cibles de ses `flyTo`, dans l'ordre, sans doublon) et les lieux où elle
   * PLONGE (`diveTo`, avec le corps du dernier `flyTo` qui précède) : LUS dans ses étapes, jamais écrits à
   * part. Ce sont les relations « ce corps, ce lieu → cette visite » de l'observation interconnectée
   * (GAL-OBSERVATION-001).
   */
  readonly bodies: readonly string[];
  readonly places: readonly { readonly body: string; readonly name: string }[];
}

/** Les corps rejoints et les lieux visités par une fiche, lus dans ses étapes. */
export function tourReach(steps: readonly unknown[]): {
  bodies: string[];
  places: { body: string; name: string }[];
} {
  const bodies: string[] = [];
  const places: { body: string; name: string }[] = [];
  let current: string | null = null;
  for (const raw of steps) {
    const step = raw as { kind?: string; body?: unknown; place?: unknown };
    if (step.kind === 'flyTo' && typeof step.body === 'string') {
      current = step.body;
      if (!bodies.includes(step.body)) bodies.push(step.body);
    } else if (
      step.kind === 'diveTo' &&
      typeof step.place === 'string' &&
      current &&
      !places.some((p) => p.body === current && p.name === step.place)
    )
      places.push({ body: current, name: step.place });
  }
  return { bodies, places };
}

/**
 * Les fiches dans l'ordre déclaré. Refuse un ordre qui ne recouvre pas exactement les fiches :
 * une fiche oubliée dans `order.json` serait une visite invisible, et un identifiant en trop une
 * entrée de sélecteur qui ne lance rien.
 */
export function orderTourRecords<T extends { readonly id: string }>(
  records: readonly T[],
  order: readonly string[]
): T[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (
    byId.size !== records.length ||
    order.length !== records.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !byId.has(id))
  )
    throw new Error('registre des visites : ordre, doublon ou fiche manquante');
  return order.map((id) => byId.get(id)!);
}

export function buildTourCatalogue(
  records: readonly {
    readonly id: string;
    readonly title: LocalizedText;
    readonly steps?: readonly unknown[];
  }[],
  order: readonly string[]
): TourCatalogueEntry[] {
  return orderTourRecords(records, order).map(({ id, title, steps }) => ({
    id,
    title,
    ...tourReach(steps ?? []),
  }));
}
