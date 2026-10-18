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

/**
 * Élévation du profil au-dessus de l'écliptique, côté nord, en degrés (lot 58).
 *
 * MESURÉE à l'image sur la visite des saisons (vrai GPU, 2026-10-18) : à 0°, dans le plan même
 * de l'écliptique, les deux pôles tombent sur le bord du disque, et la légende « le pôle nord
 * reste éclairé tout le jour » ne se voit pas. En s'élevant dans le plan perpendiculaire au
 * Soleil, la limite du jour et de la nuit reste une droite verticale (ce plan contient la
 * direction de la caméra), et la calotte nord entre dans le disque.
 */
export const PROFILE_ELEVATION_DEG = 25;

/**
 * La direction d'où regarder une cible de PROFIL par rapport à un corps de référence (lot 58) :
 * à angle droit de la direction de ce corps, élevée de `PROFILE_ELEVATION_DEG` au-dessus du plan
 * horizontal de la scène, qui est l'écliptique (`core/frames.ts`). `toReference` va de la cible
 * vers ce corps.
 *
 * C'est la figure 3 de la fiche « Une année sur la Terre » de l'ESA (PR45) : la Terre vue de
 * côté, le Soleil d'un côté, la limite du jour et de la nuit VERTICALE au milieu du disque, et
 * l'axe penché vers le Soleil ou à l'opposé selon la saison. Vue depuis le Soleil, la même Terre
 * est un disque plein éclairé dont le terminateur se perd au bord.
 *
 * Le sens est fixé par `toReference × (0, 1, 0)`. La caméra regardant la cible avec +Y pour
 * haut, sa droite est alors la composante horizontale de `toReference` : le corps de référence
 * est TOUJOURS à droite, et une visite qui saute de saison en saison garde le même cadrage.
 * `null` si le corps est à la verticale de la cible (aucun profil défini).
 */
export function profileDirection(
  toReference: THREE.Vector3
): THREE.Vector3 | null {
  const side = new THREE.Vector3().crossVectors(
    toReference,
    new THREE.Vector3(0, 1, 0)
  );
  if (side.lengthSq() < 1e-12 * Math.max(toReference.lengthSq(), 1e-300))
    return null;
  const elevation = THREE.MathUtils.degToRad(PROFILE_ELEVATION_DEG);
  return side
    .normalize()
    .multiplyScalar(Math.cos(elevation))
    .add(new THREE.Vector3(0, Math.sin(elevation), 0));
}
