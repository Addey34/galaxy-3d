import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  providerJsonSchema,
  providerJsonSchemaText,
  providerSchema,
} from './provider';

/**
 * LE SCHÉMA FAIT FOI, ET LE JSON SCHEMA COMMITÉ EN EST UNE COPIE.
 *
 * Le lot 7 sort la donnée du TypeScript : le compilateur ne relit plus les fiches pendant la
 * saisie (`REGISTRES_LOT7.md` § 5, décision D1, « perte honnête »). Ce qui la rend à l'éditeur,
 * c'est le `$schema` de chaque fichier, donc un JSON Schema commité — c'est-à-dire une seconde
 * écriture de la même chose, exactement ce que ce dépôt a déjà vu diverger ailleurs. D'où ces
 * trois vérifications :
 *
 *   1. le fichier commité est ce que le schéma Zod produit AUJOURD'HUI, octet pour octet ;
 *   2. chaque fiche du registre passe le schéma Zod. C'est le seul contrôle qui confirme ce que
 *      TypeScript ne voit plus : un import JSON élargit `"role": "fact-source"` en `string`, et
 *      `providers/index.ts` s'appuie sur ce test pour affirmer le littéral ;
 *   3. le schéma REFUSE ce qu'il doit refuser. Un schéma qu'on n'a pas vu échouer ne prouve rien.
 */

const PROVIDERS = resolve(import.meta.dirname, '../providers');

function providerFiles(): string[] {
  return readdirSync(PROVIDERS).filter((name) => name.endsWith('.json'));
}

describe('JSON Schema généré depuis Zod', () => {
  it('est exactement le fichier commité', () => {
    const committed = readFileSync(join(PROVIDERS, '../schema/provider.schema.json'), 'utf-8'); // prettier-ignore
    expect(
      committed,
      'le schéma Zod a changé : relancer `pnpm schema:generate` et committer le JSON Schema'
    ).toBe(providerJsonSchemaText());
  });

  it('décrit bien les deux rôles', () => {
    // Borne : une génération vide ou dégénérée rendrait la comparaison ci-dessus verte sans rien
    // prouver. On vérifie que les deux branches de l'union sont là.
    const schema = JSON.stringify(providerJsonSchema());
    expect(schema).toContain('"fact-source"');
    expect(schema).toContain('"position-source"');
    expect(schema).toContain('interval');
  });
});

describe('chaque fiche du registre passe le schéma', () => {
  const files = providerFiles();

  it('trouve bien les fiches', () => {
    expect(files.length).toBeGreaterThanOrEqual(22);
  });

  it.each(files)('%s', (name) => {
    const raw: unknown = JSON.parse(
      readFileSync(join(PROVIDERS, name), 'utf-8')
    );
    const parsed = providerSchema.safeParse(raw);
    expect(
      parsed.success ? null : JSON.stringify(parsed.error.issues),
      `${name} ne respecte pas le schéma`
    ).toBeNull();
    // Le nom du fichier EST l'identifiant : sans cela, deux fiches pourraient se réclamer du
    // même id sans que rien ne le voie.
    expect((raw as { id: string }).id).toBe(name.replace(/\.json$/, ''));
    expect((raw as { $schema?: string }).$schema).toBe(
      '../schema/provider.schema.json'
    );
  });
});

describe('le schéma refuse', () => {
  const valid = {
    $schema: '../schema/provider.schema.json',
    id: 'exemple-source',
    role: 'fact-source',
    publisher: 'NASA',
    title: 'Une table',
    url: 'https://example.org/table',
    kind: 'agency',
    accessed: '2026-09-18',
  };

  it('accepte la fiche de référence, sinon les cas suivants ne prouveraient rien', () => {
    expect(providerSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['un rôle inconnu', { ...valid, role: 'autre-chose' }],
    ['un kind hors vocabulaire', { ...valid, kind: 'blog' }],
    ['une URL en http', { ...valid, url: 'http://example.org/table' }],
    ['un identifiant qui n’est pas en kebab-case', { ...valid, id: 'Exemple_Source' }], // prettier-ignore
    ['une date de lecture incomplète', { ...valid, accessed: '2026-09' }],
    ['une source de fait sans date de lecture', { ...valid, accessed: undefined }], // prettier-ignore
    [
      'une source de position dont le kind n’est pas celui de core/temporal.ts',
      {
        id: 'exemple-position',
        role: 'position-source',
        publisher: 'NASA',
        title: 'Une éphéméride',
        url: 'https://example.org/e',
        kind: 'reanalysis',
        positionSource: 'kepler',
        validationProviderId: 'kepler',
      },
    ],
    [
      'une couverture temporelle à trois bornes',
      {
        id: 'exemple-position',
        role: 'position-source',
        publisher: 'NASA',
        title: 'Une éphéméride',
        url: 'https://example.org/e',
        kind: 'ephemeris',
        positionSource: 'kepler',
        validationProviderId: 'kepler',
        extent: {
          temporal: { interval: [['1900-01-01T00:00:00Z', null, null]] },
        },
      },
    ],
    [
      'un instant qui n’est pas une date-heure UTC',
      {
        id: 'exemple-position',
        role: 'position-source',
        publisher: 'NASA',
        title: 'Une éphéméride',
        url: 'https://example.org/e',
        kind: 'ephemeris',
        positionSource: 'kepler',
        validationProviderId: 'kepler',
        extent: { temporal: { interval: [['1900-01-01', null]] } },
      },
    ],
  ])('%s', (_label, record) => {
    expect(providerSchema.safeParse(record).success).toBe(false);
  });

  it('accepte en revanche des bornes nulles des deux côtés', () => {
    // STAC : `null` veut dire « pas de borne ». C'est la forme que prennent astronomy-engine et
    // les éléments képlériens, et elle DOIT rester légale.
    expect(
      providerSchema.safeParse({
        id: 'exemple-position',
        role: 'position-source',
        publisher: 'NASA',
        title: 'Une éphéméride',
        url: 'https://example.org/e',
        kind: 'ephemeris',
        positionSource: 'kepler',
        validationProviderId: 'kepler',
        extent: { temporal: { interval: [[null, null]] } },
      }).success
    ).toBe(true);
  });
});
