/**
 * LES NUAGES RÉELS DE PRÈS : LA MÊME OBSERVATION, À LA RÉSOLUTION QUE L'ÉCRAN PEUT EN MONTRER
 * (GAL-EARTH-ATMOSPHERE-002, 2026-11-26).
 *
 * Jusqu'ici la couche régionale (VIIRS vraies couleurs, 250 m par texel) s'effaçait dès que son texel
 * dépassait 6 pixels d'écran (`core/dataMagnification.ts`) : mesuré aux îles Kerguelen (NOAA-21,
 * 2026-11-20, couverture de 92 %), la caméra passait d'un plafond blanc continu à 41,8 km d'altitude à un
 * sol entièrement dégagé à 22,5 km, alors qu'elle était encore AU-DESSUS de la couche de représentation
 * (10 km). La règle évitait de montrer la GRILLE de la donnée ; elle effaçait aussi la donnée.
 *
 * Ici, de près, l'alpha est extrait d'un niveau de mipmap PLUS GROSSIER de la même tuile, choisi pour qu'un
 * texel effectif tienne dans {@link NEAR_TARGET_PX} pixels : aucun carré ne se voit, et rien n'est plus fin
 * que la donnée (c'est une MOYENNE de la donnée, jamais un détail ajouté). Au-delà de
 * {@link NEAR_CLOUD_MAX_LOD} niveaux (64 texels, 16 km à 250 m), la règle d'effacement reprend : la
 * structure restante ne serait plus celle d'un nuage.
 *
 * Deux limites, dites : (1) l'extraction est non linéaire (seuils de luminance et de saturation), et elle
 * s'applique ici à une COULEUR moyennée : une moitié nuage et moitié océan donne un voile partiel, pas la
 * moitié exacte de la couverture ; (2) la couche reste à une seule altitude de représentation
 * (`core/cloudShellAltitude`, 10 km de près), qui n'est PAS une mesure de hauteur de nuage.
 *
 * SOUS LA COQUE, rien : le moteur de tuiles ne sélectionne aucun carreau quand la caméra est à l'intérieur de
 * la sphère qu'il sert (`PlanetarySurfaceEngine.update`, `radii <= lowest`). Un plafond nuageux vu par-dessous
 * demanderait une sélection depuis l'intérieur dans le moteur PARTAGÉ : non entrepris, dit comme limite.
 */

/** Pixels d'écran visés par texel effectif de près (le début du fondu de grossissement : net, sans carré). */
export const NEAR_TARGET_PX = 3;

/** Niveaux de mipmap au plus (2^6 = 64 texels de la tuile, 16 km pour 250 m). */
export const NEAR_CLOUD_MAX_LOD = 6;

/**
 * PORTE MODIS du prolongement de près (mesurée à l'Everest, 2026-11-20) : l'extraction vraies couleurs prend la
 * neige pour un nuage, et de près elle posait un voile blanc continu sur l'Himalaya. Le prolongement n'est
 * montré que là où la fraction nuageuse MODIS du même jour (tests infrarouges) dépasse ces seuils (lissés).
 * La couche telle qu'elle était (loin, texel net) n'est pas touchée.
 */
export const NEAR_MODIS_GATE_LOW = '0.05';
export const NEAR_MODIS_GATE_HIGH = '0.35';

/** Porte du prolongement pour une fraction MODIS `fraction` et une couverture `covered` (miroir du GLSL). */
export function nearModisGate(fraction: number, covered: boolean): number {
  if (!covered) return 1;
  const lo = Number(NEAR_MODIS_GATE_LOW);
  const hi = Number(NEAR_MODIS_GATE_HIGH);
  const x = Math.max(0, Math.min(1, (fraction - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
}

/** Niveau de mipmap de près pour un grossissement `pxPerTexel` (miroir de {@link CLOUD_NEAR_GLSL}). */
export function nearCloudLod(
  pxPerTexel: number,
  maxLod = NEAR_CLOUD_MAX_LOD
): number {
  if (!Number.isFinite(pxPerTexel) || pxPerTexel <= NEAR_TARGET_PX) return 0;
  return Math.min(maxLod, Math.log2(pxPerTexel / NEAR_TARGET_PX));
}

/** Grossissement qui reste une fois le niveau de près appliqué (ce que voit la règle d'effacement). */
export function residualPxPerTexel(
  pxPerTexel: number,
  maxLod = NEAR_CLOUD_MAX_LOD
): number {
  return pxPerTexel / 2 ** nearCloudLod(pxPerTexel, maxLod);
}

const glslFloat = (value: number): string =>
  Number.isInteger(value) ? `${value}.0` : String(value);

/** Le GLSL, à côté de son miroir JS testé (aucun moyen d'exécuter le GLSL hors WebGL). */
export const CLOUD_NEAR_GLSL = `
        float nearCloudLod( float pxPerTexel ) {
          if ( pxPerTexel <= ${glslFloat(NEAR_TARGET_PX)} ) return 0.0;
          return min( ${glslFloat(NEAR_CLOUD_MAX_LOD)}, log2( pxPerTexel / ${glslFloat(NEAR_TARGET_PX)} ) );
        }`;
