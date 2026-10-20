import { describe, expect, it } from 'vitest';

import {
  HEIGHT_ORIGIN,
  quantizeToTile,
  tileOfLonLat,
  type BuildingTile,
} from './buildingTile';
import {
  buildBuildingMesh,
  DEFAULT_FLAT_PLATE_METRES,
  DEFAULT_SKIRT_METRES,
  type BuildingMesh,
} from './buildingMesh';

/**
 * CE QU'UN BÂTIMENT DOIT ÊTRE, MESURÉ SUR LES SOMMETS.
 *
 * Trois choses ne se voient pas sur une capture isolée : un triangle retourné (la face est
 * invisible de face et brillante de dos), un toit qui ne couvre pas toute l'emprise (un L triangulé
 * en triangle), et un bâtiment sans hauteur dessiné comme un prisme (une hauteur inventée).
 */

const TILE_ID = tileOfLonLat(2.3499, 48.853, 14);
// Mètres par degré à 48,85° de latitude, sphère de 6 371 km : assez pour des mesures de test.
const OPTIONS = {
  metresPerDegreeLat: (Math.PI / 180) * 6371000,
  metresPerDegreeLon:
    (Math.PI / 180) * 6371000 * Math.cos((48.853 * Math.PI) / 180),
};

/** Un anneau en mètres (est, nord) autour du centre de la tuile, quantifié comme le cuiseur. */
function ringAt(metres: [number, number][]): Uint16Array {
  // Centre de la tuile, tel que le constructeur le calcule : le test part du MÊME point.
  const centre = buildBuildingMesh(
    { ...TILE_ID, buildings: [] },
    OPTIONS
  ).centre;
  const out: number[] = [];
  for (const [east, north] of metres) {
    const lon = centre.longitudeDeg + east / OPTIONS.metresPerDegreeLon;
    const lat = centre.latitudeDeg + north / OPTIONS.metresPerDegreeLat;
    out.push(...quantizeToTile(lon, lat, TILE_ID));
  }
  return Uint16Array.from(out);
}

function tileOf(
  ring: Uint16Array,
  heightDecimetres: number,
  origin: number
): BuildingTile {
  return {
    ...TILE_ID,
    buildings: [{ ring, heightDecimetres, origin: origin as never }],
  };
}

const SQUARE: [number, number][] = [
  [-5, -5],
  [5, -5],
  [5, 5],
  [-5, 5],
];

function triangles(mesh: BuildingMesh) {
  const out: { a: number[]; b: number[]; c: number[]; stored: number[] }[] = [];
  const v = (i: number) => Array.from(mesh.positions.slice(3 * i, 3 * i + 3));
  const n = (i: number) => Array.from(mesh.normals.slice(3 * i, 3 * i + 3));
  for (let t = 0; t < mesh.indices.length; t += 3)
    out.push({
      a: v(mesh.indices[t]!),
      b: v(mesh.indices[t + 1]!),
      c: v(mesh.indices[t + 2]!),
      stored: n(mesh.indices[t]!),
    });
  return out;
}

const cross = (u: number[], w: number[]) => [
  u[1]! * w[2]! - u[2]! * w[1]!,
  u[2]! * w[0]! - u[0]! * w[2]!,
  u[0]! * w[1]! - u[1]! * w[0]!,
];
const sub = (p: number[], q: number[]) => [
  p[0]! - q[0]!,
  p[1]! - q[1]!,
  p[2]! - q[2]!,
];
const dot = (u: number[], w: number[]) =>
  u[0]! * w[0]! + u[1]! * w[1]! + u[2]! * w[2]!;

describe('un prisme', () => {
  const mesh = buildBuildingMesh(
    tileOf(ringAt(SQUARE), 200, HEIGHT_ORIGIN.interpolated),
    OPTIONS
  );

  it('monte à sa hauteur et descend de la jupe', () => {
    const ys = Array.from(
      { length: mesh.positions.length / 3 },
      (_, i) => mesh.positions[3 * i + 1]!
    );
    expect(Math.max(...ys)).toBeCloseTo(20, 4);
    expect(Math.min(...ys)).toBeCloseTo(-DEFAULT_SKIRT_METRES, 4);
  });

  it('a toutes ses faces tournées dans le sens de leur normale stockée', () => {
    for (const t of triangles(mesh)) {
      const geometric = cross(sub(t.b, t.a), sub(t.c, t.a));
      expect(dot(geometric, t.stored)).toBeGreaterThan(0);
    }
  });

  it('a des normales unitaires, un toit qui regarde en haut et des murs horizontaux', () => {
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const [x, y, z] = [
        mesh.normals[i]!,
        mesh.normals[i + 1]!,
        mesh.normals[i + 2]!,
      ];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(y === 1 || y === 0).toBe(true);
    }
  });

  it('couvre un carré de 10 m par un toit de 100 m²', () => {
    let roof = 0;
    for (const t of triangles(mesh)) {
      if (t.stored[1] === 1)
        roof += Math.abs(cross(sub(t.b, t.a), sub(t.c, t.a))[1]!) / 2;
    }
    expect(roof).toBeCloseTo(100, 0);
  });

  it("place ses murs sur l'emprise : ±5 m autour du centre", () => {
    const xs = Array.from(
      { length: mesh.positions.length / 3 },
      (_, i) => mesh.positions[3 * i]!
    );
    expect(Math.max(...xs)).toBeCloseTo(5, 1);
    expect(Math.min(...xs)).toBeCloseTo(-5, 1);
  });

  it("porte l'origine de la hauteur sur chaque sommet", () => {
    expect(new Set(mesh.origins)).toEqual(
      new Set([HEIGHT_ORIGIN.interpolated])
    );
  });
});

describe("orientation de l'anneau", () => {
  it("rend le même maillage qu'il tourne dans un sens ou dans l'autre", () => {
    const ccw = buildBuildingMesh(
      tileOf(ringAt(SQUARE), 100, HEIGHT_ORIGIN.measured),
      OPTIONS
    );
    const cw = buildBuildingMesh(
      tileOf(ringAt([...SQUARE].reverse()), 100, HEIGHT_ORIGIN.measured),
      OPTIONS
    );
    for (const t of triangles(cw)) {
      expect(
        dot(cross(sub(t.b, t.a), sub(t.c, t.a)), t.stored)
      ).toBeGreaterThan(0);
    }
    expect(cw.indices.length).toBe(ccw.indices.length);
  });
});

describe('une emprise concave', () => {
  // Un L : 100 m² moins un coin de 25 m² = 75 m².
  const L: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 5],
    [5, 5],
    [5, 10],
    [0, 10],
  ];
  it('est couverte exactement par son toit', () => {
    const mesh = buildBuildingMesh(
      tileOf(ringAt(L), 150, HEIGHT_ORIGIN.measured),
      OPTIONS
    );
    let roof = 0;
    for (const t of triangles(mesh)) {
      if (t.stored[1] === 1)
        roof += Math.abs(cross(sub(t.b, t.a), sub(t.c, t.a))[1]!) / 2;
    }
    expect(roof).toBeCloseTo(75, 0);
    expect(mesh.stats.triangulationFailed).toBe(0);
  });
});

describe('un bâtiment sans hauteur', () => {
  it('est une dalle, jamais un prisme inventé', () => {
    // La tuile PORTE une hauteur de 50 m, et son origine dit qu'aucune n'est connue : la valeur
    // n'a aucun sens, et le maillage ne doit pas la dessiner.
    const mesh = buildBuildingMesh(
      tileOf(ringAt(SQUARE), 500, HEIGHT_ORIGIN.absent),
      OPTIONS
    );
    const ys = Array.from(
      { length: mesh.positions.length / 3 },
      (_, i) => mesh.positions[3 * i + 1]!
    );
    expect(Math.max(...ys)).toBeCloseTo(DEFAULT_FLAT_PLATE_METRES, 6);
    expect(new Set(mesh.origins)).toEqual(new Set([HEIGHT_ORIGIN.absent]));
  });
});

describe('ce que le constructeur écarte', () => {
  it('compte un anneau de surface nulle au lieu de le dessiner', () => {
    const flat = ringAt([
      [0, 0],
      [5, 0],
      [10, 0],
    ]);
    const mesh = buildBuildingMesh(
      tileOf(flat, 100, HEIGHT_ORIGIN.measured),
      OPTIONS
    );
    expect(mesh.stats.skippedDegenerate).toBe(1);
    expect(mesh.stats.buildings).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });

  it('rend un maillage vide pour une tuile vide', () => {
    const mesh = buildBuildingMesh({ ...TILE_ID, buildings: [] }, OPTIONS);
    expect(mesh.positions.length).toBe(0);
    expect(mesh.stats.buildings).toBe(0);
  });
});
