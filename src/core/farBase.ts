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
 * Au-dessus de cette distance, rien : le moteur ne demande aucune tuile (la texture livrée suffit,
 * mesuré : 0 tuile à 1,92 rayon, 18 à 1,66), et attacher le jeu du jour ferait lire pour rien le
 * fichier de ses jours publiés, au démarrage de chaque visiteur. « Rien n'est demandé de loin » est
 * un invariant du dépôt, un scénario e2e du démarrage mobile l'a fait respecter.
 */
export const FAR_BASE_CEILING_RADII = 1.8;
/**
 * LES NUAGES RÉELS À L'ÉCRAN (GAL-EARTH-CLOUD-IMMERSION-001, 2026-11-24). Les nuages de la couche
 * « Nuages (NASA) » sont une image MONDIALE de 2 048 px (~20 km par texel) : ils s'effacent
 * (`core/dataMagnification.ts`) vers 2 500 km d'altitude. Le seul endroit où les nuages RÉELS du jour
 * survivent plus bas est l'image du jour elle-même (VIIRS, 250 m, nuages compris). Mesuré sur une
 * descente réelle (NOAA-21, 2026-11-20, îles Kerguelen, 92 % de nuages dans la source) : un cyclone
 * de nuages à 3 189 km, un océan sans un nuage à 1 264 km, parce que le fond quittait le jour à 1,3
 * rayon pour la mosaïque Sentinel-2, sans nuage par construction.
 *
 * Tant que la couche est visible et a posé une image, le fond du jour reste donc jusqu'à ce que 250 m
 * devienne plus gros que le pixel d'écran (~1,5 pixel par texel à 127 km d'altitude), où Sentinel-2
 * reprend. Le plancher de la caméra sur le jeu du jour (mesuré à 30 km) reste SOUS cette sortie, comme
 * l'exige la règle ci-dessus. Sentinel-2 ne montre aucun nuage : sous ce seuil le sol est celui de
 * l'année, et le bandeau de source le dit.
 */
export const FAR_BASE_CLOUDS_ENTER_RADII = 1.04;
/** Sortie vers le fond fin quand les nuages réels sont à l'écran (~127 km d'altitude). */
export const FAR_BASE_CLOUDS_LEAVE_RADII = 1.02;

/** Hystérésis du plafond : une fois dans la bande, on n'en sort qu'un peu plus haut. */
export const FAR_BASE_CEILING_EXIT_RADII = 1.9;

/**
 * Faut-il montrer l'image du jour ? `wasFar` est la réponse précédente, qui donne sa mémoire à
 * l'hystérésis.
 */
export function showsFarBase(
  distanceInRadii: number,
  wasFar: boolean,
  keepsClouds = false
): boolean {
  if (!Number.isFinite(distanceInRadii)) return wasFar;
  const leave = keepsClouds
    ? FAR_BASE_CLOUDS_LEAVE_RADII
    : FAR_BASE_LEAVE_RADII;
  const enter = keepsClouds
    ? FAR_BASE_CLOUDS_ENTER_RADII
    : FAR_BASE_ENTER_RADII;
  const floor = wasFar ? leave : enter;
  const ceiling = wasFar ? FAR_BASE_CEILING_EXIT_RADII : FAR_BASE_CEILING_RADII;
  return distanceInRadii > floor && distanceInRadii < ceiling;
}
