/**
 * LES ANCÊTRES DE REPLI (GAL-SURFACE-MULTILOD-001) : quels carreaux GROSSIERS montrer sous les feuilles
 * voulues que rien ne couvre encore. Pur, sans Three.js.
 *
 * Mesuré sur un parcours reproductible (`scripts/measure-surface-continuity.mjs`) : pendant une descente
 * vers Rome, la moitié des carreaux voulus restaient découverts (la texture globale se voyait à leur
 * place) pendant 16,6 s ; une feuille absente sans parent posé laisse voir un saut de finesse de
 * plusieurs niveaux quand elle arrive. Son ancêtre `levels` niveaux plus haut couvre aussi ses voisines
 * (4^levels feuilles) et reste valable d'un cran de molette à l'autre : le demander d'abord (ou le
 * reprendre parmi les carreaux retenus, sans requête) referme le trou plus tôt et réduit le saut.
 *
 * Règles : jamais plus grossier que le premier niveau peint (un carreau plus grossier que la texture
 * livrée du corps dégraderait la vue) ; une feuille déjà posée, ou couverte par un carreau posé franc
 * (parent gardé, enfant déjà là), n'en demande pas ; un ancêtre qui est lui-même une feuille voulue
 * n'est pas compté deux fois ; au plus `max` ancêtres (mémoire graphique bornée).
 */
import type { TileIndex } from './tilePyramid';

const keyOf = (index: TileIndex): string =>
  `${index.level}/${index.row}/${index.column}`;

/** Le carreau `coarse` contient-il `fine` (ou l'inverse) ? */
export function tilesOverlap(a: TileIndex, b: TileIndex): boolean {
  const [coarse, fine] = a.level <= b.level ? [a, b] : [b, a];
  const k = 2 ** (fine.level - coarse.level);
  return (
    Math.floor(fine.row / k) === coarse.row &&
    Math.floor(fine.column / k) === coarse.column
  );
}

/** L'ancêtre d'un carreau au niveau `level` (plus grossier ou égal). */
export function ancestorAt(index: TileIndex, level: number): TileIndex {
  const k = 2 ** (index.level - level);
  return {
    level,
    row: Math.floor(index.row / k),
    column: Math.floor(index.column / k),
  };
}

export interface FallbackOptions {
  /** Feuilles voulues par la sélection, dans son ordre. */
  leaves: readonly TileIndex[];
  /** La feuille est-elle déjà posée ? */
  painted(index: TileIndex): boolean;
  /** Carreaux posés FRANCS (ni retenus, ni en fondu) de la génération courante. */
  solid: readonly TileIndex[];
  firstDrawableLevel: number;
  /** Niveaux au-dessus de la feuille (0 : aucun repli). */
  levels: number;
  max: number;
}

export function fallbackAncestors(options: FallbackOptions): TileIndex[] {
  const { leaves, painted, solid, firstDrawableLevel, levels, max } = options;
  if (levels <= 0 || max <= 0) return [];
  const leafKeys = new Set(leaves.map(keyOf));
  const out: TileIndex[] = [];
  const seen = new Set<string>();
  for (const leaf of leaves) {
    if (painted(leaf)) continue;
    if (solid.some((p) => tilesOverlap(leaf, p))) continue;
    const level = Math.max(firstDrawableLevel, leaf.level - levels);
    if (level >= leaf.level) continue;
    const ancestor = ancestorAt(leaf, level);
    const key = keyOf(ancestor);
    if (seen.has(key) || leafKeys.has(key)) continue;
    seen.add(key);
    out.push(ancestor);
    if (out.length >= max) break;
  }
  return out;
}
