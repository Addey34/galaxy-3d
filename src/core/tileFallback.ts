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

/**
 * L'INDEX DE COUVERTURE d'un ensemble de carreaux posés : en temps proportionnel à (carreaux × profondeur),
 * et non au produit des deux listes. La première version comparait chaque feuille à chaque carreau posé :
 * ~6 ms par passe pour 512 feuilles et 500 carreaux sur un PC rapide (mesuré le 2026-11-26), bien plus sur un
 * processeur lent ou un téléphone, à chaque passe du moteur (régression de GAL-SURFACE-MULTILOD-001, trouvée
 * par la CI de `main`).
 */
export interface CoverageIndex {
  /** Niveau du carreau posé le plus fin qui contient `index` (lui compris), ou `null`. */
  coarserOrSelf(index: TileIndex): number | null;
  /** Un carreau posé PLUS FIN est-il à l'intérieur de `index` ? */
  hasFiner(index: TileIndex): boolean;
}

/**
 * `floorLevel` : aucun carreau ne se pose ni ne se demande plus grossier (le premier niveau peint) ; les
 * ancêtres sous lui ne sont ni indexés ni cherchés.
 */
export function coverageIndex(
  solid: readonly TileIndex[],
  floorLevel = 0
): CoverageIndex {
  const own = new Set<string>();
  const inside = new Set<string>();
  let lowest = Number.POSITIVE_INFINITY;
  for (const p of solid) {
    own.add(keyOf(p));
    lowest = Math.min(lowest, p.level);
    for (let level = p.level - 1; level >= floorLevel; level -= 1)
      inside.add(keyOf(ancestorAt(p, level)));
  }
  return {
    coarserOrSelf(index) {
      for (let level = index.level; level >= lowest; level -= 1)
        if (own.has(keyOf(ancestorAt(index, level)))) return level;
      return null;
    },
    hasFiner(index) {
      return inside.has(keyOf(index));
    },
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
  const covered = coverageIndex(solid, firstDrawableLevel);
  const out: TileIndex[] = [];
  const seen = new Set<string>();
  for (const leaf of leaves) {
    if (painted(leaf)) continue;
    if (covered.coarserOrSelf(leaf) !== null || covered.hasFiner(leaf))
      continue;
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
