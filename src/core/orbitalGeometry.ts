/**
 * Géométrie orbitale du mode Éducatif — fonctions pures (cf. orbitalGeometry.test.ts).
 *
 * Une orbite circulaire de rayon `r`, parcourue par l'angle `angle`, est placée dans le
 * plan écliptique (repère Three.js : plan XZ, +Y nord, droitier) via ses éléments J2000 :
 *   - i (inclinaison)   : angle du plan orbital par rapport à l'écliptique
 *   - Ω (nœud ascendant): rotation du plan orbital autour du pôle écliptique
 *
 * Les axes du plan orbital dans le repère scène :
 *   e1 = ( cosΩ, 0, -sinΩ )                — direction du nœud ascendant
 *   e2 = ( -sinΩ·cosI, sinI, -cosΩ·cosI )  — perpendiculaire dans le plan orbital
 *   position(angle) = r·(cosA·e1 + sinA·e2)
 *
 * Le -sinΩ / -cosΩ sur Z (repère droitier +Y nord) donne une orbite prograde, cohérente
 * avec la convention de `equatorialToScene` (cf. frames.ts).
 */
import * as THREE from 'three';

/** Position sur l'orbite circulaire inclinée, dans le repère scène. */
export function orbitalPositionEduc(
  r: number,
  angle: number,
  inclination: number,
  ascendingNode: number
): THREE.Vector3 {
  const cosΩ = Math.cos(ascendingNode),
    sinΩ = Math.sin(ascendingNode);
  const cosI = Math.cos(inclination),
    sinI = Math.sin(inclination);
  const cosA = Math.cos(angle),
    sinA = Math.sin(angle);
  return new THREE.Vector3(
    r * (cosΩ * cosA - sinΩ * sinA * cosI),
    r * sinA * sinI,
    -r * (sinΩ * cosA + cosΩ * sinA * cosI)
  );
}

/**
 * Projection inverse : retrouve l'angle orbital d'une position scène (plan XZ écliptique)
 * sur les axes e1/e2 du plan orbital. Utilisé pour ré-ancrer les angles éducatifs sur les
 * vraies positions d'astronomy-engine.
 *   angle = atan2(pos·e2, pos·e1)
 */
export function angleInOrbitalPlane(
  pos: THREE.Vector3,
  inclination: number,
  ascendingNode: number
): number {
  const cosΩ = Math.cos(ascendingNode),
    sinΩ = Math.sin(ascendingNode);
  const cosI = Math.cos(inclination),
    sinI = Math.sin(inclination);
  const dotE1 = pos.x * cosΩ - pos.z * sinΩ;
  const dotE2 = -pos.x * sinΩ * cosI + pos.y * sinI - pos.z * cosΩ * cosI;
  return Math.atan2(dotE2, dotE1);
}
