/**
 * Le zoom de la caméra proportionnel à l'ALTITUDE, pas à la distance au centre.
 *
 * OrbitControls multiplie la distance caméra→centre par un facteur fixe à chaque cran. Près de la
 * surface, cette distance est dominée par le rayon de l'astre : à 1,15 rayon, un cran de 3,5 % de
 * la distance emporte 27 % de l'altitude restante, et l'approche finale saute. Ici le facteur
 * s'applique à l'altitude (distance moins dégagement) : la vitesse décroît exponentiellement vers
 * la surface, et loin du corps (altitude ≈ distance) le comportement est celui d'avant.
 *
 * Pur et sans état. `clearance` est le rayon à ne pas traverser (`getClearanceRadius`) ; sans corps
 * suivi (vue d'ensemble), il vaut 0 et rien ne change.
 */

/**
 * Facteur à appliquer à la distance pour un cran de `scale` (< 1 rapproche, comme le
 * `dollyScale` d'OrbitControls) ; `inward` vaut vrai pour un rapprochement, faux pour un éloignement.
 */
export function altitudeDistanceFactor(
  distance: number,
  clearance: number,
  scale: number,
  inward: boolean
): number {
  if (!(clearance > 0) || !(distance > clearance)) {
    return inward ? scale : 1 / scale;
  }
  const altitude = distance - clearance;
  const next = clearance + altitude * (inward ? scale : 1 / scale);
  return next / distance;
}
