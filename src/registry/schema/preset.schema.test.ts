import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRESET_FIELD_CATEGORIES,
  PRESET_KINDS,
  presetJsonSchemaText,
  presetSchema,
} from './preset';
import type { SmallBodyCategory } from '@/core/sbdb';
import { PRESET_ORDER, PRESET_RECORDS, loadPresets } from '../presets';
import { BODY_GROUPS } from '@/ui/bodyGroups';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { flattenBodies } from '@/config/catalog';

/**
 * LE SCHÉMA DES PRÉRÉGLAGES FAIT FOI, LE JSON SCHEMA COMMITÉ EN EST UNE COPIE (lot 59).
 *
 * Mêmes promesses que les autres registres, plus deux croisements propres aux préréglages : les
 * catégories du schéma sont celles que le tableau liste (une catégorie ajoutée ne reste pas sans
 * préréglage possible), et chaque objet nommé dans une fiche existe au catalogue (un nom faux
 * serait un écart qui ne s'applique à rien, sans erreur).
 */

const PRESETS = resolve(import.meta.dirname, '../presets');

function presetFiles(): string[] {
  return readdirSync(PRESETS)
    .filter((name) => name.endsWith('.json') && name !== 'order.json')
    .map((name) => join(PRESETS, name));
}

describe('JSON Schema des préréglages généré depuis Zod', () => {
  it('est exactement le fichier commité', () => {
    const committed = readFileSync(resolve(import.meta.dirname, 'preset.schema.json'), 'utf-8'); // prettier-ignore
    expect(
      committed,
      'le schéma Zod a changé : relancer `pnpm schema:generate --only preset`'
    ).toBe(presetJsonSchemaText());
  });

  it('nomme les catégories que le tableau liste, ni plus ni moins', () => {
    const tableKinds = new Set(BODY_GROUPS.flatMap((g) => [...g.kinds]));
    tableKinds.delete('star');
    expect([...PRESET_KINDS].sort()).toEqual([...tableKinds].sort());
  });
});

describe('fiches de préréglage', () => {
  for (const file of presetFiles()) {
    const record = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    it(`${basename(file)} passe le schéma et porte son identifiant`, () => {
      const parsed = presetSchema.parse(record);
      expect(`${parsed.id}.json`).toBe(basename(file));
    });
  }

  it('ne nomme que des objets du catalogue, dont la catégorie existe', () => {
    const known = new Set([
      ...flattenBodies(CELESTIAL_CONFIG).keys(),
      ...NAVIGABLE_TARGETS.keys(),
    ]);
    for (const record of PRESET_RECORDS)
      for (const name of Object.keys(record.bodies ?? {}))
        expect(known.has(name), `${record.id} : « ${name} » inconnu`).toBe(
          true
        );
  });

  it('refuse un préréglage sans aucun écart et un écart vide', () => {
    const base = JSON.parse(
      readFileSync(join(PRESETS, 'moons.json'), 'utf-8')
    ) as Record<string, unknown>;
    expect(presetSchema.safeParse({ ...base, kinds: undefined }).success).toBe(false); // prettier-ignore
    expect(presetSchema.safeParse({ ...base, kinds: { moon: {} } }).success).toBe(false); // prettier-ignore
    expect(presetSchema.safeParse({ ...base, kinds: { skybox: { label: true } } }).success).toBe(false); // prettier-ignore
  });

  it('refuse un ordre qui ne recouvre pas exactement les fiches', () => {
    expect(() => loadPresets(PRESET_RECORDS, PRESET_ORDER.slice(1))).toThrow();
    expect(() =>
      loadPresets(PRESET_RECORDS, [...PRESET_ORDER, 'ghost'])
    ).toThrow();
  });
});

describe('météo et champ de petits corps (lot 61)', () => {
  const base = JSON.parse(
    readFileSync(join(PRESETS, 'moons.json'), 'utf-8')
  ) as Record<string, unknown>;
  const withBlock = (extra: Record<string, unknown>) =>
    presetSchema.safeParse({ ...base, ...extra }).success;

  it('accepte une fiche qui ne règle que la météo ou que le champ', () => {
    const bare = { ...base, kinds: undefined, bodies: undefined };
    expect(presetSchema.safeParse({ ...bare, weather: { on: ['clouds'] } }).success).toBe(true); // prettier-ignore
    expect(presetSchema.safeParse({ ...bare, field: { neo: false } }).success).toBe(true); // prettier-ignore
  });

  it('refuse une couche inconnue, une couche des deux côtés et un bloc vide', () => {
    expect(withBlock({ weather: { on: ['aurora'] } })).toBe(false);
    expect(withBlock({ weather: { on: ['wind'], off: ['wind'] } })).toBe(false);
    expect(withBlock({ weather: {} })).toBe(false);
    expect(withBlock({ field: {} })).toBe(false);
    expect(withBlock({ field: { asteroids: false } })).toBe(false);
  });

  it('nomme les quatre catégories du champ de SmallBodyCategory', () => {
    const categories: SmallBodyCategory[] = [...PRESET_FIELD_CATEGORIES];
    expect(categories).toHaveLength(4);
    const all: Record<SmallBodyCategory, true> = {
      'main-belt': true,
      neo: true,
      comet: true,
      tno: true,
    };
    expect([...PRESET_FIELD_CATEGORIES].sort()).toEqual(
      Object.keys(all).sort()
    );
  });
});
