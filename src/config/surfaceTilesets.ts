/**
 * FAÇADE D'EXÉCUTION des jeux de tuiles d'imagerie (lot 9, phase 9C).
 *
 * Même rôle que `config/factSources.ts` vis-à-vis de `registry/providers/` : le registre est de
 * la DONNÉE, ce module est ce que l'application en lit. Ajouter un corps à l'imagerie streamée
 * n'est donc qu'une fiche de plus dans `src/registry/products/tilesets/` — c'est le contrat que
 * la phase 9E vérifiera avec Mars.
 *
 * **Ce module n'est chargé qu'à l'approche d'une surface.** Il n'est importé que par
 * `components/surface/`, lui-même chargé par un `import()` dynamique : les fiches ne pèsent donc
 * rien dans le bundle de démarrage. Il n'importe surtout PAS `registry/products/index.ts`, qui
 * tire les 63 fiches de texture, ni `registry/providers/`, dont la prose bilingue des conditions
 * n'a rien à faire dans un navigateur (le défaut mesuré au lot 8).
 */
import type { ImageryTilesetProduct } from '@/registry/schema/product';
import type { TileMatrixShape } from '@/core/tilePyramid';
import type { TileService } from '@/core/tileUrl';
import type { DatedProduct, TimeInterval } from '@/core/temporal';

/**
 * TypeScript ÉLARGIT les chaînes d'un import JSON (`"type": "tileset"` arrive typé `string`).
 * Le schéma Zod vérifie à l'exécution, fichier par fichier, ce que le compilateur ne voit plus
 * (`product.schema.test.ts`) ; cette assertion ne fait que rendre le littéral attendu.
 */
const asTileset = (record: unknown): ImageryTilesetProduct =>
  record as ImageryTilesetProduct;

const FICHES = Object.values(
  import.meta.glob('../registry/products/tilesets/*.json', {
    eager: true,
    import: 'default',
  })
).map(asTileset);

/** Ce que le moteur et le bandeau lisent d'un jeu de tuiles. */
export interface SurfaceTileset {
  id: string;
  body: string;
  title: string;
  mission: string;
  instrument: string;
  providerId: string;
  service: TileService;
  matrix: TileMatrixShape;
  minLevel: number;
  maxLevel: number;
  /** Finesse de la mosaïque publiée, en pixels par degré. */
  publishedPixelsPerDegree: number;
  /** Intervalle que la mosaïque décrit, prêt pour `core/temporal.ts`. */
  acquired: TimeInterval;
  /** Crédit à afficher, tiré des `providers[]` STAC de la fiche. */
  credit: string;
}

function toTileset(fiche: ImageryTilesetProduct): SurfaceTileset {
  const [from, to] = fiche.acquired.interval[0]!;
  return {
    id: fiche.id,
    body: fiche.body,
    title: fiche.title,
    mission: fiche.mission,
    instrument: fiche.instrument,
    providerId: fiche.providerId,
    service: {
      template: fiche.service.template,
      style: fiche.service.style,
      tileMatrixSet: fiche.service.tileMatrixSet,
      matrix: fiche.service.matrix,
    },
    matrix: fiche.service.matrix,
    minLevel: fiche.service.minLevel,
    maxLevel: fiche.service.maxLevel,
    publishedPixelsPerDegree: fiche.publishedPixelsPerDegree,
    acquired: { from: Date.parse(from!), to: Date.parse(to!) },
    credit: fiche.providers.map((provider) => provider.name).join(' · '),
  };
}

/** Les jeux de tuiles déclarés, indexés par nom de corps du catalogue. */
export const SURFACE_TILESETS: ReadonlyMap<string, SurfaceTileset> = new Map(
  FICHES.map((fiche) => [fiche.body, toTileset(fiche)])
);

/**
 * Produit daté d'une mosaïque, pour `classifyTemporal`.
 *
 * `kind: 'measurement'` : une mosaïque est un assemblage d'images prises par un capteur, sur
 * l'intervalle de sa campagne. Aucune tolérance d'écart n'est déclarée et aucune fenêtre
 * `measured` : la mosaïque est servie TELLE QUELLE quelle que soit la date de la scène, parce
 * qu'elle ne décrit pas cette date mais la surface. La catégorie rendue est donc `observed`, ce
 * qui est exactement ce que le bandeau doit dire.
 */
export function tilesetProduct(tileset: SurfaceTileset): DatedProduct {
  return { kind: 'measurement', validTime: tileset.acquired };
}
