import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  productJsonSchema,
  productJsonSchemaText,
  productSchema,
} from './product';

/**
 * LE SCHÉMA DES PRODUITS FAIT FOI, LE JSON SCHEMA COMMITÉ EN EST UNE COPIE.
 *
 * Mêmes trois promesses que `provider.schema.test.ts` : le fichier commité est ce que Zod produit
 * aujourd'hui, chaque fiche passe le schéma, et le schéma refuse ce qu'il doit refuser. La
 * quatrième est propre aux produits : la règle STAC lue à la source, « `other` sans lien de
 * licence vaut données privées », est tenue ici. Sans elle, les textures du domaine public
 * seraient publiées dans un format qui dit le contraire.
 */

const PRODUCTS = resolve(import.meta.dirname, '../products');

/**
 * PARCOURS RÉCURSIF, et ce n'est pas un raffinement gratuit : la première version nommait les
 * deux dossiers connus (`.` et `textures/`). Le dossier `tilesets/` ajouté au lot 9 phase 9C
 * n'aurait donc été validé par PERSONNE, en silence, alors que c'est exactement le type de
 * fiche dont une erreur (un gabarit, un niveau maximal) part directement en requêtes réseau.
 */
function productFiles(dir: string = PRODUCTS): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...productFiles(full));
    else if (entry.name.endsWith('.json')) files.push(full);
  }
  return files;
}

describe('JSON Schema des produits généré depuis Zod', () => {
  it('est exactement le fichier commité', () => {
    const committed = readFileSync(resolve(import.meta.dirname, 'product.schema.json'), 'utf-8'); // prettier-ignore
    expect(
      committed,
      'le schéma Zod a changé : relancer `pnpm schema:generate` et committer le JSON Schema'
    ).toBe(productJsonSchemaText());
  });

  it('décrit bien les quatre formes', () => {
    const schema = JSON.stringify(productJsonSchema());
    expect(schema).toContain('"texture"');
    expect(schema).toContain('"ephemeris-collection"');
    expect(schema).toContain('"tileset"');
    expect(schema).toContain('lineage');
  });
});

describe('chaque fiche produit passe le schéma', () => {
  const files = productFiles();

  it('trouve bien les fiches', () => {
    expect(files.length).toBe(66);
  });

  it.each(files.map((f) => [f.slice(PRODUCTS.length + 1), f]))(
    '%s',
    (_name, file) => {
      const raw = JSON.parse(readFileSync(file, 'utf-8')) as {
        id: string;
        $schema?: string;
      };
      const parsed = productSchema.safeParse(raw);
      expect(
        parsed.success ? null : JSON.stringify(parsed.error.issues),
        `${file} ne respecte pas le schéma`
      ).toBeNull();
      // Le nom du fichier EST l'identifiant.
      expect(raw.id).toBe(file.replace(/^.*[\\/]/, '').replace(/\.json$/, ''));
      expect(raw.$schema).toMatch(/(\.\.\/)+schema\/product\.schema\.json$/);
    }
  );
});

describe('le schéma des produits refuse', () => {
  const valid = {
    id: 'exemple-surface',
    type: 'texture',
    body: 'exemple',
    layer: 'surface',
    shipped: true,
    license: 'other',
    rights: 'public-domain',
    links: [{ rel: 'license', href: 'https://example.org/terms' }],
    providers: [{ name: 'Une agence', roles: ['producer'] }],
    tier: 'free',
    review: { status: 'reference' },
  };

  it('accepte la fiche de référence, sinon les cas suivants ne prouveraient rien', () => {
    expect(productSchema.safeParse(valid).success).toBe(true);
    expect(
      productSchema.safeParse({
        ...valid,
        license: 'CC-BY-4.0',
        rights: undefined,
      }).success
    ).toBe(true);
  });

  it.each([
    // La règle STAC lue à la source : « other » sans lien de licence = données privées.
    ['« other » sans lien de licence', { ...valid, links: undefined }],
    ['« other » avec un lien qui n’est pas de licence', { ...valid, links: [{ rel: 'via', href: 'https://example.org' }] }], // prettier-ignore
    ['« other » sans dire pourquoi', { ...valid, rights: undefined }],
    ['`rights` à côté d’une licence SPDX', { ...valid, license: 'CC-BY-4.0' }],
    ['la valeur dépréciée « proprietary »', { ...valid, license: 'proprietary' }], // prettier-ignore
    ['la valeur dépréciée « various »', { ...valid, license: 'various' }],
    ['l’ancien libellé maison « public-domain » comme licence', { ...valid, license: 'public domain' }], // prettier-ignore
    ['une couche livrée sans fournisseur', { ...valid, providers: [] }],
    ['un rôle de fournisseur hors STAC', { ...valid, providers: [{ name: 'X', roles: ['author'] }] }], // prettier-ignore
    ['un champ inconnu (faute de frappe)', { ...valid, ilustrative: true }],
    ['une couche relue non livrée qui porterait une licence', { id: 'x-bump', type: 'texture', body: 'x', layer: 'bump', shipped: false, license: 'other', review: { status: 'manual' } }], // prettier-ignore
  ])('%s', (_label, record) => {
    expect(productSchema.safeParse(record).success).toBe(false);
  });

  it('refuse une collection « non relue » qui prétendrait un lien de licence', () => {
    const collection = {
      id: 'exemple-ephemerides',
      type: 'ephemeris-collection',
      manifest: 'assets/ephemerides/manifest.json',
      providerId: 'horizons-binary',
      license: 'other',
      rights: 'unreviewed',
      links: [{ rel: 'via', href: 'https://example.org' }],
      providers: [{ name: 'JPL', roles: ['producer'] }],
      generatedBy: 'scripts/generate-horizons-ephemerides.mjs',
    };
    expect(productSchema.safeParse(collection).success).toBe(true);
    expect(
      productSchema.safeParse({
        ...collection,
        links: [{ rel: 'license', href: 'https://example.org' }],
      }).success
    ).toBe(false);
  });
});
