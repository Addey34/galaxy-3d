/**
 * La distance qui choisit le palier d'une texture, et pourquoi la table est ce qu'elle est.
 *
 * Un palier de largeur W donne au plus W / pi texels en travers du disque d'un corps (la moitié
 * visible d'une carte équirectangulaire, au centre) : au-delà, des texels sont téléchargés,
 * décodés et téléversés pour rien, un disque de D pixels n'en montre pas plus de D.
 * Avec un champ vertical de 65 degrés et une fenêtre de 800 pixels, le disque d'un corps à
 * `d` rayons mesure 1 256 / d pixels (le double à densité 2). Le 4k suffit donc tant que le
 * disque reste sous 1 303 pixels, soit `d` >= 0,96 à densité 1 et 1,93 à densité 2 ; le 2k
 * jusqu'à 1,93 et 3,86 ; le 1k jusqu'à 3,86 et 7,7. La table de `config/engine.ts` (8k sous
 * 2,5 rayons, 4k sous 5, 2k sous 10, 1k au-delà) tient avec un quart de marge ce pire cas de
 * 800 pixels à densité 2 ; sur 1 080 pixels de haut à densité 2 elle est à peine tenue (4 % sous
 * le besoin). Elle était à 10, 20, 40 et 80 : un 8k pour un disque de 170 pixels.
 *
 * Le champ de vision compte autant que la distance : le zoom optique (`ui/opticalZoom`) rétrécit
 * le champ et grossit le disque sans bouger la caméra. La distance utilisée ici est donc celle
 * qui, au champ de référence, donnerait le même disque.
 */
export const LOD_REFERENCE_FOV_DEG = 65;

const REFERENCE_TAN = Math.tan((LOD_REFERENCE_FOV_DEG * Math.PI) / 360);

/** La distance en rayons, ramenée à ce que ferait le champ de référence pour un disque égal. */
export function textureLodDistance(
  normalizedDistance: number,
  fovDeg: number
): number {
  if (!(fovDeg > 0 && fovDeg < 180)) return normalizedDistance;
  return (
    (normalizedDistance * Math.tan((fovDeg * Math.PI) / 360)) / REFERENCE_TAN
  );
}
