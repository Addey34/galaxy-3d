/**
 * GÉOMÉTRIE D'UN CARREAU DE SURFACE — module pur, testé, sans Three.js (lot 9, phases 9C/9D).
 *
 * Un carreau est un morceau de la sphère du corps, éventuellement DÉPLACÉ radialement par des
 * hauteurs mesurées. Le calcul vit ici et pas dans `components/surface/SurfaceTile.ts` pour la
 * raison habituelle du dépôt : une orientation fausse ne lève aucune erreur, elle pose
 * simplement le relief au mauvais endroit, et seul un test peut le dire.
 *
 * La paramétrisation est CELLE DE LA SURFACE DU CORPS, recopiée de
 * `frames.geographicToLocalDirection` (`phi = longitude + π`, `theta = 90° − latitude`), donc
 * celle de `THREE.SphereGeometry` et d'une équirectangulaire standard. Elle est mesurée depuis
 * le lot 8 contre quatre épicentres publiés de l'USGS : un second chemin serait la faute type.
 *
 * Trois points qui ne sont pas des détails :
 *
 *  - **les hauteurs arrivent avec une couronne** (`apron`) d'un échantillon tout autour. Sans
 *    elle, les normales des sommets de bord seraient calculées par différence unilatérale et
 *    l'éclairage montrerait la grille des carreaux au terminateur ;
 *  - **la jupe descend jusqu'à une profondeur donnée** et ses triangles sont orientés d'après
 *    la géométrie, pas d'après une règle de signe écrite à la main : une jupe retournée est
 *    invisible de face et laisse voir la sphère à travers ;
 *  - **aucun détail n'est inventé** : entre deux échantillons de hauteur, le carreau est
 *    exactement un quadrilatère plat. Pas de bruit, pas de rehaussement.
 */
import type { TileBounds } from './tilePyramid';

const DEG_TO_RAD = Math.PI / 180;

/** Hauteurs d'un carreau : `(segments + 3)²` déplacements radiaux, couronne comprise. */
export interface PatchHeights {
  /**
   * Déplacements radiaux en unités LOCALES du corps (pas en mètres : la conversion appartient à
   * l'appelant, qui seul connaît le rayon de la sphère rendue et le rayon de référence du
   * modèle d'élévation). Rangés du nord-ouest au sud-est, couronne incluse.
   */
  values: Float32Array;
  /** Segments du maillage : `values` compte donc `(segments + 3)²` entrées. */
  segments: number;
}

export interface TilePatchSpec {
  bounds: TileBounds;
  /** Rayon local de la sphère du corps. */
  radius: number;
  segments: number;
  heights?: PatchHeights;
  /** Profondeur de la jupe, en unités locales. 0 ou absent : aucune jupe. */
  skirtDepth?: number;
}

export interface TilePatchGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Direction unitaire du point de surface (latitude, longitude), convention du corps. */
function direction(
  latitudeDeg: number,
  longitudeDeg: number,
  out: [number, number, number]
): [number, number, number] {
  const lat = latitudeDeg * DEG_TO_RAD;
  const phi = longitudeDeg * DEG_TO_RAD + Math.PI;
  const cosLat = Math.cos(lat);
  out[0] = -Math.cos(phi) * cosLat;
  out[1] = Math.sin(lat);
  out[2] = Math.sin(phi) * cosLat;
  return out;
}

/** Construit le maillage d'un carreau. */
export function buildTilePatch(spec: TilePatchSpec): TilePatchGeometry {
  const { bounds, radius } = spec;
  const segments = Math.max(1, Math.floor(spec.segments));
  const heights = spec.heights;
  if (heights && heights.segments !== segments)
    throw new Error(
      `hauteurs pour ${heights.segments} segments, carreau à ${segments}`
    );
  const side = segments + 1;
  const apron = segments + 3;
  const lonSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;

  /** Déplacement radial d'un sommet, couronne comprise (`i`, `j` peuvent valoir −1 ou n+1). */
  const displacement = (i: number, j: number): number =>
    heights ? (heights.values[(j + 1) * apron + (i + 1)] ?? 0) : 0;

  // Sommets de la nappe, plus la couronne : celle-ci ne produit aucun triangle, elle ne sert
  // qu'à donner des normales justes sur le bord.
  const withApron = (i: number, j: number, out: [number, number, number]) => {
    const longitude = bounds.west + (lonSpan * i) / segments;
    const latitude = bounds.north - (latSpan * j) / segments;
    direction(latitude, longitude, out);
    const r = radius + displacement(i, j);
    out[0] *= r;
    out[1] *= r;
    out[2] *= r;
    return out;
  };

  const vertexCount = side * side;
  const skirtDepth = spec.skirtDepth ?? 0;
  const borderCount = skirtDepth > 0 ? 4 * segments : 0;
  const positions = new Float32Array((vertexCount + borderCount) * 3);
  const normals = new Float32Array((vertexCount + borderCount) * 3);
  const uvs = new Float32Array((vertexCount + borderCount) * 2);

  const p: [number, number, number] = [0, 0, 0];
  const east: [number, number, number] = [0, 0, 0];
  const west: [number, number, number] = [0, 0, 0];
  const north: [number, number, number] = [0, 0, 0];
  const south: [number, number, number] = [0, 0, 0];

  for (let j = 0; j < side; j += 1) {
    for (let i = 0; i < side; i += 1) {
      const index = j * side + i;
      withApron(i, j, p);
      positions[index * 3] = p[0];
      positions[index * 3 + 1] = p[1];
      positions[index * 3 + 2] = p[2];
      uvs[index * 2] = i / segments;
      uvs[index * 2 + 1] = 1 - j / segments;

      if (!heights) {
        // Sphère : la normale EST la direction. Inutile de la dériver.
        const length = Math.hypot(p[0], p[1], p[2]) || 1;
        normals[index * 3] = p[0] / length;
        normals[index * 3 + 1] = p[1] / length;
        normals[index * 3 + 2] = p[2] / length;
        continue;
      }
      // Différences centrées sur la couronne : `i − 1` et `j + 1` existent toujours.
      withApron(i + 1, j, east);
      withApron(i - 1, j, west);
      withApron(i, j - 1, north);
      withApron(i, j + 1, south);
      const ux = east[0] - west[0];
      const uy = east[1] - west[1];
      const uz = east[2] - west[2];
      const vx = north[0] - south[0];
      const vy = north[1] - south[1];
      const vz = north[2] - south[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length > 0) {
        nx /= length;
        ny /= length;
        nz /= length;
      } else {
        const radial = Math.hypot(p[0], p[1], p[2]) || 1;
        nx = p[0] / radial;
        ny = p[1] / radial;
        nz = p[2] / radial;
      }
      normals[index * 3] = nx;
      normals[index * 3 + 1] = ny;
      normals[index * 3 + 2] = nz;
    }
  }

  const indices: number[] = [];
  const touchesNorthPole = bounds.north >= 90 - 1e-9;
  const touchesSouthPole = bounds.south <= -90 + 1e-9;
  for (let j = 0; j < segments; j += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = j * side + i + 1;
      const b = j * side + i;
      const c = (j + 1) * side + i;
      const d = (j + 1) * side + i + 1;
      // Au pôle exact, les sommets d'une ligne sont confondus : le triangle qui s'y appuie est
      // dégénéré. Même règle que `THREE.SphereGeometry`, qui l'omet.
      if (j !== 0 || !touchesNorthPole) indices.push(a, b, d);
      if (j !== segments - 1 || !touchesSouthPole) indices.push(b, c, d);
    }
  }

  if (skirtDepth > 0) {
    appendSkirt({
      indices,
      positions,
      normals,
      uvs,
      segments,
      side,
      vertexCount,
      skirtDepth,
    });
  }

  return {
    positions,
    normals,
    uvs,
    indices: new Uint32Array(indices),
  };
}

/**
 * Ajoute la jupe : une paroi verticale sous le bord du carreau.
 *
 * Elle bouche deux choses : la fissure entre deux carreaux de niveaux voisins pendant un
 * changement de niveau, et l'espace entre le bord de la couverture et la sphère du corps, que
 * le moteur abaisse au minimum mesuré du jeu de hauteurs pour ne pas masquer les fonds.
 */
function appendSkirt(params: {
  indices: number[];
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  segments: number;
  side: number;
  vertexCount: number;
  skirtDepth: number;
}): void {
  const { indices, positions, normals, uvs, segments, side, vertexCount } =
    params;
  // Bord du carreau, dans l'ordre : nord d'ouest en est, est du nord au sud, sud d'est en
  // ouest, ouest du sud au nord. Un tour complet, chaque coin une seule fois.
  const border: number[] = [];
  for (let i = 0; i < segments; i += 1) border.push(i);
  for (let j = 0; j < segments; j += 1) border.push(j * side + segments);
  for (let i = segments; i > 0; i -= 1) border.push(segments * side + i);
  for (let j = segments; j > 0; j -= 1) border.push(j * side);

  const centre = [0, 0, 0];
  for (const index of border) {
    centre[0] += positions[index * 3]!;
    centre[1] += positions[index * 3 + 1]!;
    centre[2] += positions[index * 3 + 2]!;
  }
  for (let k = 0; k < 3; k += 1) centre[k]! /= border.length;

  for (let k = 0; k < border.length; k += 1) {
    const top = border[k]!;
    const skirt = vertexCount + k;
    const x = positions[top * 3]!;
    const y = positions[top * 3 + 1]!;
    const z = positions[top * 3 + 2]!;
    const length = Math.hypot(x, y, z) || 1;
    const factor = Math.max(0, (length - params.skirtDepth) / length);
    positions[skirt * 3] = x * factor;
    positions[skirt * 3 + 1] = y * factor;
    positions[skirt * 3 + 2] = z * factor;
    // La jupe n'est pas là pour se voir : elle emprunte la normale de son sommet de bord, donc
    // elle s'éclaire comme le sol qu'elle prolonge au lieu de dessiner un liseré sombre.
    normals[skirt * 3] = normals[top * 3]!;
    normals[skirt * 3 + 1] = normals[top * 3 + 1]!;
    normals[skirt * 3 + 2] = normals[top * 3 + 2]!;
    uvs[skirt * 2] = uvs[top * 2]!;
    uvs[skirt * 2 + 1] = uvs[top * 2 + 1]!;
  }

  for (let k = 0; k < border.length; k += 1) {
    const a = border[k]!;
    const b = border[(k + 1) % border.length]!;
    const c = vertexCount + ((k + 1) % border.length);
    const d = vertexCount + k;
    // Orientation DÉDUITE de la géométrie : la normale de la face doit fuir le centre du
    // carreau. L'écrire « à la main » demanderait quatre règles de signe, une par bord, et une
    // jupe retournée ne se voit pas — elle laisse simplement passer la sphère.
    const outward = faceOutward(positions, a, b, d, centre);
    if (outward) indices.push(a, b, d, b, c, d);
    else indices.push(a, d, b, b, d, c);
  }
}

/** La face (a, b, c) tourne-t-elle sa normale vers l'extérieur du carreau ? */
function faceOutward(
  positions: Float32Array,
  a: number,
  b: number,
  c: number,
  centre: number[]
): boolean {
  const ax = positions[a * 3]!;
  const ay = positions[a * 3 + 1]!;
  const az = positions[a * 3 + 2]!;
  const ux = positions[b * 3]! - ax;
  const uy = positions[b * 3 + 1]! - ay;
  const uz = positions[b * 3 + 2]! - az;
  const vx = positions[c * 3]! - ax;
  const vy = positions[c * 3 + 1]! - ay;
  const vz = positions[c * 3 + 2]! - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return (
    nx * (ax - centre[0]!) + ny * (ay - centre[1]!) + nz * (az - centre[2]!) > 0
  );
}
