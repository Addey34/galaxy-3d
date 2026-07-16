/**
 * Transformations de repères — fonctions pures, sans état ni dépendance à Three.js
 * au-delà du type Vector3. Testables unitairement (cf. frames.test.ts).
 *
 * Chaîne : équatorial J2000 (EQJ, repère d'astronomy-engine) → écliptique → Three.js.
 *   - Plan XZ = plan écliptique (orbites des planètes)
 *   - Axe +Y  = pôle nord écliptique (quasi-immobile)
 */
import * as THREE from 'three';

/** Obliquité de l'écliptique (inclinaison de l'axe terrestre) — 23.4394°. */
export const OBLIQUITY_RAD = 23.4394 * (Math.PI / 180);
const COS_OBL = Math.cos(OBLIQUITY_RAD);
const SIN_OBL = Math.sin(OBLIQUITY_RAD);

/**
 * Convertit un vecteur équatorial J2000 (AU) vers le repère Three.js.
 *
 * Étape 1 — rotation obliquité : équatorial → écliptique
 *   ex =  x
 *   ey =  y·cos(ε) + z·sin(ε)   (dans le plan écliptique)
 *   ez = -y·sin(ε) + z·cos(ε)   (perpendiculaire, ≈ 0 pour les planètes)
 *
 * Étape 2 — mapping Three.js (plan XZ = plan écliptique, +Y = nord écliptique) :
 *   Three.X = ex,  Three.Y = ez,  Three.Z = -ey
 *
 * Le -ey est ESSENTIEL : sans lui le mapping est une réflexion (déterminant -1)
 * qui inverse le sens des orbites (rétrograde vu de +Y) et les met en miroir.
 * Avec -ey c'est une rotation propre (déterminant +1) : orbites progrades
 * (sens anti-horaire vu de +Y), cohérentes avec la convention de spin
 * (rotation.y += rotationSpeed > 0 = prograde).
 *
 * Comme c'est une rotation propre, elle s'applique telle quelle aussi bien à une
 * position qu'à une direction (ex. pôle de rotation) — pas de translation.
 */
export function equatorialToScene(x: number, y: number, z: number): THREE.Vector3 {
  const ex =  x;
  const ey =  y * COS_OBL + z * SIN_OBL;
  const ez = -y * SIN_OBL + z * COS_OBL;
  return new THREE.Vector3(ex, ez, -ey);
}

/**
 * Convertit un vecteur héliocentrique écliptique J2000 (AU) vers le repère Three.js.
 *
 * Les éléments orbitaux des petits corps (JPL Small-Body Database, Minor Planet Center)
 * sont exprimés dans le plan de l'écliptique : la propagation de Kepler produit donc
 * directement des coordonnées écliptiques, sans passer par l'obliquité. Il ne reste que le
 * mapping écliptique → Three.js (identique à l'étape 2 de `equatorialToScene`) :
 *   Three.X = x,  Three.Y = z,  Three.Z = -y
 * C'est la même rotation propre (déterminant +1), donc orbites progrades cohérentes.
 */
export function eclipticToScene(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}
