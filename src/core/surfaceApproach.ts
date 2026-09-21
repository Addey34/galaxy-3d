/**
 * Ce qui décide jusqu'où on peut descendre vers une surface — module pur, testé.
 *
 * Cinq grandeurs, et une seule d'entre elles est un choix de produit : l'agrandissement
 * maximal accepté. Les autres sont de l'arithmétique, et c'est pour cela qu'elles vivent ici
 * plutôt qu'en ligne dans `CameraSystem` ou dans un panneau de diagnostic :
 *
 *   - le PLAN PROCHE d'un suivi rapproché (`followNearPlane`), dont la règle a déjà été
 *     fausse une fois, et de la façon la plus silencieuse qui soit ;
 *   - la PROFONDEUR : un tampon de profondeur de B bits, entre `near` et `far`, ne distingue
 *     pas deux surfaces plus proches que `depthResolutionKm` ; c'est ce qui fait scintiller
 *     deux coques concentriques (surface et nuages) vues de près ;
 *   - la SILHOUETTE : une sphère de N segments n'est pas une sphère, et l'écart au limbe est
 *     calculable (`facetDeviationKm`) ;
 *   - la TEXTURE : une image équirectangulaire de W pixels a une taille de texel au sol, et
 *     l'agrandissement à l'écran est le rapport entre ce texel et un pixel
 *     (`texelMagnification`) — au-delà de 1, on montre l'image agrandie, jamais du détail
 *     que la source possède ;
 *   - le PLANCHER d'approche (`approachFloorRadiusFactor`), dérivé de cette finesse, et
 *     exprimé indifféremment en facteur de rayon ou en altitude.
 *
 * Aucune de ces fonctions ne connaît Three.js ni le DOM. Elles prennent des kilomètres et
 * des pixels, et rendent des kilomètres et des pixels.
 */

import { DEG_TO_RAD } from './MathConstants';

/**
 * Plus petit écart de profondeur que le tampon distingue, à une distance donnée.
 *
 * Projection perspective classique (celle de Three.js hors `logarithmicDepthBuffer`) : la
 * profondeur écrite est affine en 1/z, donc `d(z) = (1/n − 1/z) / (1/n − 1/f)` et
 * `Δz = z² (1/n − 1/f) / (2^B − 1)`. La précision est donc la MEILLEURE près du `near` et
 * la pire au loin, et elle se dégrade avec le carré de la distance.
 */
export function depthResolutionKm(params: {
  nearKm: number;
  farKm: number;
  distanceKm: number;
  depthBits: number;
}): number {
  const { nearKm, farKm, distanceKm, depthBits } = params;
  if (nearKm <= 0 || farKm <= nearKm || distanceKm <= 0 || depthBits <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const steps = Math.pow(2, depthBits) - 1;
  return (distanceKm * distanceKm * (1 / nearKm - 1 / farKm)) / steps;
}

/**
 * Écart maximal entre une sphère de `segments` segments et la sphère vraie, en kilomètres.
 *
 * C'est la flèche (sagitta) d'une corde couvrant un segment : le milieu d'une facette est
 * RENTRÉ de `r (1 − cos(π/N))` sous la surface. Au limbe, c'est exactement l'amplitude de
 * la dentelure visible.
 */
export function facetDeviationKm(radiusKm: number, segments: number): number {
  if (radiusKm <= 0 || segments <= 0) return 0;
  return radiusKm * (1 - Math.cos(Math.PI / segments));
}

/**
 * Taille au sol d'un texel d'une image équirectangulaire, à l'équateur, en kilomètres.
 *
 * Une équirectangulaire de W pixels couvre 360 degrés de longitude : un texel vaut donc
 * `2πr / W`. C'est la résolution RÉELLE de ce que la scène affiche, quelle que soit la
 * finesse de la géométrie qui la porte.
 */
export function groundTexelKm(
  textureWidthPx: number,
  radiusKm: number
): number {
  if (textureWidthPx <= 0 || radiusKm <= 0) return Number.POSITIVE_INFINITY;
  return (2 * Math.PI * radiusKm) / textureWidthPx;
}

/**
 * Pixels d'écran par kilomètre de sol, au nadir, pour une caméra à `altitudeKm`.
 *
 * Approximation assumée et suffisante ici : sol plan vu de face, donc l'étendue visible
 * vaut `2 h tan(fov/2)` sur la hauteur du viewport. Au limbe, la vraie valeur est plus
 * petite (la surface s'éloigne et s'incline) ; ce que l'on veut mesurer est le cas le plus
 * favorable, celui qui décide si l'image a encore quelque chose à montrer.
 */
export function screenPixelsPerKm(params: {
  altitudeKm: number;
  fovDeg: number;
  viewportHeightPx: number;
}): number {
  const { altitudeKm, fovDeg, viewportHeightPx } = params;
  if (altitudeKm <= 0 || fovDeg <= 0 || viewportHeightPx <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const groundSpanKm = 2 * altitudeKm * Math.tan((fovDeg * DEG_TO_RAD) / 2);
  return viewportHeightPx / groundSpanKm;
}

/**
 * Combien de pixels d'écran occupe un texel de la source. 1 = l'image est montrée à sa
 * résolution ; 10 = elle est agrandie dix fois, et l'écran n'apporte aucune information que
 * la source n'a pas.
 */
export function texelMagnification(params: {
  textureWidthPx: number;
  radiusKm: number;
  altitudeKm: number;
  fovDeg: number;
  viewportHeightPx: number;
}): number {
  const texelKm = groundTexelKm(params.textureWidthPx, params.radiusKm);
  const pxPerKm = screenPixelsPerKm(params);
  return texelKm * pxPerKm;
}

/**
 * Plan proche à utiliser en suivi rapproché : la MOITIÉ DE L'ALTITUDE, jamais plus.
 *
 * Écrite ici parce que c'est de l'arithmétique, et parce que la règle a déjà été fausse une
 * fois de la façon la plus coûteuse qui soit : un plancher exprimé en fraction du RAYON
 * (1 %) passe devant la surface dès qu'on descend sous cette fraction, et le corps entier
 * disparaît — sans erreur, sans trace, sans rien à l'écran qui l'explique. Mesuré le
 * 2026-09-20 : Lune invisible sous 17,4 km, Terre sous 63,7 km, Mars sous 33,9 km. Le
 * minimum ne sert qu'à rester strictement positif si la caméra touche la sphère de
 * dégagement ; il n'a pas à protéger la précision de profondeur, que le far borne déjà.
 */
export function followNearPlane(
  distance: number,
  clearanceRadius: number,
  minimum: number
): number {
  return Math.max((distance - clearanceRadius) * 0.5, minimum);
}

/**
 * Écran de référence contre lequel le plancher d'approche est jugé.
 *
 * Le plancher doit être une propriété du CORPS, pas de la fenêtre : sinon la distance
 * qu'on peut atteindre changerait en redimensionnant le navigateur. On fixe donc une fois
 * l'écran sur lequel la lisibilité a été REGARDÉE (1280 × 800, champ de visite 55°, celui de
 * `CAMERA_SETTINGS.focusFov`) et on en déduit un budget en texels, qui lui ne dépend plus de
 * rien. Mesuré le 2026-09-20 sur la Lune, texture de surface 8k : à 115 km d'altitude
 * (8,9 px par texel) les cratères se lisent encore ; à 63 km (16,3) l'image n'est plus
 * qu'une bouillie, et à 1 km un texel couvre tout l'écran.
 */
export const APPROACH_REFERENCE = {
  viewportHeightPx: 800,
  fovDeg: 55,
  /** Agrandissement maximal accepté : au-delà, l'écran n'apporte rien que la source ait. */
  magnificationPxPerTexel: 8,
} as const;

/** Budget d'altitude, en texels de la source, dérivé de l'écran de référence. */
export function approachTexelBudget(
  reference: {
    viewportHeightPx: number;
    fovDeg: number;
    magnificationPxPerTexel: number;
  } = APPROACH_REFERENCE
): number {
  const { viewportHeightPx, fovDeg, magnificationPxPerTexel } = reference;
  return (
    viewportHeightPx /
    (2 * magnificationPxPerTexel * Math.tan((fovDeg * DEG_TO_RAD) / 2))
  );
}

/**
 * Plancher d'approche d'un corps, en multiples de son rayon, DÉRIVÉ de la finesse de
 * l'image qu'il affiche.
 *
 * Le facteur ne dépend pas du rayon, et ce n'est pas une approximation : l'altitude visée
 * vaut `budget × 2πr / W` et le facteur `1 + altitude / r`, où `r` disparaît. Un corps qui
 * n'affiche qu'une texture 1k s'arrête donc plus haut qu'un corps en 8k, ce qui est la même
 * règle que partout ailleurs dans ce dépôt : ne pas montrer un détail que la source n'a pas.
 */
export function approachFloorRadiusFactor(
  textureWidthPx: number,
  texelBudget: number = approachTexelBudget()
): number {
  if (textureWidthPx <= 0 || texelBudget <= 0) return 1;
  return 1 + (texelBudget * 2 * Math.PI) / textureWidthPx;
}

/** Altitude au-dessus de la surface, en km, pour un plancher exprimé en rayons. */
export function altitudeKmForRadiusFactor(
  radiusKm: number,
  factor: number
): number {
  return radiusKm * (factor - 1);
}

/** Facteur de rayon donnant une altitude visée, en km. Réciproque exacte de la précédente. */
export function radiusFactorForAltitudeKm(
  radiusKm: number,
  altitudeKm: number
): number {
  if (radiusKm <= 0) return 1;
  return 1 + altitudeKm / radiusKm;
}
