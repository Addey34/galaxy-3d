/**
 * REGISTRE DES PRODUITS LIVRÉS : chaque couche de texture d'un corps, et la collection des
 * binaires d'éphémérides. Une fiche JSON par produit, validée par le schéma Zod de
 * `../schema/product.ts` (en `devDependency` : ce module n'en prend que le TYPE).
 *
 * Il ABSORBE l'ancien `scripts/texture-sources.json` (supprimé au lot 7, phase 2), dont les trois
 * blocs décrivaient la même couche en trois endroits : `imported` (ce qui est livré, publié sur
 * `/sources`), `sources` (la source candidate, devenue `lineage`) et `reviews` (l'audit, devenu
 * `review`). Une couche = un fichier : les trois ne peuvent plus diverger par construction.
 *
 * **Jamais chargé par l'application.** Seuls les tests et le plugin de build
 * (`vite.config.ts`, par `ssrLoadModule`) le lisent ; le glob ci-dessous n'est donc jamais
 * empaqueté pour le navigateur.
 *
 * L'ORDRE n'est pas une donnée ici, contrairement à `providers/` : `/sources` trie ses textures
 * par nom de corps dans la langue de la page. Le glob rend les fichiers dans l'ordre alphabétique
 * de leur chemin, ce qui suffit à rendre la sortie déterministe.
 */
import type {
  EphemerisCollectionProduct,
  ImageryTilesetProduct,
  ReviewedOnlyTextureProduct,
  ShippedTextureProduct,
} from '../schema/product';
import ephemerisCollection from './horizons-ephemerides.json';

export type TextureProduct = ShippedTextureProduct | ReviewedOnlyTextureProduct;

/**
 * Les 63 couches, lues depuis le disque. Le schéma Zod est ce qui garantit qu'elles ont la forme
 * annoncée (`product.schema.test.ts`) : un import JSON n'est pas typé plus finement que `unknown`
 * ici, et le prétendre autrement serait mentir au compilateur.
 */
export const TEXTURE_PRODUCTS: readonly TextureProduct[] = Object.values(
  import.meta.glob('./textures/*.json', { eager: true, import: 'default' })
) as TextureProduct[];

export const EPHEMERIS_COLLECTION =
  ephemerisCollection as EphemerisCollectionProduct;

/**
 * Les jeux de tuiles d'imagerie streamée (lot 9, phase 9C). Lus ICI par les tests et le build
 * (`/sources`) ; l'APPLICATION les lit par `config/surfaceTilesets.ts`, qui importe les mêmes
 * fichiers depuis le morceau chargé à l'approche — ce module-ci n'entre jamais dans un bundle.
 */
export const TILESET_PRODUCTS: readonly ImageryTilesetProduct[] = Object.values(
  import.meta.glob('./tilesets/*.json', { eager: true, import: 'default' })
) as ImageryTilesetProduct[];

/**
 * Le libellé de licence que `/sources` affiche (`seo/sourcesPage.ts`, `LICENSE_LABELS`). Il vient
 * de la licence SPDX quand elle existe, sinon de `rights`, qui dit pourquoi elle vaut `other`.
 */
export function licenseLabel(product: ShippedTextureProduct): string {
  if (product.license === 'CC-BY-4.0') return 'CC BY 4.0';
  if (product.license === 'other' && product.rights) return product.rights;
  throw new Error(
    `licence sans libellé affichable : ${product.license} (${product.id})`
  );
}

/** Entrée de provenance d'une texture livrée, telle que `seo/sourcesPage.ts` la lit. */
export interface TextureProvenanceView {
  body: string;
  layer: string;
  license: string;
  credit: string;
  tier: string;
  sourceUrl?: string;
  illustrative?: boolean;
  filled?: boolean;
  postProcess?: string;
}

/** Les couches livrées, sous la forme de l'ancien bloc `imported`. */
export function shippedTextures(): TextureProvenanceView[] {
  return TEXTURE_PRODUCTS.filter(
    (p): p is ShippedTextureProduct => p.shipped
  ).map((p) => {
    const view: TextureProvenanceView = {
      body: p.body,
      layer: p.layer,
      license: licenseLabel(p),
      credit: p.providers[0]!.name,
      tier: p.tier,
    };
    // Clés présentes seulement si la fiche les porte, comme dans l'ancien fichier : la page
    // teste certaines par `in`.
    if (p.sourceUrl !== undefined) view.sourceUrl = p.sourceUrl;
    if (p.illustrative !== undefined) view.illustrative = p.illustrative;
    if (p.filled !== undefined) view.filled = p.filled;
    if (p.postProcess !== undefined) view.postProcess = p.postProcess;
    return view;
  });
}

/** Audit d'une couche, sous la forme de l'ancien bloc `reviews`. */
export type TextureReviewView = {
  body: string;
  layer: string;
} & TextureProduct['review'];

export function textureReviews(): TextureReviewView[] {
  return TEXTURE_PRODUCTS.map((p) => ({
    body: p.body,
    layer: p.layer,
    ...p.review,
  }));
}
