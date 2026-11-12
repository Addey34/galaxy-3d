/**
 * ÉQUIVALENCE STRICTE de `selectTiles` avec l'algorithme d'ORIGINE (optimisation du niveau maximal par nœud).
 *
 * `selectTilesReference` est la copie VERBATIM de la fonction avant la mise en cache du niveau
 * maximal par nœud (`maxLevelAt` relu à chaque balayage). La liste ET l'ordre des carreaux doivent
 * être identiques, sur des vues pseudo-aléatoires déterministes.
 */
import { describe, expect, it } from 'vitest';
import {
  selectTiles,
  type TileSelectionOptions,
  type TileView,
} from './tileSelection';
import {
  tileBounds,
  tileMatrix,
  WMTS_EQUIRECTANGULAR_2x1,
  type TileIndex,
  type TileMatrixShape,
} from './tilePyramid';
import {
  maxLevelFor,
  regionalMaxLevel,
  type RegionalSource,
} from './regionalImagery';

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
function selectTilesReference(
  view: TileView,
  options: TileSelectionOptions
): TileIndex[] {
  const { shape, maxLevel, firstDrawableLevel, maxTiles } = options;
  const limit = options.maxLevelAt ?? ((): number => maxLevel);
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
      if (node.index.level >= limit(node.index)) continue;
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

/** Hachage déterministe dans [0, 1[ : une vue ne dépend que de l'indice et de la graine. */
function unit(seed: number, i: TileIndex, salt: number): number {
  let h =
    (seed * 2654435761) ^
    (i.level * 40503) ^
    (i.row * 9973) ^
    (i.column * 7919) ^
    (salt * 104729);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function viewFor(seed: number, nearLevel: number): TileView {
  return {
    visible: (i) => i.level <= 3 || unit(seed, i, 1) < 0.72,
    // Grossissement décroissant avec le niveau, plus fort vers un « nadir » pseudo-aléatoire.
    pixelsPerTexel: (i) =>
      2 ** (nearLevel - i.level) * (0.4 + 2.2 * unit(seed, i, 2)),
  };
}

const SHAPES: TileMatrixShape[] = [
  WMTS_EQUIRECTANGULAR_2x1,
  {
    columnsAtLevelZero: 10,
    rowsAtLevelZero: 5,
    tileSizePx: 512,
    referenceLevel: 3,
  },
];

describe("selectTiles : équivalence stricte avec l'original", () => {
  it('même liste, même ordre, sur 900 vues (budgets, niveaux, plafonds par carreau)', () => {
    let compared = 0;
    let nonTrivial = 0;
    for (let seed = 1; seed <= 150; seed += 1) {
      for (const shape of SHAPES) {
        const ref = shape.referenceLevel ?? 0;
        const maxLevel = ref + 6 + (seed % 5);
        const options = {
          shape,
          maxLevel,
          firstDrawableLevel: ref + (seed % 3),
          maxTiles: [1, 9, 25, 100, 512][seed % 5]!,
        };
        const withLimit: TileSelectionOptions = {
          ...options,
          // Plafond variable par carreau, comme l'imagerie régionale (certains carreaux plus fins).
          maxLevelAt: (i) =>
            unit(seed, i, 3) < 0.5 ? maxLevel : maxLevel + 1 + (seed % 3),
        };
        // Plafond ACTIF : peu de niveaux, budget large, plafond par carreau variable (c'est lui qui
        // arrête la subdivision, pas le budget). Sans cette variante, un plafond mal mis en cache
        // ne change aucune sélection et le test ne prouve rien.
        const tight: TileSelectionOptions = {
          shape,
          maxLevel: ref + 5,
          firstDrawableLevel: ref + (seed % 3),
          maxTiles: 4096,
          maxLevelAt: (i) => ref + 2 + Math.floor(unit(seed, i, 4) * 4),
        };
        for (const opts of [options, withLimit, tight]) {
          const view = viewFor(seed, maxLevel + 1);
          const got = selectTiles(view, opts);
          const want = selectTilesReference(view, opts);
          expect(got).toEqual(want);
          compared += 1;
          if (want.length > 8) nonTrivial += 1;
        }
      }
    }
    expect(compared).toBe(900);
    // Le test ne vaut que si les sélections ne sont pas toutes vides.
    expect(nonTrivial).toBeGreaterThan(300);
  });

  it("maxLevelAt est lu au plus une fois par carreau (l'original le relisait à chaque balayage)", () => {
    const shape = WMTS_EQUIRECTANGULAR_2x1;
    const view = viewFor(7, 9);
    const calls = new Map<string, number>();
    const options: TileSelectionOptions = {
      shape,
      maxLevel: 8,
      firstDrawableLevel: 2,
      maxTiles: 256,
      maxLevelAt: (i) => {
        const key = `${i.level}/${i.row}/${i.column}`;
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return 8;
      },
    };
    const got = selectTiles(view, options);
    expect(got.length).toBeGreaterThan(50);
    expect(Math.max(...calls.values())).toBe(1);
    // Falsification : l'original, lui, relit les mêmes carreaux plusieurs fois.
    calls.clear();
    selectTilesReference(view, options);
    expect(Math.max(...calls.values())).toBeGreaterThan(5);
  });
});

describe("maxLevelFor : niveau régional passé par l'appelant", () => {
  const shape = WMTS_EQUIRECTANGULAR_2x1;
  const coverage = {
    boxDeg: 1,
    rows: {
      '40': [[182, 183]] as [number, number][],
      '41': [[180, 185]] as [number, number][],
    },
  };
  const source: RegionalSource = {
    coverage,
    publishedPixelsPerDegree: 372_800,
  };

  it('rend la même valeur avec ou sans `regionalLevel`, pour tous les carreaux', () => {
    const regional = regionalMaxLevel(shape, source.publishedPixelsPerDegree);
    let touched = 0;
    for (let level = 0; level <= regional + 1; level += 1) {
      const m = tileMatrix(level, shape);
      // Une fenêtre de 13 x 13 carreaux autour d'un point de la couverture (49,5 N, 2,5 E).
      const row0 = Math.floor(((90 - 49.5) / 180) * m.rows);
      const column0 = Math.floor(((2.5 + 180) / 360) * m.columns);
      for (
        let row = Math.max(0, row0 - 6);
        row <= Math.min(m.rows - 1, row0 + 6);
        row += 1
      )
        for (
          let column = Math.max(0, column0 - 6);
          column <= Math.min(m.columns - 1, column0 + 6);
          column += 1
        ) {
          const index = { level, row, column };
          for (const base of [regional - 2, regional - 1, regional]) {
            const a = maxLevelFor(index, shape, base, source);
            const b = maxLevelFor(index, shape, base, source, regional);
            expect(b).toBe(a);
            if (a > base) touched += 1;
          }
        }
    }
    expect(touched).toBeGreaterThan(0);
  });
  it('sans région, ou sous le niveau de base, rien ne change', () => {
    const regional = regionalMaxLevel(shape, source.publishedPixelsPerDegree);
    expect(
      maxLevelFor({ level: 3, row: 0, column: 0 }, shape, 8, null, regional)
    ).toBe(8);
    expect(
      maxLevelFor({ level: 3, row: 0, column: 0 }, shape, 8, source, regional)
    ).toBe(8);
  });
});

/**
 * Vue GÉOGRAPHIQUE : visible près d'un point (longitude enroulée, donc l'antiméridien et les pôles
 * comptent), grossissement ÉTAGÉ par bandes de 2 degrés : les carreaux d'une même bande ont des
 * grossissements strictement égaux (ex æquo en abondance, c'est ce qui exerce la règle de
 * départage de la boucle : le premier de la liste gagne).
 */
function geoView(
  shape: TileMatrixShape,
  lon0: number,
  lat0: number,
  nearLevel: number,
  radiusDeg: number
): TileView {
  const distance = (i: TileIndex) => {
    const b = tileBounds(i, shape);
    const lat = (b.north + b.south) / 2;
    const dLon =
      (((((b.west + b.east) / 2 - lon0 + 540) % 360) + 360) % 360) - 180;
    const dLat = lat - lat0;
    return Math.hypot(
      dLon * Math.max(0.05, Math.cos((lat * Math.PI) / 180)),
      dLat
    );
  };
  return {
    visible: (i) => {
      const b = tileBounds(i, shape);
      return distance(i) <= radiusDeg + (b.east - b.west);
    },
    // Distance en LARGEURS DE CARREAU, arrondie : tous les carreaux d'un même niveau à moins d'une
    // largeur du point ont EXACTEMENT le même grossissement (ex æquo), et il décroît par paliers
    // avec l'éloignement, de sorte que la subdivision descend jusqu'aux plafonds près du point.
    pixelsPerTexel: (i) => {
      const b = tileBounds(i, shape);
      const away = Math.floor(distance(i) / (b.east - b.west));
      return 2 ** (nearLevel - i.level) / (1 + 1e7 * away * away);
    },
  };
}

/** Couverture de test : 0 à 5 degrés E, 46 à 51 degrés N (boîtes de 1 degré). */
const IGN_LIKE: RegionalSource = {
  publishedPixelsPerDegree: 372_800,
  coverage: {
    boxDeg: 1,
    rows: Object.fromEntries(
      [39, 40, 41, 42, 43].map((r) => [String(r), [[180, 184]]])
    ) as Record<string, [number, number][]>,
  },
};

const sameList = (a: TileIndex[], b: TileIndex[]) =>
  a.length === b.length &&
  a.every(
    (t, k) =>
      t.level === b[k]!.level &&
      t.row === b[k]!.row &&
      t.column === b[k]!.column
  );

describe("selectTiles : scénarios ciblés contre l'original", () => {
  it('frontières IGN et transitions couverture / base, ex æquo, budgets saturés', () => {
    let compared = 0;
    let regionalDiffersFromBase = 0;
    let ties = 0;
    const centres: [number, number][] = [
      [2.35, 48.85], // dedans
      [0, 48], // bord ouest
      [5, 48], // bord est
      [2.5, 51], // bord nord
      [2.5, 46], // bord sud
      [-3, 48.85], // dehors, à 3 degrés
      [10, 40], // loin
    ];
    for (const shape of SHAPES) {
      const regional = regionalMaxLevel(
        shape,
        IGN_LIKE.publishedPixelsPerDegree
      );
      for (const base of [regional - 6, regional - 3]) {
        for (const [lon, lat] of centres) {
          for (const maxTiles of [1, 4, 25, 462]) {
            const view = geoView(shape, lon, lat, regional + 1, 6);
            const common = {
              shape,
              maxLevel: Math.max(base, regional),
              firstDrawableLevel: (shape.referenceLevel ?? 0) + 1,
              maxTiles,
            };
            // OBTENU : la forme du moteur (niveau régional passé), l'original : la forme historique.
            const got = selectTiles(view, {
              ...common,
              maxLevelAt: (i) =>
                maxLevelFor(i, shape, base, IGN_LIKE, regional),
            });
            const want = selectTilesReference(view, {
              ...common,
              maxLevelAt: (i) => maxLevelFor(i, shape, base, IGN_LIKE),
            });
            expect(sameList(got, want)).toBe(true);
            compared += 1;
            // Même vue SANS région (hors couverture ou autre jeu) : rien ne doit fuir d'un appel à l'autre.
            const noRegion = { ...common, maxLevel: base };
            const g2 = selectTiles(view, noRegion);
            expect(sameList(g2, selectTilesReference(view, noRegion))).toBe(
              true
            );
            if (!sameList(got, g2)) regionalDiffersFromBase += 1;
            // Des ex æquo existent-ils parmi les candidats ? (au moins deux feuilles de même niveau et de même grossissement)
            const seen = new Set<string>();
            for (const t of got) {
              const k = `${t.level}:${view.pixelsPerTexel(t)}`;
              if (seen.has(k)) ties += 1;
              seen.add(k);
            }
          }
        }
      }
    }
    expect(compared).toBe(2 * 2 * 7 * 4);
    // La couverture doit changer la sélection quelque part, et les ex æquo doivent exister.
    expect(regionalDiffersFromBase).toBeGreaterThan(10);
    expect(ties).toBeGreaterThan(200);
  });

  it('antiméridien et pôles : liste et ordre identiques, ex æquo, plafonds par carreau', () => {
    let compared = 0;
    let nonTrivial = 0;
    const centres: [number, number][] = [
      [180, 0],
      [179.9, 10],
      [-179.9, -10],
      [-180, 45],
      [0, 89.9],
      [100, -89.9],
      [0, 0],
    ];
    for (const shape of SHAPES) {
      const ref = shape.referenceLevel ?? 0;
      for (const [lon, lat] of centres) {
        for (const maxTiles of [1, 3, 16, 128]) {
          for (const variant of [0, 1, 2]) {
            const maxLevel = ref + 7;
            const view = geoView(shape, lon, lat, maxLevel + 1, 20);
            const opts: TileSelectionOptions = {
              shape,
              maxLevel,
              firstDrawableLevel: ref + (variant % 2),
              maxTiles,
              ...(variant > 0
                ? {
                    // Plafonds différents entre nœuds, certains plus bas que le niveau courant des voisins.
                    maxLevelAt: (i: TileIndex) =>
                      ref +
                      2 +
                      Math.floor(unit(variant * 31 + maxTiles, i, 5) * 6),
                  }
                : {}),
            };
            const got = selectTiles(view, opts);
            const want = selectTilesReference(view, opts);
            expect(sameList(got, want)).toBe(true);
            compared += 1;
            if (want.length > 4) nonTrivial += 1;
          }
        }
      }
    }
    expect(compared).toBe(2 * 7 * 4 * 3);
    expect(nonTrivial).toBeGreaterThan(80);
  });

  it('changement de jeu, de niveau maximal et de couverture entre deux appels : aucun plafond ne survit', () => {
    const shape = WMTS_EQUIRECTANGULAR_2x1;
    const regional = regionalMaxLevel(shape, IGN_LIKE.publishedPixelsPerDegree);
    const view = geoView(shape, 2.35, 48.85, regional + 1, 6);
    // UN SEUL `maxLevelAt` dont la reponse change entre appels (couverture / jeu change) : si la
    // sélection gardait un plafond d'un appel à l'autre, le deuxième appel serait faux.
    let source: RegionalSource | null = IGN_LIKE;
    let base = regional - 4;
    const maxLevelAt = (i: TileIndex) =>
      maxLevelFor(i, shape, base, source, source ? regional : undefined);
    const historic = (i: TileIndex) => maxLevelFor(i, shape, base, source);
    const results: TileIndex[][] = [];
    for (const [s, b, tiles] of [
      [IGN_LIKE, regional - 4, 462],
      [null, regional - 4, 462],
      [IGN_LIKE, regional - 8, 462],
      [IGN_LIKE, regional - 4, 462],
      [null, regional - 8, 30],
    ] as [RegionalSource | null, number, number][]) {
      source = s;
      base = b;
      const common = {
        shape,
        maxLevel: Math.max(base, source ? regional : base),
        firstDrawableLevel: 1,
        maxTiles: tiles,
      };
      const got = selectTiles(view, { ...common, maxLevelAt });
      const want = selectTilesReference(view, {
        ...common,
        maxLevelAt: historic,
      });
      expect(sameList(got, want)).toBe(true);
      results.push(got);
    }
    // Le premier et le quatrième appel (mêmes entrées) rendent la même liste ; le deuxième (sans région) est différent.
    expect(sameList(results[0]!, results[3]!)).toBe(true);
    expect(sameList(results[0]!, results[1]!)).toBe(false);
  });
});
