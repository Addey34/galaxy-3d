import { describe, expect, it } from 'vitest';

import {
  approach,
  COVERAGE_FEATHER_GLSL,
  coverageEdges,
  coverageFeatherWeight,
  NO_FADE,
} from './coverageFeather';
import type { TileBounds } from './tilePyramid';

const box = (west: number, south: number, size = 10): TileBounds => ({
  west,
  east: west + size,
  south,
  north: south + size,
});

/** Les huit voisines d'une tuile de 10° posée en (0, 0). */
const ring = [
  box(-10, -10),
  box(0, -10),
  box(10, -10),
  box(-10, 0),
  box(10, 0),
  box(-10, 10),
  box(0, 10),
  box(10, 10),
];

describe('coverageEdges : seule la frontière EXTÉRIEURE de la couverture s’efface', () => {
  it('une tuile entourée ne s’efface vers rien (aucune couture interne)', () => {
    expect(coverageEdges(box(0, 0), ring)).toEqual(NO_FADE);
  });

  it('une tuile seule s’efface vers ses quatre côtés', () => {
    const e = coverageEdges(box(0, 0), []);
    expect([e.west, e.east, e.south, e.north]).toEqual([1, 1, 1, 1]);
    // Un coin ne s'ajoute que si ses deux côtés sont couverts.
    expect([e.southWest, e.southEast, e.northWest, e.northEast]).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('la tuile du bord est s’efface vers l’est seulement', () => {
    const e = coverageEdges(
      box(0, 0),
      ring.filter((b) => b.west !== 10)
    );
    expect(e.east).toBe(1);
    expect([e.west, e.south, e.north]).toEqual([0, 0, 0]);
  });

  it('un coin découvert, côtés couverts : seul le coin s’efface', () => {
    const e = coverageEdges(
      box(0, 0),
      ring.filter((b) => !(b.west === 10 && b.south === 10))
    );
    expect(e.northEast).toBe(1);
    expect([e.west, e.east, e.south, e.north]).toEqual([0, 0, 0, 0]);
  });

  it('une voisine plus FINE qui ne couvre qu’une partie du côté ne suffit pas (le côté s’efface)', () => {
    const e = coverageEdges(box(0, 0), [box(10, 0, 5)]);
    expect(e.east).toBe(1);
    // Deux fines qui couvrent tout le côté suffisent (tous niveaux).
    const f = coverageEdges(box(0, 0), [box(10, 0, 5), box(10, 5, 5)]);
    expect(f.east).toBe(0);
  });

  it('au-delà d’un pôle il n’y a rien à montrer : le côté polaire ne s’efface pas', () => {
    const e = coverageEdges(box(0, 80), []);
    expect(e.north).toBe(0);
  });

  it('l’antiméridien se franchit : une voisine de l’autre côté couvre le bord', () => {
    const e = coverageEdges(box(170, 0), [box(-180, 0)]);
    expect(e.east).toBe(0);
  });
});

describe('coverageFeatherWeight : continu, entier au centre, nul à l’extérieur', () => {
  const east = { ...NO_FADE, east: 1 };

  it('sans bord découvert, la tuile est entière partout', () => {
    for (const [u, v] of [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ])
      expect(coverageFeatherWeight(u!, v!, NO_FADE)).toBe(1);
  });

  it('vers un côté découvert : 1 au bord intérieur (raccord exact avec la voisine), 0 au bord extérieur', () => {
    expect(coverageFeatherWeight(0, 0.5, east)).toBe(1);
    expect(coverageFeatherWeight(1, 0.5, east)).toBe(0);
    const mid = coverageFeatherWeight(0.5, 0.5, east);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  it('un poids partiel (lissage temporel) donne un fondu partiel, jamais un saut', () => {
    expect(coverageFeatherWeight(1, 0.5, { ...NO_FADE, east: 0.5 })).toBe(0.5);
  });

  it('le shader porte les mêmes termes que le jumeau testé', () => {
    expect(COVERAGE_FEATHER_GLSL).toContain(
      'edgeFadeTerm( uEdgeSide.y, 1.0 - fuv.x )'
    );
    expect(COVERAGE_FEATHER_GLSL).toContain(
      'edgeFadeTerm( uEdgeCorner.w, max( 1.0 - fuv.x, 1.0 - fuv.y ) )'
    );
    expect(COVERAGE_FEATHER_GLSL).toContain('diffuseColor.a *=');
  });
});

describe('approach : lissage temporel sans scintillement', () => {
  it('se rapproche de la cible sans la dépasser, et l’atteint d’un coup sous un pas infini', () => {
    const a = approach(0, 1, 16);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(0.2);
    expect(approach(0, 1, Number.POSITIVE_INFINITY)).toBe(1);
    expect(approach(0.9995, 1, 16)).toBe(1);
  });
});
