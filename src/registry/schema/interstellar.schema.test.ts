/** Schéma commité, fiches et refus vérifiés depuis la source Zod. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interstellarJsonSchemaText, interstellarSchema } from './interstellar';

const directory = resolve(import.meta.dirname, '../interstellar');
const valid = JSON.parse(
  readFileSync(resolve(directory, 'oumuamua.json'), 'utf8')
) as Record<string, unknown>;
const elements = valid.elements as Record<string, unknown>;

describe('schéma des interstellaires', () => {
  it('est exactement le JSON Schema commité et décrit les éléments', () => {
    const text = interstellarJsonSchemaText();
    expect(
      readFileSync(
        resolve(import.meta.dirname, 'interstellar.schema.json'),
        'utf8'
      )
    ).toBe(text);
    expect(text).toContain('eccentricity');
    expect(text).toContain('$deg');
  });
  it('valide chaque fichier, son nom et sa référence de schéma', () => {
    const files = readdirSync(directory).filter((name) =>
      name.endsWith('.json')
    );
    expect(files).toHaveLength(3);
    for (const name of files) {
      const record: unknown = JSON.parse(
        readFileSync(resolve(directory, name), 'utf8')
      );
      expect(interstellarSchema.safeParse(record).success, name).toBe(true);
      expect((record as { id: string }).id).toBe(name.slice(0, -5));
      expect((record as { $schema: string }).$schema).toBe(
        '../schema/interstellar.schema.json'
      );
    }
  });
  it('accepte la fiche témoin avant les refus', () =>
    expect(interstellarSchema.safeParse(valid).success).toBe(true));
  it.each([
    ['id', { ...valid, id: 'Oumuamua' }],
    ['color', { ...valid, color: '#ffffff' }],
    ['e', { ...valid, elements: { ...elements, eccentricity: 1 } }],
    ['a', { ...valid, elements: { ...elements, semiMajorAxisAU: 0 } }],
    [
      'forme',
      { ...valid, elements: { ...elements, inclinationRad: { $radians: 1 } } },
    ],
    ['classe', { ...valid, targetClass: 'spacecraft' }],
    ['population', { ...valid, population: undefined }],
    ['date', { ...valid, elements: { ...elements, epoch: { $date: null } } }],
  ])('refuse %s', (_label, record) =>
    expect(interstellarSchema.safeParse(record).success).toBe(false)
  );
});
