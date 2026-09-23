import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EPHEMERIS_COLLECTION,
  TEXTURE_PRODUCTS,
  licenseLabel,
  shippedTextures,
} from './index';
import { POSITION_PROVIDERS } from '@/registry/providers';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { allBodies } from '@/config/catalog';
import type { ShippedTextureProduct } from '../schema/product';

/**
 * LE REGISTRE DES PRODUITS ET CE QU'IL DÉCRIT.
 *
 * Le schéma vérifie la FORME d'une fiche ; ces tests vérifient qu'elle dit vrai de ce qui est
 * livré : chaque couche du catalogue a sa fiche, chaque fiche parle d'une couche réelle, et la
 * collection d'éphémérides pointe un manifeste et un fournisseur qui existent.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

describe('fiches de textures', () => {
  it('une fiche par couche, identifiants uniques', () => {
    const ids = TEXTURE_PRODUCTS.map((p) => p.id);
    expect(ids.length).toBe(64);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = TEXTURE_PRODUCTS.map((p) => `${p.body}/${p.layer}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('couvre chaque couche que le catalogue livre, anneaux compris', () => {
    const known = new Set(TEXTURE_PRODUCTS.map((p) => `${p.body}/${p.layer}`));
    const missing: string[] = [];
    for (const { name, config } of allBodies(CELESTIAL_CONFIG)) {
      for (const layer of Object.keys(config.textures ?? {}))
        if (!known.has(`${name}/${layer}`)) missing.push(`${name}/${layer}`);
      if (config.ring && !known.has(`${name}/ring`))
        missing.push(`${name}/ring`);
    }
    expect(missing).toEqual([]);
  });

  it('ne déclare « livrée » aucune couche que le catalogue ne connaît pas', () => {
    const bodies = new Set(allBodies(CELESTIAL_CONFIG).map(({ name }) => name));
    for (const p of TEXTURE_PRODUCTS.filter((p) => p.shipped))
      expect(bodies.has(p.body), p.id).toBe(true);
  });

  it('ne publie que les trois libellés que /sources sait afficher', () => {
    // `seo/sourcesPage.ts` traduit « public-domain » et « generated », et affiche tel quel
    // « CC BY 4.0 ». Un nouveau libellé passerait sur la page sans traduction.
    const labels = new Set(shippedTextures().map((t) => t.license));
    expect([...labels].sort()).toEqual([
      'CC BY 4.0',
      'generated',
      'public-domain',
    ]);
  });

  it('refuse de libeller une licence qu’il ne sait pas dire', () => {
    const fake = {
      ...(TEXTURE_PRODUCTS.find((p) => p.shipped) as ShippedTextureProduct),
      license: 'MIT',
      rights: undefined,
    };
    expect(() => licenseLabel(fake)).toThrow('MIT');
  });
});

describe('collection des éphémérides', () => {
  it('pointe un manifeste qui existe', () => {
    expect(
      existsSync(resolve(ROOT, 'public', EPHEMERIS_COLLECTION.manifest))
    ).toBe(true);
  });

  it('nomme un fournisseur du registre', () => {
    const ids = Object.values(POSITION_PROVIDERS).map((p) => p.id);
    expect(ids).toContain(EPHEMERIS_COLLECTION.providerId);
  });

  it('nomme un script qui existe', () => {
    expect(existsSync(resolve(ROOT, EPHEMERIS_COLLECTION.generatedBy))).toBe(
      true
    );
  });
});
