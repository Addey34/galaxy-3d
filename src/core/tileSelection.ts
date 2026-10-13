/**
 * QUELS CARREAUX PEINDRE, ET À QUEL NIVEAU CHACUN (lot 48, pas 5, 2026-10-13).
 *
 * Jusqu'ici le moteur de surface peignait UN niveau, dans une fenêtre centrée sous la caméra et
 * taillée par le champ : juste pour une vue verticale, où tout le sol visible est à la même
 * distance. La caméra regarde désormais l'horizon près du sol (`core/horizonTilt.ts`) : le sol
 * visible va alors de quelques kilomètres à quelques centaines, et un niveau unique est soit trop
 * grossier sous les pieds, soit impossible à payer jusqu'à l'horizon. Mesuré au-dessus du massif
 * du Mont-Blanc, à 50 km d'altitude : un îlot de relief fin posé sur une plaine floue et plate.
 *
 * D'où un QUADTREE. On part des carreaux du niveau de référence de la grille, et l'on subdivise,
 * le plus GROSSI d'abord, tout carreau visible dont un texel couvre plus d'un pixel d'écran au
 * point le plus proche de la caméra (la règle « un pixel pour un pixel » que le moteur appliquait
 * déjà au nadir), tant que le budget de carreaux peints le permet. Les feuilles ne se
 * recouvrent jamais : le sol proche est fin, l'horizon grossier, et rien n'est peint deux fois.
 *
 * Un carreau plus grossier que la texture LIVRÉE du corps ne se peint pas (règle du moteur depuis
 * le 2026-09-21 : il dégraderait la vue), mais il se subdivise s'il le faut ; une feuille assez
 * fine sous ce seuil laisse simplement voir la sphère livrée.
 *
 * Le module ne connaît ni Three.js ni la caméra : la visibilité et le grossissement d'un carreau
 * sont des questions qu'il POSE ({@link TileView}), et le moteur y répond avec sa géométrie.
 */
import {
  tileMatrix,
  type TileIndex,
  type TileMatrixShape,
} from './tilePyramid';

/** Ce que le moteur sait d'un carreau dans la vue courante. */
export interface TileView {
  /** Le carreau a-t-il au moins un point dans le champ et au-dessus de l'horizon ? */
  visible(index: TileIndex): boolean;
  /** Pixels d'écran couverts par un texel de ce carreau, au point le plus proche de la caméra. */
  pixelsPerTexel(index: TileIndex): number;
}

export interface TileSelectionOptions {
  shape: TileMatrixShape;
  /** Niveau le plus fin publié par la mosaïque. */
  maxLevel: number;
  /**
   * Niveau le plus grossier qui se PEINT : le plus haut du niveau minimal de la fiche et du
   * premier niveau plus fin que la texture livrée du corps.
   */
  firstDrawableLevel: number;
  /** Carreaux peints au plus (profil de qualité). */
  maxTiles: number;
}

interface Node {
  index: TileIndex;
  pixelsPerTexel: number;
}

const childrenOf = (index: TileIndex): TileIndex[] => {
  const level = index.level + 1;
  const out: TileIndex[] = [];
  for (let dRow = 0; dRow < 2; dRow += 1)
    for (let dColumn = 0; dColumn < 2; dColumn += 1)
      out.push({
        level,
        row: index.row * 2 + dRow,
        column: index.column * 2 + dColumn,
      });
  return out;
};

/**
 * Les feuilles à peindre, la plus FINE d'abord (le moteur les demande dans cet ordre : le sol
 * sous les pieds avant l'horizon). Pas la plus grossie : budget épuisé, un carreau grossier loin
 * peut l'être davantage que le carreau fin sous la caméra.
 */
export function selectTiles(
  view: TileView,
  options: TileSelectionOptions
): TileIndex[] {
  const { shape, maxLevel, firstDrawableLevel, maxTiles } = options;
  if (maxTiles <= 0 || firstDrawableLevel > maxLevel) return [];
  const root = tileMatrix(shape.referenceLevel ?? 0, shape);
  const visit = (index: TileIndex): Node | null =>
    view.visible(index)
      ? { index, pixelsPerTexel: view.pixelsPerTexel(index) }
      : null;
  const drawable = (node: Node) => node.index.level >= firstDrawableLevel;

  let nodes: Node[] = [];
  for (let row = 0; row < root.rows; row += 1)
    for (let column = 0; column < root.columns; column += 1) {
      const node = visit({ level: root.level, row, column });
      if (node) nodes.push(node);
    }

  // Un carreau trop grossier pour être peint, et assez fin pour l'écran : la sphère livrée,
  // plus fine que lui, suffit là. On ne le garde pas.
  const settled = (node: Node) => !drawable(node) && node.pixelsPerTexel <= 1;
  nodes = nodes.filter((node) => !settled(node));

  let painted = nodes.filter(drawable).length;
  for (;;) {
    let best = -1;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]!;
      if (node.index.level >= maxLevel) continue;
      // Un carreau non peignable se subdivise toujours ; un carreau peint, s'il est grossi.
      if (drawable(node) && node.pixelsPerTexel <= 1) continue;
      if (best < 0 || node.pixelsPerTexel > nodes[best]!.pixelsPerTexel)
        best = i;
    }
    if (best < 0) break;
    const parent = nodes[best]!;
    const children = childrenOf(parent.index)
      .map(visit)
      .filter((node): node is Node => node !== null && !settled(node));
    const next =
      painted - (drawable(parent) ? 1 : 0) + children.filter(drawable).length;
    if (next > maxTiles) break;
    nodes.splice(best, 1, ...children);
    painted = next;
  }

  return nodes
    .filter(drawable)
    .sort(
      (a, b) =>
        b.index.level - a.index.level || b.pixelsPerTexel - a.pixelsPerTexel
    )
    .map((node) => node.index);
}
