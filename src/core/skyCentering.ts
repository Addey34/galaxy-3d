/**
 * Centrer l'écran sur un objet du CIEL (étoile, système d'exoplanètes, objet du ciel profond)
 * sans perdre le corps suivi.
 *
 * `OrbitControls` regarde toujours sa cible : viser l'objet en plein centre revient à placer le
 * corps suivi DEVANT lui. On garde donc la caméra en orbite autour du corps, on la tourne d'un
 * petit angle pour dégager l'objet, puis on décale la FENÊTRE de projection (`setViewOffset`)
 * jusqu'à ce que la direction de l'objet tombe au centre de l'écran. Le corps reste dans le champ,
 * de côté. Pur : aucun accès au DOM ni à la scène, testé dans `skyCentering.test.ts`.
 */

/** Écart minimal et maximal de la visée, en fraction du demi-champ de l'axe concerné. */
const MIN_TURN_FRACTION = 0.3;
const MAX_TURN_FRACTION = 0.8;
/** Marge autour du disque du corps, en rayons apparents, pour que l'objet ne soit pas masqué. */
const BODY_CLEARANCE = 1.5;
/** Part du demi-champ ajoutée à la marge, pour dégager un corps très petit ou très lointain. */
const BASE_TURN_FRACTION = 0.15;

/**
 * L'angle dont on tourne la visée, en radians.
 *
 * Il dégage le disque du corps (rayon apparent `bodyAngularRadiusRad`) avec une marge, mais reste
 * compris entre 30 % et 80 % du demi-champ : plus petit, le corps resterait collé à l'objet ;
 * plus grand, il sortirait de l'écran. Un corps qui remplit déjà le champ ne peut pas être
 * dégagé : il est alors simplement poussé le plus loin permis.
 */
export function centeringTurnRad(
  bodyAngularRadiusRad: number,
  halfFieldRad: number
): number {
  const wanted =
    BODY_CLEARANCE * Math.max(0, bodyAngularRadiusRad) +
    BASE_TURN_FRACTION * halfFieldRad;
  return Math.min(
    MAX_TURN_FRACTION * halfFieldRad,
    Math.max(MIN_TURN_FRACTION * halfFieldRad, wanted)
  );
}

/**
 * Demi-champ HORIZONTAL, l'axe sur lequel on tourne la visée : le corps sort de côté, jamais par le
 * haut ou le bas, où se trouvent la fiche et la barre de temps. `verticalFovRad` est le champ
 * vertical de la caméra, `aspect` largeur / hauteur.
 */
export function halfHorizontalFieldRad(
  verticalFovRad: number,
  aspect: number
): number {
  return Math.atan(Math.tan(verticalFovRad / 2) * aspect);
}

/**
 * Rayon apparent d'un corps de rayon `radius` vu à `distance` de sa surface vers son centre.
 * Un point dans le corps (distance <= rayon) le remplit : demi-angle droit.
 */
export function bodyAngularRadiusRad(radius: number, distance: number): number {
  if (!(radius > 0) || !(distance > 0)) return 0;
  if (distance <= radius) return Math.PI / 2;
  return Math.asin(radius / distance);
}

/**
 * Tangentes de la direction `local` (repère de la caméra : +X à droite, +Y en haut, la caméra
 * regarde vers −Z) : la position de cette direction sur le plan image à une unité de la caméra.
 * `null` si la direction est derrière la caméra ou dans son plan : elle ne se projette pas.
 */
export function projectedTangents(
  local: readonly [number, number, number]
): { tx: number; ty: number } | null {
  const depth = -local[2];
  if (!(depth > 1e-9)) return null;
  return { tx: local[0] / depth, ty: local[1] / depth };
}

/**
 * Décalage de la fenêtre de projection, en pixels, qui amène la direction de tangentes `tx`, `ty`
 * à la hauteur `anchorY` de l'écran (0,5 = le centre ; 0 = le haut, 1 = le bas : on vise le
 * milieu de la zone que la fiche ne recouvre pas). `heightPx` et `verticalFovRad` sont ceux de la
 * vue, `k` l'avancement (0 = vue d'origine, 1 = centré). Le décalage vertical est NÉGATIF vers le
 * haut : l'axe Y des pixels descend, celui de `setViewOffset` aussi.
 */
export function viewOffsetPixels(
  tx: number,
  ty: number,
  heightPx: number,
  verticalFovRad: number,
  k: number,
  anchorY = 0.5
): { x: number; y: number } {
  const focalPx = heightPx / 2 / Math.tan(verticalFovRad / 2);
  return {
    x: tx * focalPx * k,
    y: (-ty * focalPx + (0.5 - anchorY) * heightPx) * k,
  };
}

/** Une fiche plus large que cette part de l'écran est une feuille en haut (téléphone), pas un coin. */
const SHEET_WIDTH_SHARE = 0.6;
/** Part de la hauteur gardée libre en bas pour la barre de temps et ses commandes. */
const BOTTOM_BAR_SHARE = 0.12;

/**
 * Hauteur (0 à 1) où centrer l'objet. Au bureau la fiche occupe un coin : le centre de l'écran reste
 * libre (0,5). Sur téléphone elle couvre la largeur en haut : on vise le milieu de la zone entre
 * son bord bas et la barre de temps, sinon l'objet arriverait SOUS la fiche.
 */
export function freeBandAnchor(
  card: { width: number; bottom: number },
  viewport: { width: number; height: number }
): number {
  if (!(viewport.height > 0) || card.width < SHEET_WIDTH_SHARE * viewport.width)
    return 0.5;
  const top = card.bottom / viewport.height;
  const bottom = 1 - BOTTOM_BAR_SHARE;
  if (!(bottom > top)) return 0.5;
  return (top + bottom) / 2;
}
