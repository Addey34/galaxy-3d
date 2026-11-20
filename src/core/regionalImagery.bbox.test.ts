import { describe, expect, it } from 'vitest';
import {
  coversBounds,
  maxLevelFor,
  pickRegional,
  servedByRegion,
  touchesCoverage,
  type RegionalSource,
} from './regionalImagery';
import {
  tileBounds,
  tileIndexAt,
  WMTS_EQUIRECTANGULAR_2x1,
} from './tilePyramid';

/**
 * COUVERTURE PAR EMPRISE (GAL-IMMERSION-003B) : le rectangle de données que publie une mosaïque
 * WMTS de NASA Trek. Les témoins sont le site d'Apollo 11 et le Mars d'Olympus Mons, dont les
 * emprises sont celles des capacités WMTS lues le 2026-11-20 (fiches de jeux de tuiles).
 */
const shape = WMTS_EQUIRECTANGULAR_2x1;

const APOLLO_BBOX: [number, number, number, number] = [
  22.4806483, -0.3193414, 24.459338, 1.6593483,
];
const APOLLO: RegionalSource = {
  coverage: { bbox: APOLLO_BBOX },
  // Niveau 15 de la grille : 256 * 2^16 / 360 pixels par degré.
  publishedPixelsPerDegree: 46_603,
};
const OLYMPUS: RegionalSource = {
  coverage: { bbox: [-136, 12, -124, 24] },
  publishedPixelsPerDegree: 11_650,
};

const around = (lat: number, lon: number, half = 0.0005) => ({
  west: lon - half,
  east: lon + half,
  south: lat - half,
  north: lat + half,
});

describe('couverture par emprise', () => {
  it('couvre le site d’Apollo 11, pas la mer de la Tranquillité alentour (témoins nommés)', () => {
    // Le module Eagle, publié par la source à 0,67416° N, 23,47314° E.
    expect(coversBounds(around(0.67416, 23.47314), APOLLO.coverage)).toBe(true);
    // Le centre de la mare est à ~8,5° N, 31,4° E : bien au-delà des 60 km de la mosaïque.
    expect(coversBounds(around(8.5, 31.4), APOLLO.coverage)).toBe(false);
    expect(touchesCoverage(around(8.5, 31.4), APOLLO.coverage)).toBe(false);
    // Apollo 12, autre mosaïque : hors de celle-ci.
    expect(coversBounds(around(-3.0, -23.4), APOLLO.coverage)).toBe(false);
  });

  it('une tuile à cheval sur un bord n’est pas couverte, mais elle touche', () => {
    const [west, , , north] = APOLLO_BBOX;
    const straddling = {
      west: west - 0.01,
      east: west + 0.01,
      south: north - 0.5,
      north: north - 0.4,
    };
    expect(coversBounds(straddling, APOLLO.coverage)).toBe(false);
    expect(touchesCoverage(straddling, APOLLO.coverage)).toBe(true);
  });

  it('un voisin qui ne la touche que par un bord ne compte pas', () => {
    const [, , east, north] = APOLLO_BBOX;
    const beside = { west: east, east: east + 0.1, south: 0, north: 0.1 };
    const above = { west: 23, east: 23.1, south: north, north: north + 0.1 };
    expect(touchesCoverage(beside, APOLLO.coverage)).toBe(false);
    expect(touchesCoverage(above, APOLLO.coverage)).toBe(false);
  });

  it('une région à emprise ne sert que des tuiles au-delà de la base et entièrement dedans', () => {
    // Niveau 8 de la Lune : la base. Aucune région ne sert un niveau que la base atteint.
    const base = tileIndexAt(8, 0.67416, 23.47314, shape);
    expect(servedByRegion(base, shape, 8, APOLLO)).toBe(false);
    const fine = tileIndexAt(15, 0.67416, 23.47314, shape);
    expect(servedByRegion(fine, shape, 8, APOLLO)).toBe(true);
    // Une tuile de niveau 9 posée sur le bord ouest de la mosaïque la déborde : elle n'est pas
    // servie par elle, mais sa subdivision y est permise (`maxLevelFor` : le niveau de la région).
    const coarse = tileIndexAt(9, 0.7, 22.4806, shape);
    expect(servedByRegion(coarse, shape, 8, APOLLO)).toBe(false);
    expect(maxLevelFor(coarse, shape, 8, APOLLO, 15)).toBe(15);
    // Une tuile de niveau 9 entièrement dans la mosaïque (Apollo 11) est servie.
    expect(
      servedByRegion(tileIndexAt(9, 0.67416, 23.47314, shape), shape, 8, APOLLO)
    ).toBe(true);
    // Loin de la mosaïque : le niveau maximal est celui de la base.
    const away = tileIndexAt(9, 8.5, 31.4, shape);
    expect(maxLevelFor(away, shape, 8, APOLLO, 15)).toBe(8);
  });

  it('pickRegional : la région qui couvre la tuile, sinon celle qu’elle touche, sinon aucune', () => {
    const entries = [OLYMPUS, APOLLO].map((source) => ({ source }));
    const apollo = tileIndexAt(15, 0.67416, 23.47314, shape);
    expect(pickRegional(entries, apollo, shape)?.source).toBe(APOLLO);
    const olympus = tileIndexAt(13, 18.65, -133.8, shape);
    expect(pickRegional(entries, olympus, shape)?.source).toBe(OLYMPUS);
    // À cheval sur le bord d'Olympus (ouest, -136°) : elle ne la couvre pas mais la touche.
    const edge = tileIndexAt(9, 18, -136, shape);
    const touched = tileBounds(edge, shape);
    expect(coversBounds(touched, OLYMPUS.coverage)).toBe(false);
    expect(pickRegional(entries, edge, shape)?.source).toBe(OLYMPUS);
    // Ailleurs : aucune.
    expect(pickRegional(entries, tileIndexAt(12, -60, 100, shape), shape)).toBe(
      null
    );
    expect(pickRegional([], apollo, shape)).toBe(null);
  });
});
