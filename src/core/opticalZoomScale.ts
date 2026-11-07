/**
 * L'échelle du curseur de zoom optique : logarithmique en GROSSISSEMENT, pas linéaire en degrés.
 *
 * Le grossissement d'un champ vertical `f` vaut 1 / tan(f / 2). Entre 55° et 8° il est multiplié
 * par 7,44, mais la première moitié d'une course LINÉAIRE en degrés (55° à 31,5°) n'en donne que
 * 1,85 et la seconde 4,03 : mou au début, brusque à la fin, et le réglage fin des champs étroits
 * (là où on vise un détail) est le plus difficile. Placer le curseur en logarithme du grossissement
 * donne le même rapport par pas sur toute la course.
 *
 * Pur et sans état : le curseur (`ui/opticalZoom`) ne fait que convertir. Le zoom ne change que
 * `PerspectiveCamera.fov`, jamais l'échelle d'un objet (invariant du mode Exploration).
 */

/** Course du curseur : positions entières de 0 (champ large) à `ZOOM_POSITION_MAX` (champ étroit). */
export const ZOOM_POSITION_MAX = 1000;

/** Pas du curseur au clavier : 200 pas, soit environ 1 % de grossissement par appui. */
export const ZOOM_POSITION_STEP = 5;

const magnification = (fovDeg: number): number =>
  1 / Math.tan((fovDeg * Math.PI) / 360);

/** Position (0 à `ZOOM_POSITION_MAX`) d'un champ vertical en degrés, borné à [minFov, maxFov]. */
export function zoomPositionFromFov(
  fovDeg: number,
  minFov: number,
  maxFov: number
): number {
  const clamped = Math.min(maxFov, Math.max(minFov, fovDeg));
  const gMin = magnification(maxFov);
  const gMax = magnification(minFov);
  const t = Math.log(magnification(clamped) / gMin) / Math.log(gMax / gMin);
  return Math.round(t * ZOOM_POSITION_MAX);
}

/** Champ vertical en degrés d'une position du curseur ; l'inverse de `zoomPositionFromFov`. */
export function fovFromZoomPosition(
  position: number,
  minFov: number,
  maxFov: number
): number {
  const t = Math.min(1, Math.max(0, position / ZOOM_POSITION_MAX));
  const gMin = magnification(maxFov);
  const gMax = magnification(minFov);
  const g = gMin * Math.pow(gMax / gMin, t);
  return (2 * Math.atan(1 / g) * 180) / Math.PI;
}
