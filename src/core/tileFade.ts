/**
 * LE FONDU D'ENTRÉE D'UN CARREAU (2026-10-19).
 *
 * Un carreau d'imagerie arrive quand son image est décodée, par vagues, et remplace d'un coup la
 * texture de base de la sphère. Quand les deux n'ont pas la même couleur (l'océan du Blue Marble
 * de GIBS vaut (2, 5, 20), celui de la texture de base (63, 82, 110)), l'eau de la scène
 * s'assombrit par à-coups, de proche en proche, et cela se lit comme un défaut qui « se
 * propage » (mesuré à 1 306 km : le bleu perd 22 % en quelques secondes). Le fondu n'ôte pas la
 * différence de couleur, il ôte l'à-coup.
 *
 * Piloté par le TEMPS écoulé et non par un nombre d'images : en rendu logiciel une image dure
 * plusieurs secondes, et un fondu compté en images ne finirait jamais.
 */

/** Durée du fondu d'un carreau, en millisecondes. */
export const TILE_FADE_MS = 400;

/** Opacité d'un carreau `elapsedMs` après son apparition : 0 puis 1, sans à-coup aux deux bouts. */
export function tileFadeOpacity(
  elapsedMs: number,
  durationMs: number = TILE_FADE_MS
): number {
  if (!(durationMs > 0)) return 1;
  const t = Math.max(0, Math.min(1, elapsedMs / durationMs));
  return t * t * (3 - 2 * t);
}
