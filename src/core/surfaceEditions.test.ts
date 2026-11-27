import { describe, expect, it } from 'vitest';
import surfaceEditions from 'virtual:surface-edition-catalogue';
import { TEXTURE_PRODUCTS } from '@/registry/products';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { buildSurfaceEditions } from './surfaceEditions';

const record = (editions: { edition: string; from: string }[]) => ({
  type: 'texture',
  shipped: true,
  body: 'jupiter',
  layer: 'surface',
  editions: editions.map((e) => ({
    edition: e.edition,
    observed: { from: e.from, to: e.from },
    colorNature: 'enhanced',
    filledShare: 0.1,
    sourcePixelWidth: 3600,
    tiers: ['2k', '1k'],
    sourcePage: 'https://example.org',
  })),
});

describe('le catalogue des éditions, pur', () => {
  it('range les éditions de la plus ancienne à la plus récente', () => {
    const out = buildSurfaceEditions(
      [
        record([
          { edition: 'b', from: '2025-01-01T00:00:00Z' },
          { edition: 'a', from: '2015-01-01T00:00:00Z' },
        ]),
      ],
      { jupiter: { surface: 'b' } }
    );
    expect(out['jupiter']!.editions.map((e) => e.edition)).toEqual(['a', 'b']);
    expect(out['jupiter']!.defaultEdition).toBe('b');
  });

  it('refuse une édition par défaut absente de la liste, et un doublon', () => {
    expect(() =>
      buildSurfaceEditions(
        [record([{ edition: 'a', from: '2015-01-01T00:00:00Z' }])],
        { jupiter: { surface: 'z' } }
      )
    ).toThrow(/par défaut/);
    expect(() =>
      buildSurfaceEditions(
        [
          record([
            { edition: 'a', from: '2015-01-01T00:00:00Z' },
            { edition: 'a', from: '2016-01-01T00:00:00Z' },
          ]),
        ],
        { jupiter: { surface: 'a' } }
      )
    ).toThrow(/doublon/);
  });
});

describe('les éditions livrées (GAL-ATMOSPHERES-001)', () => {
  it('les quatre géantes ont au moins trois observations datées', () => {
    for (const body of ['jupiter', 'saturn', 'uranus', 'neptune'])
      expect(
        surfaceEditions[body]?.editions.length,
        body
      ).toBeGreaterThanOrEqual(3);
  });

  it("l'édition par défaut est celle du catalogue, et la fiche décrit celle-là", () => {
    for (const [body, cat] of Object.entries(surfaceEditions)) {
      const config = CELESTIAL_CONFIG.bodies[body];
      expect(config?.textureEditions?.surface, body).toBe(cat.defaultEdition);
      const product = TEXTURE_PRODUCTS.find(
        (p) => p.body === body && p.layer === cat.layer
      );
      const def = cat.editions.find((e) => e.edition === cat.defaultEdition)!;
      expect(product && product.shipped && product.observed?.from, body).toBe(
        def.from
      );
      expect(product && product.shipped && product.colorNature).toBe(
        def.colorNature
      );
      // Les paliers du catalogue sont ceux de l'édition par défaut.
      expect([...(config!.textureResolutions.surface ?? [])].sort()).toEqual(
        [...def.tiers].sort()
      );
    }
  });

  it("chaque observation a un intervalle dans l'ordre, une part complétée et aucune couleur illustrative", () => {
    for (const [body, cat] of Object.entries(surfaceEditions))
      for (const e of cat.editions) {
        expect(e.from < e.to, `${body} ${e.edition}`).toBe(true);
        expect(e.filledShare).toBeGreaterThanOrEqual(0);
        expect(e.filledShare).toBeLessThan(1);
        expect(e.colorNature).not.toBe('illustrative');
      }
  });
});
