/**
 * ATTÉNUATION DES LIGNES D'ORBITE À L'APPROCHE D'UN CORPS.
 *
 * Défaut signalé, et visible sur les captures de rendu : approché d'un corps, un trait
 * d'orbite passe DEVANT le globe. Géométriquement c'est juste — la ligne est réellement entre
 * la caméra et la planète, puisque la caméra est à l'intérieur de l'orbite. Mais lu à l'écran,
 * un trait qui traverse une planète opaque se lit comme une planète transparente : c'est la
 * seule interprétation disponible pour l'œil, qui ne sait pas que ce trait est en avant-plan.
 * Le rapport a d'ailleurs été exactement celui-là — « elle est devenue transparente la terre
 * entière ».
 *
 * Le `depthTest` ne peut rien : il est déjà actif et fait son travail, la ligne est vraiment
 * devant. Ce n'est pas un défaut de profondeur, c'est un défaut de PERTINENCE — à cette
 * distance, l'orbite n'est plus l'information recherchée, le corps l'est.
 *
 * La règle est donc énoncée en RAYONS DU CORPS et non en unités de scène : c'est le seul
 * cadrage qui vaille pour Mercure comme pour Jupiter, et il survit au changement d'échelle
 * éduc↔explo, où les distances sont recomprimées mais le rapport à la taille apparente ne
 * l'est pas. `asin(rayon / distance)` donne la taille angulaire correspondante, ce qui rend
 * les deux bornes lisibles plutôt qu'arbitraires.
 */

const smootherstep01 = (t: number): number =>
  t * t * t * (t * (t * 6 - 15) + 10);

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/**
 * En deçà : plus aucune ligne. Le corps fait alors plus de 3,8° de rayon apparent, soit près
 * de huit fois la Lune vue de la Terre — on n'est plus en train de regarder une orbite, on est
 * arrivé. La sonde de terminateur cadre à 4,2 rayons, et c'est dans ce cadrage que le trait en
 * travers du globe a été constaté.
 */
export const ORBIT_FADE_NEAR_RADII = 15;

/**
 * Au-delà : ligne pleine. Le corps y fait moins de 1° de rayon apparent, à peu près la Lune
 * vue de la Terre ; il se lit comme un point sur sa trajectoire, et c'est la trajectoire qui
 * porte l'information. Entre les deux la transition est un smootherstep — à pente ET courbure
 * nulles aux deux bornes, donc sans instant où la ligne « saute ».
 */
export const ORBIT_FADE_FAR_RADII = 60;

/**
 * Opacité d'une ligne d'orbite, d'après la distance de la caméra AU CORPS QU'ELLE DÉCRIT.
 *
 * Chaque ligne est jugée sur son propre corps : l'orbite d'un corps lointain reste pleine
 * pendant que celle du corps approché s'efface. Une règle globale « on est en gros plan, tout
 * s'efface » supprimerait justement le contexte que les autres orbites apportent.
 *
 * Un rayon nul, négatif ou non fini ne permet pas de juger : on rend alors l'opacité de base
 * inchangée, jamais 0 — faire disparaître une ligne sur une donnée manquante serait le pire
 * des deux comportements, puisque rien à l'écran ne le signalerait.
 */
export function orbitLineOpacity(
  cameraDistance: number,
  bodyRadius: number,
  baseOpacity: number
): number {
  if (!Number.isFinite(bodyRadius) || bodyRadius <= 0) return baseOpacity;
  if (!Number.isFinite(cameraDistance)) return baseOpacity;
  const radii = Math.max(cameraDistance, 0) / bodyRadius;
  const t = clamp01(
    (radii - ORBIT_FADE_NEAR_RADII) /
      (ORBIT_FADE_FAR_RADII - ORBIT_FADE_NEAR_RADII)
  );
  return baseOpacity * smootherstep01(t);
}
