import { describe, expect, it } from 'vitest';
import { selectTiles, tileBudgetForSize, type TileView } from './tileSelection';
import {
  groundResolutionKm,
  tileBounds,
  WMTS_EQUIRECTANGULAR_2x1,
  type TileIndex,
} from './tilePyramid';

const R = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;
const shape = WMTS_EQUIRECTANGULAR_2x1;

/** Angle au centre entre deux points géographiques (radians). */
const angle = (la1: number, lo1: number, la2: number, lo2: number) => {
  const c =
    Math.sin(rad(la1)) * Math.sin(rad(la2)) +
    Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1));
  return Math.acos(Math.min(1, Math.max(-1, c)));
};

/**
 * Une caméra au-dessus de (lat, lon), à `h` km, fenêtre de 800 px de haut et 55° de champ :
 * visible jusqu'à l'horizon, grossissement au point du carreau le plus proche du nadir.
 */
function sphereView(lat: number, lon: number, h: number): TileView {
  const d0 = R + h;
  const horizon = Math.acos(R / d0);
  const pxPerKm = (d: number) => 800 / (2 * d * Math.tan(rad(27.5)));
  const nearest = (index: TileIndex) => {
    const b = tileBounds(index, shape);
    const la = Math.min(b.north, Math.max(b.south, lat));
    const lo = Math.min(b.east, Math.max(b.west, lon));
    return angle(lat, lon, la, lo);
  };
  const distance = (index: TileIndex) => {
    const a = nearest(index);
    return Math.sqrt(R * R + d0 * d0 - 2 * R * d0 * Math.cos(a));
  };
  return {
    visible: (index) => nearest(index) <= horizon,
    pixelsPerTexel: (index) =>
      groundResolutionKm(index.level, R, shape) * pxPerKm(distance(index)),
  };
}

const options = {
  shape,
  maxLevel: 13,
  firstDrawableLevel: 5,
  maxTiles: 64,
};

const contains = (outer: TileIndex, inner: TileIndex) => {
  if (inner.level <= outer.level) return false;
  const k = 2 ** (inner.level - outer.level);
  return (
    Math.floor(inner.row / k) === outer.row &&
    Math.floor(inner.column / k) === outer.column
  );
};

describe('selectTiles', () => {
  const low = selectTiles(sphereView(45.83, 6.86, 3), options);

  it('respects the budget, the drawable floor and the finest level', () => {
    expect(low.length).toBeGreaterThan(0);
    expect(low.length).toBeLessThanOrEqual(options.maxTiles);
    for (const t of low) {
      expect(t.level).toBeGreaterThanOrEqual(options.firstDrawableLevel);
      expect(t.level).toBeLessThanOrEqual(options.maxLevel);
    }
  });

  it('never paints the same ground twice', () => {
    for (const a of low)
      for (const b of low) expect(contains(a, b)).toBe(false);
    const keys = new Set(low.map((t) => `${t.level}/${t.row}/${t.column}`));
    expect(keys.size).toBe(low.length);
  });

  it('is finest under the camera and coarser towards the horizon', () => {
    const under = low.find((t) => {
      const b = tileBounds(t, shape);
      return (
        b.south <= 45.83 && 45.83 < b.north && b.west <= 6.86 && 6.86 < b.east
      );
    });
    expect(under).toBeDefined();
    const levels = low.map((t) => t.level);
    expect(under!.level).toBe(Math.max(...levels));
    expect(Math.min(...levels)).toBeLessThan(under!.level);
  });

  it('asks for the finest tile, the ground under the camera, first', () => {
    expect(low[0]!.level).toBe(Math.max(...low.map((t) => t.level)));
  });

  it('paints nothing where the shipped sphere is already fine enough', () => {
    expect(selectTiles(sphereView(0, 0, R * 6), options)).toEqual([]);
  });

  it('stays inside a tight budget', () => {
    const tight = selectTiles(sphereView(45.83, 6.86, 3), {
      ...options,
      maxTiles: 25,
    });
    expect(tight.length).toBeGreaterThan(0);
    expect(tight.length).toBeLessThanOrEqual(25);
  });

  it('paints nothing out of sight', () => {
    expect(
      selectTiles({ visible: () => false, pixelsPerTexel: () => 100 }, options)
    ).toEqual([]);
  });
});

describe('tileBudgetForSize', () => {
  it('double le budget pour des carreaux de 256 px, mesuré sur Paris en Sentinel-2', () => {
    // 256 carreaux épuisés au niveau 13 : l'IGN n'était jamais demandée (plancher 458 m) ;
    // 512 la rendent (229 m), 1024 n'ajoutent rien.
    expect(tileBudgetForSize(256, 256)).toBe(512);
  });

  it('laisse intact le budget de la taille de référence, et ne le réduit jamais', () => {
    expect(tileBudgetForSize(256, 512)).toBe(256);
    expect(tileBudgetForSize(256, 1024)).toBe(256);
  });

  it('refuse une taille absurde plutôt que de diviser par zéro', () => {
    expect(tileBudgetForSize(256, 0)).toBe(256);
  });
});
