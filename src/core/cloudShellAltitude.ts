/**
 * L'ALTITUDE DE LA COQUE DES NUAGES SELON LA CAMÉRA (GAL-EARTH-CLOUD-REGIONAL-001, 2026-11-25).
 *
 * Les nuages sont peints sur une coque à 1,01 rayon : 63,7 km d'altitude de représentation pour des sommets
 * réels de 1 à 15 km. Vue de l'orbite, l'exagération les détache du sol et se lit bien ; elle ne coûte rien,
 * un texel de 19,7 km y tient dans quelques pixels. De près, elle coûte deux choses, MESURÉES sur une descente
 * aux îles Kerguelen (NOAA-21, 2026-11-20) :
 *  - les nuages régionaux (250 m) s'effacent à 75 km d'altitude : la caméra n'est plus qu'à 11 km de la coque,
 *    le texel y dépasse 6 pixels d'écran et la règle de grossissement (`core/dataMagnification.ts`) les retire ;
 *  - un nuage est décalé de son sol de 54 km × tan(angle de visée) de trop (31 km à 30°, 93 km à 60°).
 *
 * La coque reste donc à son altitude d'orbite au-dessus de {@link SHELL_ORBIT_FROM_KM}, puis descend vers
 * {@link SHELL_NEAR_KM} (l'altitude que le crépuscule des nuages suppose déjà, `twilightWrapAtAltitude`) à
 * mesure que la caméra descend, jusqu'à {@link SHELL_NEAR_FROM_KM}. Ce n'est PAS une mesure de hauteur de
 * nuage (VIIRS vraies couleurs n'en donne pas) : une seule altitude de représentation, dite comme telle.
 */

/** Altitude de la coque vue de l'orbite (1,01 rayon de 6 371 km), en km. */
export const SHELL_ORBIT_KM = 63.71;
/** Altitude de représentation de près, en km : celle que le crépuscule des nuages suppose déjà. */
export const SHELL_NEAR_KM = 10;
/** Au-dessus de cette altitude de caméra (km), la coque reste à son altitude d'orbite. */
export const SHELL_ORBIT_FROM_KM = 2500;
/** Sous cette altitude de caméra (km), la coque est à son altitude de près. */
export const SHELL_NEAR_FROM_KM = 400;

/** Altitude de la coque (km) pour une caméra à `cameraAltitudeKm`, lisse et monotone. */
export function cloudShellAltitudeKm(cameraAltitudeKm: number): number {
  if (!Number.isFinite(cameraAltitudeKm)) return SHELL_ORBIT_KM;
  if (cameraAltitudeKm >= SHELL_ORBIT_FROM_KM) return SHELL_ORBIT_KM;
  if (cameraAltitudeKm <= SHELL_NEAR_FROM_KM) return SHELL_NEAR_KM;
  // En logarithme de l'altitude : la descente se fait à la molette, un cran multiplie l'altitude.
  const t =
    (Math.log(cameraAltitudeKm) - Math.log(SHELL_NEAR_FROM_KM)) /
    (Math.log(SHELL_ORBIT_FROM_KM) - Math.log(SHELL_NEAR_FROM_KM));
  const s = t * t * (3 - 2 * t);
  return SHELL_NEAR_KM + (SHELL_ORBIT_KM - SHELL_NEAR_KM) * s;
}

/** Facteur d'échelle à appliquer à une coque construite à `builtRadiusRatio` rayons (1,01). */
export function cloudShellScale(
  cameraAltitudeKm: number,
  bodyRadiusKm: number,
  builtRadiusRatio: number
): number {
  return (
    (bodyRadiusKm + cloudShellAltitudeKm(cameraAltitudeKm)) /
    (bodyRadiusKm * builtRadiusRatio)
  );
}
