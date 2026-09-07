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
export function equatorialToScene(
  x: number,
  y: number,
  z: number
): THREE.Vector3 {
  const ex = x;
  const ey = y * COS_OBL + z * SIN_OBL;
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
export function eclipticToScene(
  x: number,
  y: number,
  z: number
): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

/**
 * Direction unitaire dans le repère LOCAL d'un mesh sphérique → point géographique
 * (latitude/longitude en degrés) sur la texture équirectangulaire posée dessus.
 *
 * C'est la réciproque exacte de la paramétrisation de `THREE.SphereGeometry` :
 *   x = -r·cos(phi)·sin(theta),  y = r·cos(theta),  z = r·sin(phi)·sin(theta)
 *   u = phi / 2π   (uv.x),   v = theta / π  puis  uv.y = 1 - v
 * et de la convention d'une texture équirectangulaire standard (Blue Marble, GIBS…) :
 * uv.x = 0 au méridien 180° W, uv.x = 1 au 180° E ; uv.y = 1 au pôle Nord.
 *
 * Sert à répondre à une question qu'aucun autre outil du projet ne sait poser : le point
 * subsolaire tombe-t-il sur la BONNE longitude de la texture ? La géométrie de l'ombre est
 * juste par construction (elle ne dépend que de dot(normale, Soleil)), mais la phase de
 * rotation de la Terre décide, elle, de QUELLE ville se trouve sous cette ombre. Une erreur
 * de phase décale donc les continents et les lumières par rapport au terminateur sans jamais
 * déformer le terminateur lui-même.
 */
export function localDirectionToGeographic(direction: THREE.Vector3): {
  latitudeDeg: number;
  longitudeDeg: number;
} {
  const d = direction.clone().normalize();
  const latitudeDeg =
    Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) * (180 / Math.PI);
  // phi ∈ [0, 2π) puis u ∈ [0, 1) ; uv.x = 0 correspond à 180° W, d'où le décalage de 0.5.
  const phi = Math.atan2(d.z, -d.x);
  const u = (phi / (2 * Math.PI) + 1) % 1;
  return { latitudeDeg, longitudeDeg: (u - 0.5) * 360 };
}

/**
 * Angle de rotation propre (`_meshGroup.rotation.y`) qui amène le point subsolaire sur la
 * longitude géographique voulue.
 *
 * `sunDirectionInSpinFrame` est la direction Terre→Soleil exprimée dans le repère où le corps
 * TOURNE (celui du `_tiltGroup`, aligné sur le vrai pôle IAU), pas dans le repère de la scène.
 * La distinction n'est pas cosmétique : le plan XZ de la scène est l'ÉCLIPTIQUE, alors que la
 * longitude subsolaire (RA − GAST) est une grandeur ÉQUATORIALE. Mesurer l'azimut du Soleil
 * dans l'écliptique puis le composer avec une longitude équatoriale laisse exactement l'écart
 * RA − λ, c'est-à-dire le terme d'obliquité de l'équation du temps : ±2.47° d'amplitude, nul
 * aux équinoxes ET aux solstices, extrême entre les deux. Ce décalage fait pivoter les
 * continents et les lumières de ville par rapport au terminateur sans jamais déformer le
 * terminateur lui-même — celui-ci ne dépend que de dot(normale, Soleil), donc reste juste.
 *
 * Réciproque de `localDirectionToGeographic` : on cherche l'angle tel que, une fois la
 * direction du Soleil ramenée dans le repère local du mesh, sa longitude vaille celle visée.
 * Une rotation +r du mesh diminue de r l'azimut d'une direction fixe vue en coordonnées
 * locales, d'où le signe.
 */
export function surfaceRotationForSubsolarLongitude(
  sunDirectionInSpinFrame: THREE.Vector3,
  subsolarLongitudeRad: number
): number {
  const phi = Math.atan2(sunDirectionInSpinFrame.z, -sunDirectionInSpinFrame.x);
  return phi - subsolarLongitudeRad - Math.PI;
}
