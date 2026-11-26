import { describe, expect, it } from 'vitest';
import { ancestorAt, fallbackAncestors, tilesOverlap } from './tileFallback';
import type { TileIndex } from './tilePyramid';

const t = (level: number, row: number, column: number): TileIndex => ({
  level,
  row,
  column,
});

const base = {
  painted: () => false,
  solid: [] as TileIndex[],
  firstDrawableLevel: 4,
  levels: 3,
  max: 24,
};

describe('les ancêtres de repli', () => {
  it('une feuille découverte demande son ancêtre trois niveaux plus haut, une seule fois pour ses voisines', () => {
    const leaves = [t(10, 80, 160), t(10, 81, 161), t(10, 87, 167)];
    expect(fallbackAncestors({ ...base, leaves })).toEqual([t(7, 10, 20)]);
  });

  it('jamais plus grossier que le premier niveau peint', () => {
    expect(fallbackAncestors({ ...base, leaves: [t(5, 3, 3)] })).toEqual([
      t(4, 1, 1),
    ]);
    expect(fallbackAncestors({ ...base, leaves: [t(4, 3, 3)] })).toEqual([]);
  });

  it("une feuille posée, ou couverte par un parent ou un enfant franc, n'en demande pas", () => {
    const leaf = t(10, 80, 160);
    expect(
      fallbackAncestors({ ...base, leaves: [leaf], painted: () => true })
    ).toEqual([]);
    expect(
      fallbackAncestors({ ...base, leaves: [leaf], solid: [t(9, 40, 80)] })
    ).toEqual([]);
    expect(
      fallbackAncestors({ ...base, leaves: [leaf], solid: [t(11, 160, 320)] })
    ).toEqual([]);
  });

  it("un ancêtre qui est déjà une feuille voulue n'est pas compté deux fois ; borné par max", () => {
    expect(
      fallbackAncestors({ ...base, leaves: [t(7, 10, 20), t(10, 80, 160)] })
    ).toEqual([t(4, 1, 2)]);
    const many = Array.from({ length: 50 }, (_, i) => t(10, i * 8, 0));
    expect(fallbackAncestors({ ...base, leaves: many, max: 5 })).toHaveLength(
      5
    );
  });

  it('aucun repli quand il est coupé (levels 0)', () => {
    expect(
      fallbackAncestors({ ...base, leaves: [t(10, 1, 1)], levels: 0 })
    ).toEqual([]);
  });

  it('géométrie : ancêtre et recouvrement', () => {
    expect(ancestorAt(t(10, 81, 161), 7)).toEqual(t(7, 10, 20));
    expect(tilesOverlap(t(7, 10, 20), t(10, 87, 167))).toBe(true);
    expect(tilesOverlap(t(7, 10, 20), t(10, 88, 167))).toBe(false);
  });
});
