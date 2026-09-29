/**
 * LES NOMS DE LA SURFACE : la part PURE, celle qui décide quoi montrer et où.
 *
 * Le répertoire livré vient du Gazetteer of Planetary Nomenclature de l'UAI
 * (`pnpm gazetteer:generate`). Ce module ne connaît ni le DOM, ni Three.js : il convertit la
 * convention de coordonnées, et il tranche la seule question qui compte à l'affichage — quels
 * noms, parmi les neuf mille de la Lune, méritent d'être écrits à cette distance-là.
 */

/** Une formation nommée, telle que le fichier livré la porte. */
export interface NamedFeature {
  readonly name: string;
  /** Code de type de l'UAI (`AA` albedo, `MO` mons, `CR` crater…). */
  readonly code: string;
  /** Type en toutes lettres, tel que l'UAI l'écrit. */
  readonly type: string;
  /** Latitude planétocentrique, degrés. */
  readonly lat: number;
  /** Longitude EST, 0 à 360 — la convention des fichiers KML de l'UAI. */
  readonly lon: number;
  readonly diameterKm: number;
  /** Date d'adoption par l'UAI, ISO court. */
  readonly approved: string;
  /** La raison du nom, recopiée telle que l'UAI la publie. */
  readonly origin: string;
  /** Identifiant de fiche UAI : c'est lui qui rend le nom vérifiable à la source. */
  readonly iauId: number;
}

/**
 * LA CONVERSION DE LONGITUDE, ÉCRITE PLUTÔT QUE SUPPOSÉE.
 *
 * L'UAI publie ses KML en longitude EST de **0 à 360** (sa page de téléchargement le dit, et le
 * générateur le recopie dans le manifeste). `core/frames.ts` travaille, lui, en longitude EST de
 * **−180 à 180**, parce que c'est la paramétrisation d'une `THREE.SphereGeometry` et d'une
 * texture équirectangulaire standard — la même que celle qui place déjà les épicentres de séismes
 * là où ils se sont produits.
 *
 * Les deux sont EST : il n'y a donc aucun miroir à appliquer, seulement un repliement. Se
 * tromper ici ne déformerait rien et ne se verrait sur aucune capture isolée ; cela poserait
 * simplement chaque nom à l'exact opposé de sa formation.
 */
export function iauLongitudeToSceneLongitude(
  eastDegrees0To360: number
): number {
  const wrapped = ((eastDegrees0To360 % 360) + 360) % 360;
  // Intervalle SEMI-OUVERT [-180, 180) : 180 et -180 nomment le même méridien, et rendre
  // une forme canonique évite qu'un aller-retour par le mesh paraisse dériver de 360° sur la
  // couture. C'est ce que fait déjà `localDirectionToGeographic`.
  return wrapped >= 180 ? wrapped - 360 : wrapped;
}

/**
 * Hauteur apparente, en pixels, de ce qui mesure `diameterKm` sur un corps de `radiusKm` vu à
 * `apparentRadii` rayons de distance, dans une vue haute de `viewportHeightPx` pour un champ de
 * `fovDeg`.
 *
 * C'est la grandeur qui décide si un nom vaut d'être écrit : un cratère de 3 km sur la Lune vue
 * en entier n'occupe pas un pixel, et l'écrire n'apprendrait rien à personne.
 */
export function apparentSizePx(
  diameterKm: number,
  radiusKm: number,
  apparentRadii: number,
  viewportHeightPx: number,
  fovDeg: number
): number {
  if (radiusKm <= 0 || apparentRadii <= 0) return 0;
  const distanceKm = apparentRadii * radiusKm;
  const angleRad = 2 * Math.atan(diameterKm / 2 / distanceKm);
  const fovRad = (fovDeg * Math.PI) / 180;
  return (angleRad / fovRad) * viewportHeightPx;
}

/**
 * Au-dessous de cette taille apparente, une formation n'est pas nommée : son nom dirait « ici »
 * pour une tache plus petite que le texte lui-même.
 */
export const MIN_FEATURE_SIZE_PX = 24;

/**
 * Et jamais plus de noms que cela, quelle que soit la distance. La Lune en porte 9 087 : sans ce
 * plafond, une approche rase projetterait neuf mille libellés par image, dont l'écrasante
 * majorité serait refusée par le compte de place commun APRÈS avoir été calculée.
 */
export const MAX_FEATURE_LABELS = 40;

/**
 * Les formations à nommer, les plus GRANDES d'abord.
 *
 * L'ordre par diamètre décroissant vient du fichier lui-même (le générateur le trie), donc ce
 * choix reste vrai même si l'appelant ne retrie rien : quand la place manque, ce sont les
 * grandes formations qui la prennent, et c'est le comportement qu'on veut — on reconnaît un
 * corps par ses grands traits avant ses petits.
 */
export function featuresToLabel(
  features: readonly NamedFeature[],
  radiusKm: number,
  apparentRadii: number,
  viewportHeightPx: number,
  fovDeg: number
): NamedFeature[] {
  const out: NamedFeature[] = [];
  for (const feature of features) {
    if (out.length >= MAX_FEATURE_LABELS) break;
    // Un diamètre nul veut dire « l'UAI n'en publie pas » (une tache d'albédo, une région) :
    // on ne peut pas juger sa taille apparente, et la taire serait perdre les plus grandes
    // formations de Titan. Elles passent, et c'est le plafond qui les borne.
    if (
      feature.diameterKm > 0 &&
      apparentSizePx(
        feature.diameterKm,
        radiusKm,
        apparentRadii,
        viewportHeightPx,
        fovDeg
      ) < MIN_FEATURE_SIZE_PX
    )
      continue;
    out.push(feature);
  }
  return out;
}
