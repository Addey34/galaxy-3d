/** Schéma commité, fiches et refus vérifiés depuis la source Zod. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { spacecraftJsonSchemaText, spacecraftSchema } from './spacecraft';

const directory = resolve(import.meta.dirname, '../spacecraft');
const valid = JSON.parse(
  readFileSync(resolve(directory, 'voyager1.json'), 'utf8')
) as Record<string, unknown>;

describe('schéma des sondes', () => {
  it('est exactement le JSON Schema commité et décrit une vraie fiche', () => {
    const text = spacecraftJsonSchemaText();
    expect(
      readFileSync(
        resolve(import.meta.dirname, 'spacecraft.schema.json'),
        'utf8'
      )
    ).toBe(text);
    expect(text).toContain('naif');
    expect(text).toContain('interval');
  });
  it('valide chaque fichier, son nom et sa référence de schéma', () => {
    const files = readdirSync(directory).filter(
      (name) => name.endsWith('.json') && name !== 'order.json'
    );
    expect(files).toHaveLength(11);
    for (const name of files) {
      const record: unknown = JSON.parse(
        readFileSync(resolve(directory, name), 'utf8')
      );
      expect(spacecraftSchema.safeParse(record).success, name).toBe(true);
      expect((record as { id: string }).id).toBe(name.slice(0, -5));
      expect((record as { $schema: string }).$schema).toBe(
        '../schema/spacecraft.schema.json'
      );
    }
  });
  it('accepte la fiche témoin avant les refus', () =>
    expect(spacecraftSchema.safeParse(valid).success).toBe(true));
  it.each([
    ['id', { ...valid, id: 'Voyager_1' }],
    ['color', { ...valid, color: '#ffffff' }],
    ['naif', { ...valid, identifiers: { naif: 31 } }],
    [
      'borne nulle',
      {
        ...valid,
        coverage: { temporal: { interval: [[null, '2020-01-01T00:00:00Z']] } },
      },
    ],
    [
      'borne mal formée',
      {
        ...valid,
        coverage: {
          temporal: { interval: [['1977-09-05', '2020-01-01T00:00:00Z']] },
        },
      },
    ],
    ['date impossible', { ...valid, launchDate: '2026-02-31' }],
    [
      'couverture inversée',
      {
        ...valid,
        coverage: {
          temporal: {
            interval: [['2020-01-02T00:00:00Z', '2020-01-01T00:00:00Z']],
          },
        },
      },
    ],
    [
      'couverture avant lancement',
      {
        ...valid,
        coverage: {
          temporal: {
            interval: [['1977-09-04T00:00:00Z', '2020-01-01T00:00:00Z']],
          },
        },
      },
    ],
    ['classe', { ...valid, targetClass: 'satellite' }],
    ['clé inconnue', { ...valid, extra: true }],
  ])('refuse %s', (_label, record) =>
    expect(spacecraftSchema.safeParse(record).success).toBe(false)
  );
});
