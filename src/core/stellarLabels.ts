/**
 * LA PRIORITÉ DES NOMS de la vue stellaire : quand deux noms se recouvrent à l'écran, le plus
 * prioritaire reste, l'autre se tait. Pur, testé : l'ordre est un CONTRAT (la campagne de CI de
 * GAL-UNIVERSE-002 a montré, sur les polices larges de Linux, un repère d'échelle masquer le nom de
 * Proxima Centauri).
 *
 * Soleil et axe galactique d'abord, puis les étoiles de la plus proche à la plus lointaine, puis les
 * repères d'instrument (cercles d'un parsec, cercles d'UA) : un repère ne masque jamais un nom d'étoile.
 */
export const SUN_LABEL_PRIORITY = 1000;
export const AXIS_LABEL_PRIORITY = 900;

/** De 100 (au Soleil) à 50 (à l'étoile la plus lointaine) : toujours au-dessus des repères. */
export function starLabelPriority(
  distancePc: number,
  extentPc: number
): number {
  return 100 - 50 * Math.min(1, Math.max(0, distancePc / extentPc));
}

/** Cercle du `n`-ième parsec (1, 2…) : 39 à 31, sous toutes les étoiles. */
export function parsecRingLabelPriority(parsecs: number): number {
  return 40 - Math.min(9, Math.max(1, parsecs));
}

/** Cercle d'UA d'indice `k` (0 = 1 UA) : 20 à 0, sous les cercles de parsecs. */
export function auRingLabelPriority(k: number): number {
  return 20 - Math.min(20, Math.max(0, k));
}
