/**
 * QUELLE SOURCE SERT UNE TUILE QUAND UNE IMAGERIE RÉGIONALE EXISTE (lot 53, pas 4). Module pur.
 *
 * Une imagerie nationale (l'orthophoto de l'IGN, 20 cm) est bien plus fine que l'imagerie de base,
 * mais ne couvre que son pays. Servie par un WMS, elle se demande sur N'IMPORTE quelle emprise,
 * donc sur la grille de la base, quelle qu'elle soit (GIBS par défaut, Sentinel-2 en variante) :
 * le relief, aligné sur cette grille, reste juste.
 *
 * LA COUVERTURE est écrite en DEGRÉS par `scripts/generate-regional-coverage.mjs` : des boîtes
 * carrées (centre dans le pays, aucun autre pays touché, marge comprise), rangées en plages de
 * colonnes par ligne. Une tuile est régionale si TOUTES les boîtes qu'elle touche sont couvertes.
 *
 * LA RÈGLE : au-delà du maximum de la base, une tuile se SUBDIVISE si elle touche la couverture
 * régionale, et elle est SERVIE par la source régionale si elle y est entièrement ; sinon elle
 * montre le morceau qui lui revient de l'image de son ancêtre au niveau maximal de la base
 * (`baseCrop`). La règle précédente exigeait qu'une tuile soit entièrement couverte pour se
 * subdiviser : une tuile de 2,25° qui touchait la baie de Seine ne l'était jamais, et Paris, sous
 * elle, restait à 500 m par pixel (vu en CI, run 38990592821). Le niveau maximal régional se
 * DÉRIVE de la finesse publiée de la source et de la grille de la base, jamais d'un nombre recopié.
 */
import {
  pixelsPerDegree,
  tileBounds,
  type TileIndex,
  type TileMatrixShape,
} from './tilePyramid';

/** Couverture d'une imagerie régionale, telle que le générateur l'écrit. */
export interface RegionalCoverage {
  /** Côté d'une boîte, en degrés ; boîtes indexées depuis −180° est et +90° nord. */
  readonly boxDeg: number;
  /** Ligne → plages de colonnes `[début, fin]` incluses. */
  readonly rows: Readonly<
    Record<string, readonly (readonly [number, number])[]>
  >;
}

/** Une imagerie régionale branchée sur une base. */
export interface RegionalSource {
  readonly coverage: RegionalCoverage;
  /** Finesse publiée de la source, en pixels par degré. */
  readonly publishedPixelsPerDegree: number;
}

const EPSILON = 1e-9;

type Bounds = { west: number; south: number; east: number; north: number };

/** Lignes et colonnes de boîtes que touche cette emprise. */
function boxSpan(bounds: Bounds, step: number) {
  return {
    r0: Math.floor((90 - bounds.north + EPSILON) / step),
    r1: Math.floor((90 - bounds.south - EPSILON) / step),
    c0: Math.floor((bounds.west + 180 + EPSILON) / step),
    c1: Math.floor((bounds.east + 180 - EPSILON) / step),
  };
}

/**
 * Toutes les boîtes que touche cette emprise sont-elles couvertes ? Calculé PAR PLAGES, ligne par
 * ligne, jamais boîte par boîte : appelé pour chaque nœud de la sélection à chaque image, le
 * parcours boîte par boîte coûtait 3,4 s sur 10 au fil principal près du sol de la Terre, sous
 * frein CPU × 4 (une tuile de 2,25° touche ~2 600 boîtes ; mesuré le 2026-10-17, lot 54).
 */
export function coversBounds(
  bounds: Bounds,
  coverage: RegionalCoverage
): boolean {
  const { r0, r1, c0, c1 } = boxSpan(bounds, coverage.boxDeg);
  for (let r = r0; r <= r1; r += 1) {
    // Les plages d'une ligne sont triées ; deux plages contiguës se recollent.
    let reached = c0 - 1;
    for (const [from, to] of coverage.rows[String(r)] ?? []) {
      if (from > reached + 1) break;
      if (to > reached) reached = to;
      if (reached >= c1) break;
    }
    if (reached < c1) return false;
  }
  return true;
}

/** Au moins une des boîtes que touche cette emprise est-elle couverte ? Par plages, idem. */
export function touchesCoverage(
  bounds: Bounds,
  coverage: RegionalCoverage
): boolean {
  const { r0, r1, c0, c1 } = boxSpan(bounds, coverage.boxDeg);
  for (let r = r0; r <= r1; r += 1)
    for (const [from, to] of coverage.rows[String(r)] ?? [])
      if (from <= c1 && to >= c0) return true;
  return false;
}

/**
 * Le niveau de la grille de base dont la finesse atteint celle de la source régionale : au-delà,
 * on n'agrandirait plus que ses pixels.
 */
export function regionalMaxLevel(
  shape: TileMatrixShape,
  publishedPixelsPerDegree: number
): number {
  // La finesse d'un niveau vient de `tilePyramid`, qui connaît le niveau de référence d'une grille
  // (celle de GIBS ne double qu'à partir du sien) : aucune formule recopiée ici.
  let level = shape.referenceLevel ?? 0;
  while (level < 40 && pixelsPerDegree(level, shape) < publishedPixelsPerDegree)
    level += 1;
  return level;
}

/** Le niveau maximal sélectionnable pour une tuile, base ou région selon la couverture. */
export function maxLevelFor(
  index: TileIndex,
  shape: TileMatrixShape,
  baseMaxLevel: number,
  region: RegionalSource | null
): number {
  if (!region || index.level < baseMaxLevel) return baseMaxLevel;
  const regional = regionalMaxLevel(shape, region.publishedPixelsPerDegree);
  if (regional <= baseMaxLevel) return baseMaxLevel;
  return touchesCoverage(tileBounds(index, shape), region.coverage)
    ? regional
    : baseMaxLevel;
}

/**
 * La tuile est-elle servie par la source régionale ? Au-delà de la base ET entièrement dans la
 * couverture : une tuile à cheval montrerait, hors du pays, l'image blanche que l'IGN y rend.
 */
export function servedByRegion(
  index: TileIndex,
  shape: TileMatrixShape,
  baseMaxLevel: number,
  region: RegionalSource | null
): boolean {
  return (
    region !== null &&
    index.level > baseMaxLevel &&
    coversBounds(tileBounds(index, shape), region.coverage)
  );
}

/**
 * Une tuile au-delà de la base que la région ne sert pas : l'image de son ANCÊTRE au niveau
 * maximal de la base, et la transformation de coordonnées de texture qui n'en garde que son
 * morceau (`offset` + `repeat` de Three.js, v croissant vers le nord comme dans `tilePatch`).
 */
export function baseCrop(
  index: TileIndex,
  baseMaxLevel: number
): {
  ancestor: TileIndex;
  offset: [number, number];
  repeat: number;
} | null {
  const depth = index.level - baseMaxLevel;
  if (depth <= 0) return null;
  const n = 2 ** depth;
  const ancestor = {
    level: baseMaxLevel,
    row: Math.floor(index.row / n),
    column: Math.floor(index.column / n),
  };
  const subRow = index.row - ancestor.row * n;
  const subColumn = index.column - ancestor.column * n;
  return {
    ancestor,
    offset: [subColumn / n, (n - 1 - subRow) / n],
    repeat: 1 / n,
  };
}
