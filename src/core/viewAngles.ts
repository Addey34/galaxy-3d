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

/**
 * Marge, en rayons du corps de référence, laissée entre la caméra et sa surface. Elle couvre
 * ses coques (atmosphère, nuages), un peu plus grandes que le globe.
 */
export const VIEW_FROM_CLEARANCE = 1.15;

/**
 * La distance à la cible quand on la regarde DEPUIS un autre corps : la distance courante,
 * sauf si elle placerait la caméra DANS ce corps (ligne 45.2, 2026-10-08).
 *
 * Défaut MESURÉ par la sonde d'éclipse : en Éducatif la Lune est à 2,24 unités de la Terre,
 * dont le rayon vaut 1, et la caméra cadrait la Lune à 2,0 : elle se trouvait à 0,24 du centre
 * de la Terre. Ce qu'on voyait alors dépendait des coques terrestres dessinées depuis
 * l'intérieur, et la garde de la Lune cuivrée lisait une fois sur plusieurs un disque gris
 * (rouge/bleu 1,36). Un observateur réel se tient à la SURFACE de la Terre, pas en son centre.
 *
 * `separation` est la distance de la cible au corps de référence, `referenceRadius` son rayon
 * à l'échelle affichée. Si la cible touche presque ce corps, on garde la distance courante.
 */
export function viewFromDistance(
  current: number,
  separation: number,
  referenceRadius: number
): number {
  const room = separation - referenceRadius * VIEW_FROM_CLEARANCE;
  if (!(room > 0)) return current;
  return Math.min(current, room);
}
