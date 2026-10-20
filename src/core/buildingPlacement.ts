/**
 * LE PLACEMENT DES TUILES DE BÂTIMENTS SUR UN CORPS (lot 63, étape C.3b) : quelles tuiles autour
 * de la visée, et comment orienter le maillage local d'une tuile sur la sphère. Pur, sans état.
 *
 * Le maillage de `core/buildingMesh.ts` est en mètres dans un repère (x est, y haut, z sud). Ici
 * on le place : `up` est la direction de la sphère en ce point, `east` et `north` sont ses dérivées
 * par rapport à la longitude et à la latitude, DANS LA MÊME paramétrisation que les couches de
 * surface (`frames.geographicToLocalDirection`). Écrire ces dérivées à part, sans le confronter à
 * cette fonction, décalerait les bâtiments par rapport aux continents sans que rien ne le dise :
 * le test les compare à la dérivée numérique de la surface.
 */
import * as THREE from 'three';

import { tileOfLonLat, type BuildingTileIdentity } from './buildingTile';
import { geographicToLocalDirection } from './frames';

export interface LocalBasis {
  east: THREE.Vector3;
  north: THREE.Vector3;
  up: THREE.Vector3;
}

/** Est, nord et haut en un point, dans le repère local du corps (celui de ses couches). */
export function localBasisAt(
  latitudeDeg: number,
  longitudeDeg: number
): LocalBasis {
  const lat = (latitudeDeg * Math.PI) / 180;
  const phi = (longitudeDeg * Math.PI) / 180 + Math.PI;
  const up = geographicToLocalDirection(latitudeDeg, longitudeDeg);
  // d(direction)/d(longitude) ramenée à 1, puis d(direction)/d(latitude).
  const east = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
  const north = new THREE.Vector3(
    Math.cos(phi) * Math.sin(lat),
    Math.cos(lat),
    -Math.sin(phi) * Math.sin(lat)
  );
  return { east, north, up };
}

/**
 * Rotation qui amène le repère du maillage (x est, y haut, z SUD) sur celui du corps en un point.
 * La troisième colonne est l'OPPOSÉ du nord : un repère droit, dont le déterminant vaut +1.
 */
export function meshRotationAt(
  latitudeDeg: number,
  longitudeDeg: number
): THREE.Quaternion {
  const { east, north, up } = localBasisAt(latitudeDeg, longitudeDeg);
  const south = north.clone().negate();
  const matrix = new THREE.Matrix4().makeBasis(east, up, south);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

/**
 * Les tuiles d'un carré de `rings` anneaux autour de celle de la visée, la visée d'abord puis par
 * distance croissante : au plafond du palier, on garde les plus proches et on le dit. `rings` = 0
 * rend la seule tuile de la visée.
 */
export function tilesAround(
  longitudeDeg: number,
  latitudeDeg: number,
  zoom: number,
  rings: number
): BuildingTileIdentity[] {
  const centre = tileOfLonLat(longitudeDeg, latitudeDeg, zoom);
  const n = 2 ** zoom;
  const out: BuildingTileIdentity[] = [];
  for (let dr = -rings; dr <= rings; dr++) {
    for (let dc = -rings; dc <= rings; dc++) {
      const row = centre.row + dr;
      if (row < 0 || row >= n) continue;
      // La colonne boucle sur l'antiméridien ; la ligne, non.
      const column = (((centre.column + dc) % n) + n) % n;
      out.push({ zoom, column, row });
    }
  }
  const distance = (t: BuildingTileIdentity): number => {
    // Distance en colonnes la plus courte, bouclage compris.
    const dc = Math.min(
      Math.abs(t.column - centre.column),
      n - Math.abs(t.column - centre.column)
    );
    return Math.hypot(dc, t.row - centre.row);
  };
  return out.sort((a, b) => distance(a) - distance(b));
}

/** Mètres par degré de latitude et de longitude à une latitude, pour une sphère de rayon donné. */
export function metresPerDegree(
  latitudeDeg: number,
  radiusMetres: number
): { metresPerDegreeLat: number; metresPerDegreeLon: number } {
  const perDegree = (Math.PI / 180) * radiusMetres;
  return {
    metresPerDegreeLat: perDegree,
    metresPerDegreeLon: perDegree * Math.cos((latitudeDeg * Math.PI) / 180),
  };
}
