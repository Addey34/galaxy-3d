/**
 * LA PLONGÉE SUR UN LIEU NOMMÉ (lot 63, pas A) : à quelle distance du centre du corps placer la
 * caméra pour qu'une formation REMPLISSE une part voulue de la vue. Pur, sans état, testé : la
 * caméra, les tuiles et les noms n'y entrent pas.
 *
 * Deux sources de taille, parce que la Terre n'a pas de diamètre publié (l'UAI ne la nomme pas) :
 * un diamètre en km pour les corps du gazetteer, un niveau de zoom d'apparition pour les noms de
 * Natural Earth (plus il est haut, plus l'objet est petit, donc plus on s'approche).
 */

/** Part de la plus petite dimension de la vue que la formation doit occuper. */
export const DIVE_FILL = 0.4;

/** Une formation plus grande que cela (en rayons) ne se « plonge » pas : on la cadre de loin. */
const MAX_DIVE_DISTANCE_RADII = 4;

/** Altitude plancher, en rayons : en dessous, les tuiles servies ne gagnent plus rien. */
export const MIN_DIVE_ALTITUDE_RADII = 0.0005;

/**
 * Altitude (km, au-dessus de la surface) à laquelle une formation de `diameterKm` occupe la part
 * `fill` de la plus petite dimension d'une vue de champ vertical `fovDeg` et de rapport `aspect`.
 * L'angle limitant est le plus petit des deux champs (vertical, horizontal).
 */
export function altitudeToFrame(
  diameterKm: number,
  fovDeg: number,
  aspect: number,
  fill: number = DIVE_FILL
): number {
  if (!(diameterKm > 0) || !(fovDeg > 0) || !(aspect > 0) || !(fill > 0))
    return 0;
  const vertical = (fovDeg * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const limiting = Math.min(vertical, horizontal);
  return diameterKm / fill / (2 * Math.tan(limiting / 2));
}

/**
 * Niveau de zoom de carte web → diamètre (km) qu'un nom de ce niveau recouvre : une tuile de
 * 256 px au niveau `zoom` mesure `40 075 / 2^zoom` km à l'équateur, et un nom s'écrit sur à peu
 * près une tuile au niveau où il apparaît.
 */
export function diameterFromWebZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 0;
  return 40075.016686 / 2 ** zoom;
}

/**
 * Distance au CENTRE du corps (même unité que `radius`) pour la plongée : altitude de cadrage
 * ajoutée au rayon, bornée en bas par l'altitude plancher et en haut par `MAX_DIVE_DISTANCE_RADII`.
 * `radiusKm` fait le pont entre l'altitude en km et le rayon en unités de scène.
 */
export function diveDistance(
  radius: number,
  radiusKm: number,
  altitudeKm: number
): number {
  if (!(radius > 0) || !(radiusKm > 0)) return 0;
  const altitudeRadii = Math.max(
    MIN_DIVE_ALTITUDE_RADII,
    Math.max(0, altitudeKm) / radiusKm
  );
  return radius * Math.min(1 + altitudeRadii, MAX_DIVE_DISTANCE_RADII);
}
