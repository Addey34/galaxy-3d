/**
 * LA GÉOMÉTRIE D'UNE TUILE DE BÂTIMENTS (lot 63, étape C.3a) : des prismes à toit plat, en mètres,
 * dans un repère LOCAL à la tuile. Pur, sans état, sans GPU : triangulation et normales seulement.
 *
 * Pourquoi un repère local. À 6 371 km du centre de la Terre, un flottant 32 bits ne distingue
 * pas mieux qu'environ 0,5 m : des bâtiments posés avec leurs coordonnées de scène trembleraient.
 * Les sommets sont donc en mètres autour du centre de la tuile (x est, y haut, z SUD : repère
 * droit, car est × haut = −nord), et c'est la couche de rendu qui place le maillage entier.
 *
 * Trois choix qui sont des décisions, pas des détails :
 *  - un bâtiment descend sous le sol de `skirtMetres` : le relief rendu de la Terre est grossier
 *    (15″, environ 460 m) et un socle au niveau de la tuile flotterait par endroits ;
 *  - un bâtiment SANS hauteur n'est pas un prisme inventé : c'est une dalle de `flatPlateMetres`,
 *    et son origine suit chaque sommet pour que la légende le montre autrement ;
 *  - l'origine de la hauteur est portée par sommet (`origins`), jamais déduite de la couleur.
 */
import { ShapeUtils, Vector2 } from 'three';

import {
  dequantizeFromTile,
  HEIGHT_ORIGIN,
  type BuildingTile,
} from './buildingTile';

export interface BuildingMeshOptions {
  /** Mètres par degré de latitude et de longitude AU CENTRE de la tuile (dépend de la figure). */
  metresPerDegreeLat: number;
  metresPerDegreeLon: number;
  /** Profondeur sous le sol dont un bâtiment descend, en mètres. */
  skirtMetres?: number;
  /** Épaisseur de la dalle d'un bâtiment sans hauteur, en mètres. */
  flatPlateMetres?: number;
}

export interface BuildingMesh {
  /** Sommets `x, y, z` en mètres, repère local (x est, y haut, z sud). */
  positions: Float32Array;
  normals: Float32Array;
  /** Origine de la hauteur (`HEIGHT_ORIGIN`) du bâtiment auquel appartient chaque sommet. */
  origins: Uint8Array;
  indices: Uint32Array;
  /** Longitude / latitude du centre de la tuile, pour que le rendu place le maillage. */
  centre: { longitudeDeg: number; latitudeDeg: number };
  stats: {
    buildings: number;
    /** Anneaux écartés : moins de trois sommets distincts, ou surface nulle. */
    skippedDegenerate: number;
    /** Anneaux que la triangulation n'a pas su couvrir (surface des triangles ≠ surface). */
    triangulationFailed: number;
  };
}

export const DEFAULT_SKIRT_METRES = 15;
export const DEFAULT_FLAT_PLATE_METRES = 0.3;

/** Aire signée d'un anneau (positive si l'anneau tourne dans le sens trigonométrique). */
function signedArea(points: Vector2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function buildBuildingMesh(
  tile: BuildingTile,
  options: BuildingMeshOptions
): BuildingMesh {
  const skirt = options.skirtMetres ?? DEFAULT_SKIRT_METRES;
  const plate = options.flatPlateMetres ?? DEFAULT_FLAT_PLATE_METRES;
  const [centreLon, centreLat] = dequantizeFromTile(32768, 32768, tile);

  const positions: number[] = [];
  const normals: number[] = [];
  const origins: number[] = [];
  const indices: number[] = [];
  const stats = { buildings: 0, skippedDegenerate: 0, triangulationFailed: 0 };

  const push = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    origin: number
  ): number => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    origins.push(origin);
    return positions.length / 3 - 1;
  };

  for (const building of tile.buildings) {
    // Anneau en (est, nord) : mètres autour du centre de la tuile.
    const ring: Vector2[] = [];
    for (let i = 0; i < building.ring.length; i += 2) {
      const [lon, lat] = dequantizeFromTile(
        building.ring[i]!,
        building.ring[i + 1]!,
        tile
      );
      ring.push(
        new Vector2(
          (lon - centreLon) * options.metresPerDegreeLon,
          (lat - centreLat) * options.metresPerDegreeLat
        )
      );
    }
    let area = signedArea(ring);
    if (!(Math.abs(area) > 1e-6)) {
      stats.skippedDegenerate++;
      continue;
    }
    // Sens trigonométrique vu d'en haut : les murs et le toit en dépendent.
    if (area < 0) {
      ring.reverse();
      area = -area;
    }
    const origin = building.origin;
    const heightMetres =
      origin === HEIGHT_ORIGIN.absent
        ? plate
        : Math.max(plate, building.heightDecimetres / 10);
    const bottom = -skirt;

    // Toit : triangulation de l'anneau, remise dans le sens qui regarde vers le haut.
    const triangles = ShapeUtils.triangulateShape(ring, []);
    let covered = 0;
    for (const [a, b, c] of triangles) {
      const pa = ring[a!]!;
      const pb = ring[b!]!;
      const pc = ring[c!]!;
      covered += Math.abs(signedArea([pa, pb, pc]));
    }
    if (Math.abs(covered - area) > area * 1e-6 + 1e-6)
      stats.triangulationFailed++;
    const roofStart = positions.length / 3;
    for (const p of ring) push(p.x, heightMetres, -p.y, 0, 1, 0, origin);
    // `triangulateShape` rend les triangles dans le sens de l'anneau, déjà remis dans le sens
    // trigonométrique : vus d'en haut ils regardent vers le haut, et le test des faces le tient.
    for (const [a, b, c] of triangles)
      indices.push(roofStart + a!, roofStart + b!, roofStart + c!);

    // Murs : un quadrilatère par arête, sommets PROPRES (normale plate par face).
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const length = Math.hypot(dx, dy);
      if (!(length > 1e-9)) continue;
      // Sens trigonométrique : la normale SORTANTE est à droite de l'arête, (dy, −dx).
      const nx = dy / length;
      const nz = dx / length; // y_nord = −dx/length, z = −nord → +dx/length
      const v0 = push(p.x, bottom, -p.y, nx, 0, nz, origin);
      const v1 = push(q.x, bottom, -q.y, nx, 0, nz, origin);
      const v2 = push(q.x, heightMetres, -q.y, nx, 0, nz, origin);
      const v3 = push(p.x, heightMetres, -p.y, nx, 0, nz, origin);
      indices.push(v0, v1, v2, v0, v2, v3);
    }
    stats.buildings++;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    origins: new Uint8Array(origins),
    indices: new Uint32Array(indices),
    centre: { longitudeDeg: centreLon, latitudeDeg: centreLat },
    stats,
  };
}
