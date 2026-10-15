import { describe, expect, it } from 'vitest';
import { deferFactProvenance } from '@/core/registryText';
import { ENTITY_ORDER, ENTITY_RECORDS } from '@/registry/entities';
import {
  hydrateFactProvenance,
  loadCatalogue,
  type EntityRecord,
  type FactEntry,
} from '@/registry/load';
import {
  INTERSTELLAR_ORDER,
  INTERSTELLAR_RECORDS,
  loadInterstellar,
} from '@/registry/interstellar';
import {
  SPACECRAFT_ORDER,
  SPACECRAFT_RECORDS,
  loadSpacecraft,
} from '@/registry/spacecraft';
import type { FactField } from '@/types';
import { flattenBodies } from './catalog';
import { factProvenancePending, loadCardFacts } from './cardFacts';

/**
 * LA PROVENANCE DIFFÉRÉE SE REPOSE À L'IDENTIQUE (lot 52).
 *
 * Le navigateur reçoit chaque fait réduit à sa valeur, et la provenance à la première ouverture
 * d'une fiche. Ici, les fiches ne sont pas allégées (Vitest lit le disque) : on applique donc la
 * MÊME règle que le greffon (`deferFactProvenance`), on construit le catalogue allégé, on repose,
 * et le résultat doit être celui du chargement complet, champ pour champ.
 */
type Provenance = Record<string, Partial<Record<FactField, FactEntry>>>;

function split<T extends { id: string }>(records: readonly T[]) {
  const light: T[] = [];
  const provenance: Provenance = {};
  for (const record of records) {
    const out = deferFactProvenance(record);
    light.push(out.fiche);
    if (out.provenance)
      provenance[record.id] = out.provenance as Partial<
        Record<FactField, FactEntry>
      >;
  }
  return { light, provenance };
}

describe('provenance des faits différée (lot 52)', () => {
  it('le catalogue allégé puis reposé est le catalogue complet', () => {
    const { light, provenance } = split(ENTITY_RECORDS);
    const full = flattenBodies({
      bodies: loadCatalogue(ENTITY_RECORDS, ENTITY_ORDER),
    });
    const bodies = flattenBodies({
      bodies: loadCatalogue(light as EntityRecord[], ENTITY_ORDER),
    });
    // LE TÉMOIN : allégé, Jupiter ne cite plus aucune source, mais garde son rayon.
    expect(bodies.get('jupiter')!.realData!.sources).toBeUndefined();
    expect(bodies.get('jupiter')!.realData!.radiusKm).toBe(
      full.get('jupiter')!.realData!.radiusKm
    );
    const count = hydrateFactProvenance(
      bodies as unknown as ReadonlyMap<
        string,
        { realData?: Record<string, unknown> }
      >,
      provenance
    );
    expect(count).toBeGreaterThan(500);
    for (const [name, cfg] of full) expect(bodies.get(name), name).toEqual(cfg);
  });

  it('les sondes et les interstellaires aussi', () => {
    for (const [records, order, load] of [
      [SPACECRAFT_RECORDS, SPACECRAFT_ORDER, loadSpacecraft],
      [INTERSTELLAR_RECORDS, INTERSTELLAR_ORDER, loadInterstellar],
    ] as const) {
      const { light, provenance } = split(records as readonly { id: string }[]);
      const full = (load as (r: unknown, o: readonly string[]) => unknown[])(
        records,
        order
      ) as { name: string; facts: Record<string, unknown> }[];
      const rebuilt = (load as (r: unknown, o: readonly string[]) => unknown[])(
        light,
        order
      ) as { name: string; facts: Record<string, unknown> }[];
      hydrateFactProvenance(
        new Map(rebuilt.map((m) => [m.name, { realData: m.facts }])),
        provenance
      );
      expect(rebuilt).toEqual(full);
    }
  });

  it('une provenance pour un corps inconnu est refusée, pas ignorée', () => {
    expect(() =>
      hydrateFactProvenance(new Map(), {
        nowhere: { radiusKm: { source: 'jpl-sbdb', method: 'measured' } },
      })
    ).toThrow(/corps inconnu/);
  });

  it('hors navigateur rien n’est en attente, et rien n’est demandé', async () => {
    expect(factProvenancePending()).toBe(false);
    expect(await loadCardFacts()).toBe(0);
  });
});
