/**
 * REPÈRE GALACTIQUE DU FOND DE CIEL : où la Voie lactée est VRAIMENT dans la scène.
 *
 * La texture du fond (`textures/stars`) est une image équirectangulaire en coordonnées
 * GALACTIQUES, mesurée le 2026-11-03 sur 150 points sources de l'image 4k confrontés aux étoiles
 * de magnitude ≤ 3,2 du catalogue HYG : 107 tombent sur une vraie étoile (à 1,2°) avec ces trois
 * conventions, contre 4 à 6 pour chacune des trois autres combinaisons :
 *   - le centre de l'image est le centre galactique (l = 0°, b = 0°) ;
 *   - la longitude l croît vers la GAUCHE de l'image ;
 *   - le haut de l'image est le pôle galactique SUD (b = −90°).
 * Lue sans rotation, la bande courait le long de l'écliptique de la scène, à 60° du plan galactique.
 *
 * Ce module ne contient que la matrice qui ramène une direction de la scène à la direction à lire
 * dans l'image. Pur, sans état.
 */
import { OBLIQUITY_RAD } from './frames';

/** Matrice équatorial J2000 (ICRS) → galactique, IAU 1958 / Hipparcos (ESA 1997, vol. 1, éq. 1.5.11). */
export const EQUATORIAL_TO_GALACTIC: readonly number[] = [
  -0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.44482963,
  0.7469822445, -0.867666149, -0.1980763734, 0.4559837762,
];

type Mat3 = readonly number[];

function mul(a: Mat3, b: Mat3): number[] {
  const out: number[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      out.push(
        a[r * 3]! * b[c]! +
          a[r * 3 + 1]! * b[3 + c]! +
          a[r * 3 + 2]! * b[6 + c]!
      );
  return out;
}

/**
 * Direction de la scène (X, Y, Z) → équatorial J2000 : l'inverse exact de
 * `frames.equatorialToScene` (écliptique : ex = X, ey = −Z, ez = Y, puis rotation de l'obliquité).
 */
function sceneToEquatorial(): number[] {
  const c = Math.cos(OBLIQUITY_RAD);
  const s = Math.sin(OBLIQUITY_RAD);
  return [1, 0, 0, 0, -s, -c, 0, c, -s];
}

/** Galactique (x, y, z) → direction à lire dans l'image, d'après les trois conventions ci-dessus. */
const GALACTIC_TO_IMAGE: Mat3 = [1, 0, 0, 0, 0, -1, 0, -1, 0];

/** Matrice 3×3 (ligne par ligne) : direction de la scène → direction d'échantillonnage de l'image. */
export function sceneToSkyImage(): number[] {
  return mul(
    GALACTIC_TO_IMAGE,
    mul(EQUATORIAL_TO_GALACTIC, sceneToEquatorial())
  );
}

/** Applique une matrice ligne par ligne à un vecteur. */
export function apply(m: Mat3, v: readonly [number, number, number]) {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ] as const;
}
