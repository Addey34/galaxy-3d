/**
 * QUELLE TUILE DE HAUTEURS POUR QUELLE TUILE D'IMAGERIE — module pur, testé (lot 9, phase 9D).
 *
 * Les hauteurs et l'imagerie partagent la MÊME pyramide (`core/tilePyramid.ts`), mais pas la
 * même couverture : les hauteurs sont un socle GLOBAL grossier plus quelques aires NOMMÉES
 * fines, parce qu'un globe de hauteurs 16 bits pèse 67 Mo au niveau 4 et 1,07 Go au niveau 6,
 * par version retenue sur un hébergement dont le quota a déjà sauté une fois.
 *
 * Deux conséquences, et ce module les tient toutes les deux :
 *
 *  - **la couverture est DÉCLARÉE, jamais sondée.** Demander une tuile absente reviendrait à
 *    recevoir la page SPA en HTTP 200 (`firebase.json` réécrit toute adresse inconnue), donc à
 *    chercher une erreur là où il n'y en a pas. On calcule la tuile à demander à partir du
 *    manifeste, et on ne demande rien d'autre ;
 *  - **une tuile d'imagerie fine lit un SOUS-RECTANGLE de sa tuile de hauteurs ancêtre**, à
 *    l'échantillon près, sans interpolation : les deux grilles sont alignées par construction
 *    (registre grille, 2^n échantillons par côté plus un), ce qui garantit aussi que deux
 *    carreaux voisins partagent exactement les mêmes hauteurs sur leur bord commun.
 */
import {
  tileBounds,
  type TileBounds,
  type TileIndex,
  type TileMatrixShape,
  WMTS_EQUIRECTANGULAR_2x1,
} from './tilePyramid';

/** Une entrée de couverture du manifeste : les niveaux cuits, et où. */
export interface HeightCoverageEntry {
  /** Niveaux réellement cuits pour cette entrée, croissants. */
  levels: readonly number[];
  /** Emprise cuite. Absente pour le socle global. */
  bounds?: TileBounds;
  /** Nom publié de l'aire, quand c'en est une (répertoire de nomenclature de l'UAI). */
  areaName?: string;
}

/** La tuile de hauteurs retenue, et l'entrée de couverture qui la fournit. */
export interface HeightSource {
  index: TileIndex;
  entry: HeightCoverageEntry;
}

/**
 * Tuile de hauteurs à employer pour une tuile d'imagerie, ou `null` si rien ne la couvre.
 *
 * On ne retient qu'un niveau INFÉRIEUR OU ÉGAL à celui de l'imagerie : un niveau plus fin
 * couvrirait le quart du carreau, et il en faudrait quatre. À couverture égale, le niveau le
 * plus fin gagne — c'est ce qui fait qu'une aire nommée l'emporte sur le socle.
 */
export function heightTileFor(
  imagery: TileIndex,
  coverage: readonly HeightCoverageEntry[]
): HeightSource | null {
  let best: { level: number; entry: HeightCoverageEntry } | null = null;
  for (const entry of coverage) {
    if (entry.bounds && !containsTile(entry.bounds, imagery)) continue;
    for (const level of entry.levels) {
      if (level > imagery.level) continue;
      if (best === null || level > best.level) best = { level, entry };
    }
  }
  if (best === null) return null;
  const shift = imagery.level - best.level;
  return {
    index: {
      level: best.level,
      row: Math.floor(imagery.row / 2 ** shift),
      column: Math.floor(imagery.column / 2 ** shift),
    },
    entry: best.entry,
  };
}

/** L'emprise d'une tuile d'imagerie tient-elle ENTIÈREMENT dans une emprise cuite ? */
export function containsTile(
  bounds: TileBounds,
  imagery: TileIndex,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): boolean {
  const tile = tileBounds(imagery, shape);
  // Tolérance d'un millionième de degré : les bornes viennent d'un JSON et les emprises d'un
  // calcul en virgule flottante, et un carreau qui touche exactement le bord de l'aire doit
  // être accepté (c'est le cas de tous les carreaux de bord, par construction).
  const epsilon = 1e-6;
  return (
    tile.west >= bounds.west - epsilon &&
    tile.east <= bounds.east + epsilon &&
    tile.south >= bounds.south - epsilon &&
    tile.north <= bounds.north + epsilon
  );
}

/** Le sous-rectangle d'échantillons qu'une tuile d'imagerie occupe dans sa tuile de hauteurs. */
export interface HeightWindow {
  /** Colonne et ligne du premier échantillon, dans la tuile de hauteurs. */
  x0: number;
  y0: number;
  /** Intervalles couverts : le rectangle compte donc `span + 1` échantillons par côté. */
  span: number;
}

/**
 * Place d'une tuile d'imagerie dans sa tuile de hauteurs, en échantillons.
 *
 * `null` quand la tuile d'imagerie est plus fine que ce que la tuile de hauteurs peut découper
 * (moins d'un intervalle par carreau) : mieux vaut un carreau plat qu'un relief interpolé qui
 * prétendrait une finesse absente de la source.
 */
export function heightWindow(
  imagery: TileIndex,
  height: TileIndex,
  samples: number
): HeightWindow | null {
  const shift = imagery.level - height.level;
  if (shift < 0) return null;
  const factor = 2 ** shift;
  const span = (samples - 1) / factor;
  if (!Number.isInteger(span) || span < 1) return null;
  return {
    x0: (imagery.column - height.column * factor) * span,
    y0: (imagery.row - height.row * factor) * span,
    span,
  };
}

/**
 * Nombre de segments du maillage d'un carreau : le plus grand diviseur de `span` par puissance
 * de deux qui reste sous le plafond.
 *
 * Diviser par une puissance de deux garantit que les sommets retenus tombent EXACTEMENT sur des
 * échantillons de hauteur, donc que deux carreaux voisins gardent le même bord.
 */
export function patchSegments(span: number, cap: number): number {
  let segments = Math.max(1, span);
  while (segments > cap && segments % 2 === 0) segments /= 2;
  return Math.max(1, segments);
}
