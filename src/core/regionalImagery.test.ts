import { describe, expect, it } from 'vitest';
import {
  coversBounds,
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
    expect(servedByRegion({ level: 14, row: 0, column: 0 }, 13)).toBe(true);
    expect(servedByRegion({ level: 13, row: 0, column: 0 }, 13)).toBe(false);
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
