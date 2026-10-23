/**
 * LE FOND DE LOIN (2026-10-23) : de loin la Terre se montre dans l'image la plus récente, de près
 * dans la plus fine.
 *
 * Sentinel-2 est l'édition ANNUELLE de la scène (10 m) ; VIIRS est l'image du JOUR (250 m). À
 * l'échelle d'un hémisphère un texel de 250 m est déjà sous le pixel d'écran, donc la finesse de
 * Sentinel-2 n'y gagne rien et son âge (jusqu'à un an) s'y voit. Sous le seuil, c'est l'inverse :
 * 250 m s'agrandit en bouillie, 10 m tient.
 *
 * LE SEUIL DE SORTIE DOIT RESTER AU-DESSUS DU PLANCHER DE LA TEXTURE LIVRÉE. Le plancher
 * d'approche suit la finesse de ce qui est PEINT : si le jeu du jour n'arrive pas (réseau en
 * échec), il reste celui de la texture livrée, mesuré à 1,073 rayon sur un écran de 800 px et
 * proportionnel à la hauteur de l'écran (~1,15 sur 4K). Un seuil de sortie plus bas (1,06 au
 * premier essai, repéré par un scénario e2e) bloquait la caméra à 466 km sans que rien ne
 * puisse la laisser repasser sur le fond fin.
 *
 * Le seuil porte une HYSTÉRÉSIS : sans elle, une caméra qui oscille autour de lui changerait de
 * jeu de tuiles à chaque passage, et chaque changement relance un chargement.
 */

/** Distance caméra-centre, en rayons de corps, au-dessus de laquelle on montre le jour. */
export const FAR_BASE_ENTER_RADII = 1.5;
/** En dessous de cette distance on revient au fond fin. Plus bas que l'entrée, volontairement. */
export const FAR_BASE_LEAVE_RADII = 1.3;

/**
 * Faut-il montrer l'image du jour ? `wasFar` est la réponse précédente, qui donne sa mémoire à
 * l'hystérésis.
 */
export function showsFarBase(
  distanceInRadii: number,
  wasFar: boolean
): boolean {
  if (!Number.isFinite(distanceInRadii)) return wasFar;
  return wasFar
    ? distanceInRadii > FAR_BASE_LEAVE_RADII
    : distanceInRadii > FAR_BASE_ENTER_RADII;
}
