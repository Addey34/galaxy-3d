/**
 * GÉOMÉTRIE D'UNE PYRAMIDE DE TUILES ÉQUIRECTANGULAIRE — module pur, testé, sans réseau et
 * sans Three.js (lot 9, phase 9C).
 *
 * C'est l'arithmétique qui décide QUELLE tuile est demandée, et à quel niveau. Elle vit ici
 * plutôt qu'en ligne dans le moteur pour la même raison que `core/surfaceApproach.ts` : un
 * niveau mal choisi ne se voit pas (l'image est simplement trop floue ou trop lourde), et une
 * ligne mal calculée produit un 404 que le navigateur rapporte comme un refus CORS
 * (`core/tileUrl.ts`, piège 2 du plan du lot).
 *
 * La pyramide décrite est celle que NASA Trek publie dans ses capacités WMTS, et elle est
 * RECOPIÉE de ce document, jamais devinée : coin supérieur gauche (−180°, +90°), tuiles de
 * 256 px, et au niveau L une matrice de `2^(L+1)` colonnes sur `2^L` lignes — donc deux tuiles
 * carrées côte à côte au niveau 0, qui couvrent bien 360° × 180°. Les deux constantes du haut
 * décrivent cette famille ; une source qui en emploierait une autre la déclare dans sa fiche.
 *
 * Convention de signe, à ne pas inventer une seconde fois : la LIGNE croît vers le SUD (ligne 0
 * au nord), la COLONNE croît vers l'EST (colonne 0 à −180°). C'est celle de WMTS, et c'est aussi
 * celle d'une image équirectangulaire standard, donc celle des textures du dépôt.
 */

/** Forme d'une matrice de tuiles, telle qu'une fiche de jeu de tuiles la déclare. */
export interface TileMatrixShape {
  /** Colonnes au niveau 0 (2 pour une pyramide équirectangulaire 2:1). */
  columnsAtLevelZero: number;
  /** Lignes au niveau 0 (1 pour une pyramide équirectangulaire 2:1). */
  rowsAtLevelZero: number;
  /** Côté d'une tuile, en pixels. */
  tileSizePx: number;
}

/** La forme publiée par Trek dans ses capacités WMTS (jeu `default028mm`). */
export const WMTS_EQUIRECTANGULAR_2x1: TileMatrixShape = {
  columnsAtLevelZero: 2,
  rowsAtLevelZero: 1,
  tileSizePx: 256,
};

/** Une tuile, désignée par son niveau et sa place dans la matrice de ce niveau. */
export interface TileIndex {
  level: number;
  /** 0 au nord, croissante vers le sud. */
  row: number;
  /** 0 à −180°, croissante vers l'est. */
  column: number;
}

/** Emprise géographique, en degrés. */
export interface TileBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

/** Dimensions de la matrice d'un niveau. */
export interface TileMatrix {
  level: number;
  columns: number;
  rows: number;
}

/** Matrice d'un niveau : les dimensions doublent à chaque niveau, dans les deux sens. */
export function tileMatrix(
  level: number,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): TileMatrix {
  const factor = Math.pow(2, Math.max(0, Math.floor(level)));
  return {
    level: Math.max(0, Math.floor(level)),
    columns: shape.columnsAtLevelZero * factor,
    rows: shape.rowsAtLevelZero * factor,
  };
}

/** Largeur de la mosaïque entière à ce niveau, en pixels sur 360° de longitude. */
export function pyramidWidthPx(
  level: number,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): number {
  return tileMatrix(level, shape).columns * shape.tileSizePx;
}

/** Degrés de longitude couverts par un pixel à ce niveau. */
export function degreesPerPixel(
  level: number,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): number {
  return 360 / pyramidWidthPx(level, shape);
}

/** Pixels par degré à ce niveau : l'unité dans laquelle les mosaïques Trek sont publiées. */
export function pixelsPerDegree(
  level: number,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): number {
  return pyramidWidthPx(level, shape) / 360;
}

/**
 * Taille au sol d'un pixel à l'équateur, en kilomètres. Même identité que
 * `surfaceApproach.groundTexelKm` : une équirectangulaire de W pixels donne `2πr / W`.
 */
export function groundResolutionKm(
  level: number,
  radiusKm: number,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): number {
  const width = pyramidWidthPx(level, shape);
  if (width <= 0 || radiusKm <= 0) return Number.POSITIVE_INFINITY;
  return (2 * Math.PI * radiusKm) / width;
}

/**
 * Facteur de SUR-ÉCHANTILLONNAGE d'un niveau vis-à-vis de la mosaïque publiée.
 *
 * Trek sert la mosaïque WAC jusqu'au niveau 8, soit 364,09 pixels par degré, alors qu'elle est
 * publiée à 303. Le niveau 8 agrandit donc la source d'un facteur 1,20 : le service n'invente
 * rien, mais l'application afficherait une finesse que la source n'a pas si elle se taisait.
 * Au-dessous de 1, le niveau est plus grossier que la source, ce qui est le cas ordinaire.
 */
export function oversamplingFactor(
  level: number,
  publishedPixelsPerDegree: number,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): number {
  if (publishedPixelsPerDegree <= 0) return Number.POSITIVE_INFINITY;
  return pixelsPerDegree(level, shape) / publishedPixelsPerDegree;
}

/** Une tuile appartient-elle bien à la matrice de son niveau ? */
export function isWithinMatrix(
  index: TileIndex,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): boolean {
  if (!Number.isInteger(index.level) || index.level < 0) return false;
  if (!Number.isInteger(index.row) || !Number.isInteger(index.column))
    return false;
  const matrix = tileMatrix(index.level, shape);
  return (
    index.row >= 0 &&
    index.row < matrix.rows &&
    index.column >= 0 &&
    index.column < matrix.columns
  );
}

/** Emprise géographique d'une tuile. */
export function tileBounds(
  index: TileIndex,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): TileBounds {
  const matrix = tileMatrix(index.level, shape);
  const lonStep = 360 / matrix.columns;
  const latStep = 180 / matrix.rows;
  const west = -180 + index.column * lonStep;
  const north = 90 - index.row * latStep;
  return { west, east: west + lonStep, south: north - latStep, north };
}

/**
 * Tuile qui contient un point géographique, au niveau donné.
 *
 * La longitude est ramenée dans [−180, 180[ par modulo (une caméra qui tourne autour du corps
 * franchit l'antiméridien sans cesse), et la latitude est BORNÉE : le pôle exact tomberait sur
 * `rows`, qui n'existe pas. Ce n'est pas un traitement des pôles — le plan le réserve à 9D avec
 * la géométrie — c'est simplement le refus d'un indice hors matrice.
 */
export function tileIndexAt(
  level: number,
  latitudeDeg: number,
  longitudeDeg: number,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): TileIndex {
  const matrix = tileMatrix(level, shape);
  const lon = ((((longitudeDeg + 180) % 360) + 360) % 360) - 180;
  const column = Math.min(
    matrix.columns - 1,
    Math.max(0, Math.floor(((lon + 180) / 360) * matrix.columns))
  );
  const row = Math.min(
    matrix.rows - 1,
    Math.max(0, Math.floor(((90 - latitudeDeg) / 180) * matrix.rows))
  );
  return { level: matrix.level, row, column };
}

/**
 * Demi-largeurs, en tuiles, de la fenêtre qui couvre un disque de rayon angulaire donné.
 *
 * Le demi-angle est converti en une demi-largeur de LONGITUDE par `1 / cos(latitude)` : près des
 * pôles, un même angle au sol couvre bien plus de longitude, et une fenêtre carrée en degrés y
 * manquerait le sol visible. Le facteur est borné (sinon il diverge au pôle) et la fenêtre de
 * longitude est plafonnée à la demi-matrice, au-delà de quoi elle ferait le tour deux fois.
 */
function coverageSpans(
  matrix: TileMatrix,
  latitudeDeg: number,
  halfAngleDeg: number
): { rowSpan: number; columnSpan: number } {
  const latStep = 180 / matrix.rows;
  const lonStep = 360 / matrix.columns;
  const cosLat = Math.cos((latitudeDeg * Math.PI) / 180);
  // Borne à 10 : au-delà la fenêtre couvre déjà la matrice entière, et `1/cos` diverge.
  const lonStretch = Math.min(10, 1 / Math.max(0.1, Math.abs(cosLat)));
  return {
    rowSpan: Math.min(matrix.rows, Math.ceil(halfAngleDeg / latStep) + 1),
    columnSpan: Math.min(
      Math.floor(matrix.columns / 2),
      Math.ceil((halfAngleDeg * lonStretch) / lonStep) + 1
    ),
  };
}

/**
 * Combien de tuiles `tilesCovering` demanderait SANS plafond, à ce niveau.
 *
 * Sert à choisir le niveau : on ne descend au niveau que l'écran mérite que si le nombre de
 * tuiles y tient dans le budget, sinon on montre un niveau complet plutôt qu'une fraction du
 * suivant. Compter ici plutôt que de construire puis jeter évite d'allouer 131 072 indices à
 * un niveau profond près d'un pôle.
 */
export function coverageTileCount(
  level: number,
  center: { latitudeDeg: number; longitudeDeg: number },
  halfAngleDeg: number,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): number {
  if (halfAngleDeg < 0) return 0;
  const matrix = tileMatrix(level, shape);
  const { rowSpan, columnSpan } = coverageSpans(
    matrix,
    center.latitudeDeg,
    halfAngleDeg
  );
  // Les lignes sont bornées par la matrice (pas d'enroulement en latitude), les colonnes non.
  const centre = tileIndexAt(
    matrix.level,
    center.latitudeDeg,
    center.longitudeDeg,
    shape
  );
  const rows =
    Math.min(matrix.rows - 1, centre.row + rowSpan) -
    Math.max(0, centre.row - rowSpan) +
    1;
  return rows * (2 * columnSpan + 1);
}

/**
 * Tuiles couvrant un disque de rayon angulaire `halfAngleDeg` autour d'un point, au niveau
 * donné, au plus `maxTiles`.
 *
 * La sortie est ORDONNÉE du centre vers le bord (distance de tuile au centre), pour que le
 * plafond `maxTiles` coupe ce qui est le plus loin du regard plutôt qu'une moitié arbitraire.
 */
export function tilesCovering(
  level: number,
  center: { latitudeDeg: number; longitudeDeg: number },
  halfAngleDeg: number,
  maxTiles: number,
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): TileIndex[] {
  if (maxTiles <= 0 || halfAngleDeg < 0) return [];
  const matrix = tileMatrix(level, shape);
  const centre = tileIndexAt(
    matrix.level,
    center.latitudeDeg,
    center.longitudeDeg,
    shape
  );
  const { rowSpan, columnSpan } = coverageSpans(
    matrix,
    center.latitudeDeg,
    halfAngleDeg
  );

  const tiles: { index: TileIndex; distance: number }[] = [];
  for (let dRow = -rowSpan; dRow <= rowSpan; dRow += 1) {
    const row = centre.row + dRow;
    if (row < 0 || row >= matrix.rows) continue;
    for (let dColumn = -columnSpan; dColumn <= columnSpan; dColumn += 1) {
      // La colonne S'ENROULE : l'antiméridien n'est pas un bord du corps.
      const column =
        (((centre.column + dColumn) % matrix.columns) + matrix.columns) %
        matrix.columns;
      tiles.push({
        index: { level: matrix.level, row, column },
        distance: dRow * dRow + dColumn * dColumn,
      });
    }
  }
  tiles.sort((a, b) => a.distance - b.distance);
  return tiles.slice(0, maxTiles).map((tile) => tile.index);
}

/**
 * Niveau le plus grossier dont un pixel vaut au plus `targetKm` au sol, borné par les niveaux
 * que la source publie.
 *
 * On monte en niveau tant que l'image reste plus grossière que la cible : demander mieux que ce
 * que l'écran distingue coûte des tuiles sans rien montrer, et c'est la même règle que le
 * plancher d'approche de 9B, prise par l'autre bout.
 */
export function levelForGroundResolution(
  radiusKm: number,
  targetKm: number,
  bounds: { minLevel: number; maxLevel: number },
  shape: TileMatrixShape = WMTS_EQUIRECTANGULAR_2x1
): number {
  const min = Math.max(0, Math.floor(bounds.minLevel));
  const max = Math.max(min, Math.floor(bounds.maxLevel));
  if (!(targetKm > 0) || !Number.isFinite(targetKm)) return min;
  for (let level = min; level < max; level += 1) {
    if (groundResolutionKm(level, radiusKm, shape) <= targetKm) return level;
  }
  return max;
}
