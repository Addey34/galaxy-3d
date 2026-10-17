import { describe, expect, it } from 'vitest';
import {
  baseCrop,
  coversBounds,
  touchesCoverage,
  maxLevelFor,
  regionalMaxLevel,
  servedByRegion,
  type RegionalSource,
} from './regionalImagery';
import { tileBounds, WMTS_EQUIRECTANGULAR_2x1 } from './tilePyramid';
import { tileUrl } from './tileUrl';

/** Une couverture jouet : deux boîtes de 1° côte à côte, ligne 40 (50°N-49°N), 182 et 183. */
const coverage = {
  boxDeg: 1,
  rows: { '40': [[182, 183]] as [number, number][] },
};
const source: RegionalSource = { coverage, publishedPixelsPerDegree: 372_800 };
const shape = WMTS_EQUIRECTANGULAR_2x1;

describe('imagerie régionale (lot 53, pas 4)', () => {
  it('une emprise est couverte si TOUTES les boîtes qu’elle touche le sont', () => {
    expect(
      coversBounds({ west: 2.2, east: 2.8, south: 49.2, north: 49.8 }, coverage)
    ).toBe(true);
    // À cheval sur les deux boîtes couvertes : couverte.
    expect(
      coversBounds({ west: 2.5, east: 3.5, south: 49.2, north: 49.8 }, coverage)
    ).toBe(true);
    // Débordant sur une boîte non couverte : non couverte, la tuile y serait à moitié blanche.
    expect(
      coversBounds({ west: 3.5, east: 4.5, south: 49.2, north: 49.8 }, coverage)
    ).toBe(false);
    expect(
      coversBounds({ west: 2.2, east: 2.8, south: 48.5, north: 49.5 }, coverage)
    ).toBe(false);
    // Une emprise posée EXACTEMENT sur le bord d'une boîte ne touche pas la voisine.
    expect(
      coversBounds({ west: 2, east: 3, south: 49, north: 50 }, coverage)
    ).toBe(true);
  });

  it('le niveau maximal se DÉRIVE de la finesse publiée et de la grille', () => {
    // 372 800 px/° (0,2986 m/px, la plus petite échelle du WMS de l'IGN) : niveau 18 sur la
    // grille de Sentinel-2 (2 × 256 px au niveau 0), dont la finesse le dépasse à peine.
    const level = regionalMaxLevel(shape, 372_800);
    expect(level).toBe(18);
    expect((2 * 256 * 2 ** level) / 360).toBeGreaterThanOrEqual(372_800);
    expect((2 * 256 * 2 ** (level - 1)) / 360).toBeLessThan(372_800);
  });

  it('au-delà de la base, seulement dans la couverture, et c’est la région qui sert', () => {
    // Au niveau 13 de cette grille, une tuile mesure 360 / (2 × 2^13) ≈ 0,022°.
    const step = 360 / (2 * 2 ** 13);
    const at = (lat: number, lon: number) => ({
      level: 13,
      row: Math.floor((90 - lat) / step),
      column: Math.floor((lon + 180) / step),
    });
    const inside = at(49.5, 2.5);
    expect(coversBounds(tileBounds(inside, shape), coverage)).toBe(true);
    expect(maxLevelFor(inside, shape, 13, source)).toBe(18);
    const outside = at(49.5, 10.5);
    expect(maxLevelFor(outside, shape, 13, source)).toBe(13);
    // En deçà du maximum de la base, la base décide partout.
    expect(
      maxLevelFor({ level: 9, row: 0, column: 0 }, shape, 13, source)
    ).toBe(13);
    expect(maxLevelFor(inside, shape, 13, null)).toBe(13);
    const deeper = {
      level: 14,
      row: inside.row * 2,
      column: inside.column * 2,
    };
    expect(servedByRegion(deeper, shape, 13, source)).toBe(true);
    expect(servedByRegion(inside, shape, 13, source)).toBe(false);
    expect(servedByRegion(deeper, shape, 13, null)).toBe(false);
  });

  it('une tuile À CHEVAL se subdivise, et seuls ses enfants entièrement couverts sont régionaux', () => {
    // Niveau 8 de cette grille : 0,703° de côté. La tuile qui contient (49,5°N ; 3,9°E) va de
    // 3,52° à 4,22° est : elle touche la boîte couverte (3°-4°) ET la boîte voisine, non couverte.
    // Exiger qu'elle soit entièrement couverte pour la subdiviser laissait Paris à 500 m par
    // pixel sous une tuile qui touchait la baie de Seine (run 38990592821).
    const step = 360 / (2 * 2 ** 8);
    const straddling = {
      level: 8,
      row: Math.floor((90 - 49.5) / step),
      column: Math.floor((3.9 + 180) / step),
    };
    const b = tileBounds(straddling, shape);
    expect(b.west).toBeLessThan(4);
    expect(b.east).toBeGreaterThan(4);
    expect(maxLevelFor(straddling, shape, 8, source)).toBe(18);
    const [west, east] = [0, 1].map((dc) => ({
      level: 9,
      row: straddling.row * 2,
      column: straddling.column * 2 + dc,
    }));
    expect(servedByRegion(west!, shape, 8, source)).toBe(true);
    expect(servedByRegion(east!, shape, 8, source)).toBe(false);
    // L'enfant non couvert ne se subdivise plus : il garde le morceau de l'image de la base.
    expect(
      maxLevelFor(
        { level: 9, row: east!.row, column: east!.column + 2 },
        shape,
        8,
        source
      )
    ).toBe(8);
  });

  it('le morceau de l’ancêtre se lit nord en haut, comme les coordonnées de `tilePatch`', () => {
    expect(baseCrop({ level: 8, row: 3, column: 4 }, 8)).toBeNull();
    // Deux niveaux sous la base : un seizième de l'image, quatrième colonne, deuxième ligne
    // depuis le NORD, donc troisième depuis le sud (v croît vers le nord).
    expect(baseCrop({ level: 10, row: 5, column: 7 }, 8)).toEqual({
      ancestor: { level: 8, row: 1, column: 1 },
      offset: [0.75, 0.5],
      repeat: 0.25,
    });
    expect(baseCrop({ level: 10, row: 4, column: 4 }, 8)).toEqual({
      ancestor: { level: 8, row: 1, column: 1 },
      offset: [0, 0.75],
      repeat: 0.25,
    });
  });

  it('le gabarit WMS reçoit l’emprise de la tuile, latitude d’abord', () => {
    const index = { level: 3, row: 1, column: 8 };
    const b = tileBounds(index, shape);
    const url = tileUrl(
      {
        template:
          'https://example.test/wms?SERVICE=WMS&CRS=EPSG:4326&BBOX={South},{West},{North},{East}',
        style: 'default',
        tileMatrixSet: 'EPSG:4326',
        matrix: shape,
      },
      index
    );
    expect(url).toBe(
      `https://example.test/wms?SERVICE=WMS&CRS=EPSG:4326&BBOX=${b.south},${b.west},${b.north},${b.east}`
    );
  });
});

describe('couverture par plages (lot 54)', () => {
  it('rend exactement ce que rend le parcours boîte par boîte, sur la vraie couverture', async () => {
    const { default: real } =
      (await import('@/config/regionalCoverage.json')) as unknown as {
        default: {
          boxDeg: number;
          regions: Record<string, { rows: Record<string, [number, number][]> }>;
        };
      };
    const coverage = {
      boxDeg: real.boxDeg,
      rows: Object.values(real.regions)[0]!.rows,
    };
    const step = coverage.boxDeg;
    const brute = (b: {
      west: number;
      south: number;
      east: number;
      north: number;
    }) => {
      const e = 1e-9;
      const cells: boolean[] = [];
      for (
        let r = Math.floor((90 - b.north + e) / step);
        r <= Math.floor((90 - b.south - e) / step);
        r += 1
      )
        for (
          let c = Math.floor((b.west + 180 + e) / step);
          c <= Math.floor((b.east + 180 - e) / step);
          c += 1
        )
          cells.push(
            (coverage.rows[String(r)] ?? []).some(([f, t]) => c >= f && c <= t)
          );
      return { all: cells.every(Boolean), any: cells.some(Boolean) };
    };
    // Générateur pseudo-aléatoire déterministe : un échec se rejoue à l'identique.
    let seed = 54;
    const rand = () =>
      (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let mixed = 0;
    for (let i = 0; i < 4000; i += 1) {
      const size = [0.01, 0.05, 0.3, 1.2, 2.25][i % 5]!;
      const west = -6 + rand() * 16;
      const south = 41 + rand() * 11;
      const b = { west, south, east: west + size, north: south + size };
      const expected = brute(b);
      expect(coversBounds(b, coverage), JSON.stringify(b)).toBe(expected.all);
      expect(touchesCoverage(b, coverage), JSON.stringify(b)).toBe(
        expected.any
      );
      if (expected.any && !expected.all) mixed += 1;
    }
    // Le tirage doit contenir des emprises À CHEVAL, sans quoi il ne prouverait rien.
    expect(mixed).toBeGreaterThan(100);
  });
});
