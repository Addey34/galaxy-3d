import * as THREE from 'three';

/**
 * Angles de caméra (convention `OrbitControls` / `Vector3.setFromSphericalCoords`) pour
 * regarder une cible DEPUIS une direction donnée : `direction` va de la cible vers l'endroit
 * où l'on veut placer la caméra.
 *
 * Sert aux pages d'éclipse de Lune. Une Lune éclipsée ne montre sa couleur que sur la face
 * tournée vers la Terre : c'est elle qui est face au Soleil, donc la seule qu'éclaire la
 * lumière réfractée par l'atmosphère terrestre (cf. `core/eclipse.ts`). Cadrée depuis
 * n'importe où ailleurs, la page s'ouvrait sur un disque noir — la nuit lunaire, pas l'ombre.
 */
export function viewAnglesFromDirection(direction: THREE.Vector3): {
  azimuthDeg: number;
  polarDeg: number;
} | null {
  if (direction.lengthSq() === 0) return null;
  const unit = direction.clone().normalize();
  return {
    // `setFromSphericalCoords` pose x = sinφ·sinθ et z = sinφ·cosθ : θ = atan2(x, z).
    azimuthDeg: THREE.MathUtils.radToDeg(Math.atan2(unit.x, unit.z)),
    // φ est mesuré depuis +Y, d'où l'arc cosinus de la composante verticale.
    polarDeg: THREE.MathUtils.radToDeg(
      Math.acos(THREE.MathUtils.clamp(unit.y, -1, 1))
    ),
  };
}
