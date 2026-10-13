/**
 * LA CAMÉRA REGARDE L'HORIZON EN DESCENDANT (lot 48, pas 5, 2026-10-13).
 *
 * La caméra orbite autour du CENTRE du corps suivi et le regarde : de loin c'est le bon cadrage
 * (le globe au milieu de l'image), mais près du sol la vue reste verticale, et un relief mesuré
 * vu d'aplomb n'est qu'une carte. Ce module dit de combien la relever, sans rien changer à sa
 * POSITION : le zoom, le glisser, le plancher d'approche et les permaliens restent ceux du suivi.
 *
 * La règle est géométrique, avec un seul choix de cadrage. Depuis une altitude `h` au-dessus d'un
 * rayon `R`, l'horizon (le limbe) est vu à `acos(R / (R + h))` sous l'horizontale, c'est-à-dire à
 * `90° − acos(R / (R + h))` du nadir. On garde ce limbe à {@link HORIZON_ABOVE_CENTRE_OF_FOV} du
 * champ vertical AU-DESSUS du centre de l'image : le sixième supérieur est du ciel. Le
 * relèvement depuis le nadir vaut donc `90° − creux − fov / 3`, et il est nul tant que le limbe
 * tient déjà sous cette ligne, c'est-à-dire tant que le globe ne remplit pas l'image : de loin
 * rien ne change, et la bascule commence d'elle-même là où le limbe atteint le haut du cadre
 * (vers 2,2 rayons d'altitude pour un champ de 55°), continue jusqu'au sol.
 */

/** Fraction du champ VERTICAL dont le limbe est tenu au-dessus du centre de l'image. */
export const HORIZON_ABOVE_CENTRE_OF_FOV = 1 / 3;

/**
 * Relèvement de la visée depuis le nadir, en radians (0 = la caméra regarde le centre du corps).
 *
 * `distance` : de la caméra au centre du corps ; `groundRadius` : rayon du sol SOUS la caméra
 * (relief et ellipsoïde compris), dans la même unité ; `verticalFovDeg` : champ vertical.
 * Sous le sol ou sans rayon, 0 : rien à relever.
 */
export function horizonTiltRad(
  distance: number,
  groundRadius: number,
  verticalFovDeg: number
): number {
  if (!(groundRadius > 0) || !(distance > groundRadius)) return 0;
  const limbFromNadir = Math.PI / 2 - Math.acos(groundRadius / distance);
  const above =
    ((verticalFovDeg * Math.PI) / 180) * HORIZON_ABOVE_CENTRE_OF_FOV;
  return Math.max(0, limbFromNadir - above);
}
