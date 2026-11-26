import { describe, expect, it } from 'vitest';
import { TEXTURE_PRODUCTS } from '@/registry/products';
import {
  COLOR_NATURE_BY_BODY,
  SURFACE_OBSERVED_BY_BODY,
} from '@/config/colorNature';
import { COLOR_NATURES, productSchema } from './product';

/**
 * LA NATURE DE LA COULEUR EST DITE POUR TOUTE SURFACE LIVRÉE.
 *
 * Une carte de Mercure est monochrome, une carte de Vénus est du radar, Titan est vu en proche
 * infrarouge : sans ce champ, rien ne le disait au visiteur. Le test échoue pour tout corps dont
 * la couche `surface` est livrée sans `colorNature`, et nomme les corps.
 */
const surfaces = TEXTURE_PRODUCTS.filter(
  (p) => p.shipped && p.layer === 'surface'
);

describe('colorNature des surfaces livrées', () => {
  it('couvre au moins une cinquantaine de surfaces', () => {
    expect(surfaces.length).toBeGreaterThan(50);
  });

  it('est renseignée pour chaque surface livrée', () => {
    const missing = surfaces
      .filter((p) => p.shipped && !p.colorNature)
      .map((p) => p.body);
    expect(missing).toEqual([]);
  });

  it('refuse une valeur hors du vocabulaire fermé', () => {
    const sample = surfaces.find((p) => p.shipped && p.colorNature);
    expect(sample).toBeDefined();
    const bad = { ...sample, colorNature: 'pastel' };
    expect(productSchema.safeParse(bad).success).toBe(false);
    expect(COLOR_NATURES).toContain(
      sample && sample.shipped ? sample.colorNature : ''
    );
  });

  it('est la même que la table lue par la fiche du corps (config/colorNature.ts)', () => {
    const fromRegistry = new Map(
      surfaces.flatMap((p) =>
        p.shipped && p.colorNature ? [[p.body, p.colorNature] as const] : []
      )
    );
    expect(Object.fromEntries(COLOR_NATURE_BY_BODY)).toEqual(
      Object.fromEntries(fromRegistry)
    );
  });

  it("le jour d'observation d'un instantané est le même que celui de la fiche (config/colorNature.ts)", () => {
    const fromRegistry = new Map(
      surfaces.flatMap((p) =>
        p.shipped && p.observed
          ? [
              [
                p.body,
                {
                  day: p.observed.from.slice(0, 10),
                  filled: p.filled === true,
                },
              ] as const,
            ]
          : []
      )
    );
    expect(fromRegistry.size).toBeGreaterThan(0);
    expect(Object.fromEntries(SURFACE_OBSERVED_BY_BODY)).toEqual(
      Object.fromEntries(fromRegistry)
    );
  });

  it("un instantané observé a un intervalle dans l'ordre et une couleur qui n'est pas illustrative", () => {
    for (const p of surfaces)
      if (p.shipped && p.observed) {
        expect(p.observed.from < p.observed.to, p.body).toBe(true);
        expect(p.colorNature, p.body).not.toBe('illustrative');
      }
  });
});
