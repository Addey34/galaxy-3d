import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  localBasisAt,
  meshRotationAt,
  metresPerDegree,
  tilesAround,
} from './buildingPlacement';
import { geographicToLocalDirection } from './frames';

/**
 * LE REPÈRE D'UN BÂTIMENT, CONFRONTÉ À LA SURFACE.
 *
 * Un repère local faux ne déforme rien : il décale les bâtiments par rapport aux continents, et
 * rien ne le dit. Le test le plus fort est le déplacement : aller vers l'est dans le repère doit
 * suivre la dérivée numérique de la surface, celle des couches qui portent les continents.
 */

const POINTS: [number, number][] = [
  [48.853, 2.3499],
  [-33.9, 151.2],
  [0.1, -179.9],
  [78, 15],
  [-60, -70],
];

describe('repère local', () => {
  it.each(POINTS)('est orthonormé et droit en (%f, %f)', (lat, lon) => {
    const { east, north, up } = localBasisAt(lat, lon);
    for (const v of [east, north, up]) expect(v.length()).toBeCloseTo(1, 12);
    expect(east.dot(north)).toBeCloseTo(0, 12);
    expect(east.dot(up)).toBeCloseTo(0, 12);
    expect(north.dot(up)).toBeCloseTo(0, 12);
    // est × nord = haut : le trièdre est direct.
    expect(east.clone().cross(north).distanceTo(up)).toBeLessThan(1e-12);
  });

  it.each(POINTS)(
    "va vers l'est et vers le nord comme la surface en (%f, %f)",
    (lat, lon) => {
      const { east, north } = localBasisAt(lat, lon);
      const h = 1e-6; // degré
      const here = geographicToLocalDirection(lat, lon);
      const moveEast = geographicToLocalDirection(lat, lon + h).sub(here);
      const moveNorth = geographicToLocalDirection(lat + h, lon).sub(here);
      expect(moveEast.normalize().distanceTo(east)).toBeLessThan(1e-5);
      expect(moveNorth.normalize().distanceTo(north)).toBeLessThan(1e-5);
    }
  );
});

describe('rotation du maillage', () => {
  it.each(POINTS)(
    "amène x sur l'est, y sur le haut, z sur le sud en (%f, %f)",
    (lat, lon) => {
      const q = meshRotationAt(lat, lon);
      const { east, north, up } = localBasisAt(lat, lon);
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      expect(x.distanceTo(east)).toBeLessThan(1e-12);
      expect(y.distanceTo(up)).toBeLessThan(1e-12);
      expect(z.distanceTo(north.clone().negate())).toBeLessThan(1e-12);
    }
  );
});

describe('tuiles autour de la visée', () => {
  it('rend la seule tuile de la visée à zéro anneau', () => {
    expect(tilesAround(2.3499, 48.853, 14, 0)).toEqual([
      { zoom: 14, column: 8298, row: 5636 },
    ]);
  });

  it('en rend (2n+1)² et commence par la visée', () => {
    const tiles = tilesAround(2.3499, 48.853, 14, 2);
    expect(tiles).toHaveLength(25);
    expect(tiles[0]).toEqual({ zoom: 14, column: 8298, row: 5636 });
  });

  it('range par distance croissante', () => {
    const tiles = tilesAround(2.3499, 48.853, 14, 2);
    const d = tiles.map((t) => Math.hypot(t.column - 8298, t.row - 5636));
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });

  it("boucle sur l'antiméridien et s'arrête aux pôles", () => {
    const edge = tilesAround(179.999, 0, 3, 1);
    expect(edge.map((t) => t.column)).toContain(0);
    expect(tilesAround(0, 85.05, 3, 2).every((t) => t.row >= 0)).toBe(true);
  });
});

describe('mètres par degré', () => {
  it('donne 111,19 km par degré de latitude sur la sphère terrestre moyenne', () => {
    expect(metresPerDegree(0, 6371000).metresPerDegreeLat / 1000).toBeCloseTo(
      111.19,
      1
    );
  });
  it('raccourcit la longitude avec la latitude', () => {
    const eq = metresPerDegree(0, 6371000).metresPerDegreeLon;
    const sixty = metresPerDegree(60, 6371000).metresPerDegreeLon;
    expect(sixty / eq).toBeCloseTo(0.5, 12);
  });
});
