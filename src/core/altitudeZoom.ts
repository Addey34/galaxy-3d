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

/**
 * Garde numérique, pas un réglage : sous 1e-6 de la vitesse d'orbite (un mètre à 1 000 km de
 * distance) le geste n'a plus d'effet visible, et zéro figerait la caméra. Un plancher de 2 %
 * (première version, #476) laissait la surface filer 125 fois trop vite à 1 km d'altitude.
 */
export const MOTION_FLOOR = 1e-6;

/**
 * Facteur à appliquer à l'orbite et au déplacement latéral : altitude / distance au centre.
 *
 * OrbitControls tourne d'un angle fixe autour du CENTRE du corps, à la distance `d` : la caméra
 * avance de `d` × angle, alors que le sol sous elle est à l'altitude `a`. La vitesse APPARENTE du
 * sol (angle vu par la caméra) vaut donc `d` × angle / `a`, et elle explose près de la surface.
 * Multiplier l'angle par a / d la rend constante : le déplacement réel est proportionnel à
 * l'altitude, comme le zoom (qui multiplie l'altitude par un facteur fixe). Le déplacement
 * latéral (`_pan`, proportionnel à `d` dans OrbitControls) suit la même règle.
 *
 * Loin du corps (a ≈ d) le facteur vaut 1 ; sans dégagement (vue d'ensemble) il vaut 1.
 */
export function altitudeMotionFactor(
  distance: number,
  clearance: number
): number {
  if (!(clearance > 0)) return 1;
  if (!(distance > clearance)) return MOTION_FLOOR;
  return Math.max(MOTION_FLOOR, (distance - clearance) / distance);
}
