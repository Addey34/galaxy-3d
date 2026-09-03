/**
 * Terminateur jour/nuit — SOURCE UNIQUE pour toutes les couches.
 *
 * Avant ce module, chaque couche posée sur la Terre calculait son propre jour/nuit avec ses
 * propres constantes, et elles ne tombaient pas d'accord : la surface s'éteignait à
 * dot = -0.31, les nuages à -0.25, la pluie à -0.091, l'atmosphère à -0.08, le clair de Lune
 * démarrait à -0.10 et la coupe de relief à 0. Un facteur 4 d'écart entre les extinctions,
 * sur des sphères concentriques regardées ensemble : d'où des bandes et des décalages
 * visibles au terminateur, chaque couche traversant sa nuit à un moment différent.
 *
 * Tout passe désormais par trois fonctions et une constante de base. La grandeur d'entrée est
 * partout la même : `raw = dot( normale monde, direction du Soleil )`, c'est-à-dire le SINUS
 * de la hauteur du Soleil au-dessus de l'horizon local. 0 = Soleil pile à l'horizon
 * (coucher), 1 = zénith, -1 = antipode. Toutes les constantes ci-dessous sont donc des sinus
 * d'angles réels, jamais des valeurs réglées à l'œil.
 *
 * Le GLSL vit ici aussi, à côté du miroir JS testé : les deux doivent rester identiques, et
 * les garder dans le même fichier rend une dérive visible en relecture. Les tests portent sur
 * le miroir JS (`src/core/terminator.test.ts`) ; il n'existe aucun moyen d'exécuter le GLSL
 * hors d'un contexte WebGL, donc la seule protection réelle est cette adjacence.
 */

/** Rayon moyen terrestre (km) — pour l'abaissement d'horizon en altitude. */
export const EARTH_MEAN_RADIUS_KM = 6371;

const sinDeg = (deg: number): number => Math.sin((deg * Math.PI) / 180);

/**
 * Fin du crépuscule ASTRONOMIQUE : 18° sous l'horizon. Au-delà, plus aucune lumière solaire
 * diffusée n'atteint le sol — c'est la nuit noire au sens propre. C'est la largeur du
 * crépuscule d'un corps qui a une atmosphère.
 */
export const ASTRONOMICAL_TWILIGHT_DOT = sinDeg(18);

/**
 * Fin du crépuscule CIVIL : 6° sous l'horizon. Repère de l'éclairage artificiel — c'est la
 * durée pendant laquelle une ville finit de s'allumer après le coucher.
 */
export const CIVIL_TWILIGHT_DOT = sinDeg(6);

/**
 * Corps SANS atmosphère (Lune, Mercure). Physiquement le terminateur y est net : aucune
 * diffusion ne porte la lumière au-delà. La valeur non nulle conservée ici est un
 * adoucissement purement esthétique, assumé, et volontairement bien plus serré.
 */
export const TERMINATOR_WRAP_VACUUM = 0.12;

/** Corps AVEC atmosphère, au niveau du sol. */
export const TERMINATOR_WRAP_ATMOSPHERE = ASTRONOMICAL_TWILIGHT_DOT;

/** Sommet des nuages troposphériques (km). */
export const CLOUD_TOP_ALTITUDE_KM = 10;
/** Sommet d'un système convectif profond — orages, la couche précipitations (km). */
export const STORM_TOP_ALTITUDE_KM = 12;

/**
 * Largeur du crépuscule pour une couche à l'altitude `altitudeKm`.
 *
 * C'est ce qui remplace les constantes réglées à la main, et ce n'est pas cosmétique : un
 * point en altitude reste au SOLEIL DIRECT après le coucher au sol, parce que son horizon est
 * abaissé de `acos( R / (R + h) )`. C'est exactement pourquoi les nuages restent allumés et
 * rougeoient quand le sol est déjà dans l'ombre. En repère `dot`, cet abaissement vaut le
 * sinus de cet angle, et il s'ajoute au crépuscule du sol.
 *
 * Chaque couche dérive donc sa largeur de son altitude RÉELLE — le rayon de son mesh
 * (`LAYER_RADIUS_SCALE`) est exagéré pour la lisibilité et ne dit rien de sa physique.
 * Les sphères étant concentriques, `dot(N, soleil)` est identique à la verticale d'un point
 * au sol : seule cette largeur distingue les couches, ce qui la rend directement pilotable.
 */
export function twilightWrapAtAltitude(
  altitudeKm: number,
  baseWrap: number = TERMINATOR_WRAP_ATMOSPHERE
): number {
  const horizonDip = Math.acos(
    EARTH_MEAN_RADIUS_KM / (EARTH_MEAN_RADIUS_KM + Math.max(altitudeKm, 0))
  );
  return baseWrap + Math.sin(horizonDip);
}

/**
 * Altitude de la lueur atmosphérique encore visible au limbe (km). Bien au-dessus des nuages :
 * c'est pourquoi le halo persiste après que le sol ET les nuages sont passés dans l'ombre.
 */
export const ATMOSPHERE_GLOW_ALTITUDE_KM = 50;

/** Largeur du crépuscule de la coque atmosphérique (halo au limbe). */
export const TERMINATOR_WRAP_ATMOSPHERE_SHELL = twilightWrapAtAltitude(
  ATMOSPHERE_GLOW_ALTITUDE_KM
);

/** Largeur du crépuscule de la couche nuages (sommets à ~10 km). */
export const TERMINATOR_WRAP_CLOUDS =
  twilightWrapAtAltitude(CLOUD_TOP_ALTITUDE_KM);
/** Largeur du crépuscule de la couche précipitations (sommets d'orage à ~12 km). */
export const TERMINATOR_WRAP_STORM =
  twilightWrapAtAltitude(STORM_TOP_ALTITUDE_KM);

const smootherstep01 = (t: number): number =>
  t * t * t * (t * (t * 6 - 15) + 10);

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/**
 * ÉCLAIREMENT DIRECT d'une surface éclairée (remplace le `dotNL` de three.js).
 *
 * f(raw) = max( raw, wrap · s² ), s = clamp( (raw + wrap) / 2·wrap, 0, 1 )
 *
 * - `raw ≥ +wrap` → f = raw EXACTEMENT : le jour reste du Lambert pur, non délavé.
 * - `raw ≤ -wrap` → f = 0 avec une PENTE NULLE : l'extinction est tangente, donc pas
 *   d'arête franche au bord de l'ombre (le défaut d'un wrap linéaire, perçu comme un
 *   « noir d'un coup »).
 * - Raccord C1 en haut aussi (f'(wrap) = 1) : les deux morceaux se touchent tangentiellement
 *   (wrap·s² − raw = wrap·(s−1)² ≥ 0, nul seulement en s = 1), donc le `max` est lui-même C1.
 *
 * Au terminateur géométrique f vaut wrap/4, contre wrap/(1+wrap) ≈ wrap pour un wrap
 * linéaire — ~3.6× moins de lumière diffusée. C'est ce qui permet d'élargir jusqu'à 18°
 * sans inonder la face nuit.
 */
export function terminatorLight(raw: number, wrap: number): number {
  const s = clamp01((raw + wrap) / (2 * wrap));
  return clamp01(Math.max(raw, wrap * s * s));
}

/**
 * FRACTION DE JOUR d'une couche superposée (0 = nuit pleine, 1 = plein jour), pour moduler
 * l'alpha ou la luminosité d'un calque — nuages, pluie, halo. Atteint 0 exactement en
 * `-wrap`, c'est-à-dire au même instant que `terminatorLight` s'éteint pour la même largeur :
 * c'est CE point commun qui aligne les couches entre elles.
 *
 * Smootherstep (Perlin) plutôt que smoothstep : dérivée seconde nulle aux deux bornes, donc
 * le raccord avec les paliers plats est imperceptible — pas de coude au début ni à la fin.
 */
export function terminatorDay(raw: number, wrap: number): number {
  return smootherstep01(clamp01((raw + wrap) / (2 * wrap)));
}

/**
 * FRACTION DE NUIT d'une couche qui APPARAÎT la nuit — lumières de ville, clair de Lune.
 * Monte de 0 à 1 entre `onset` et `onset − rampWidth`.
 *
 * `onset = 0` (le coucher) est la convention du projet : une couche nocturne commence à
 * apparaître quand le Soleil passe l'horizon, pas des dizaines de minutes plus tard.
 */
export function terminatorNight(
  raw: number,
  onset: number,
  rampWidth: number
): number {
  return smootherstep01(clamp01((raw - onset) / -rampWidth));
}

/**
 * Les trois fonctions ci-dessus en GLSL, à l'identique. Injecté dans `#include <common>` par
 * chaque matériau/shader qui en a besoin. Miroir exact du JS au-dessus : toute modification
 * doit être faite dans les deux, et les tests du miroir JS décrivent le contrat.
 */
export const TERMINATOR_GLSL = /* glsl */ `
float terminatorSmootherstep01( float t ) {
  return t * t * t * ( t * ( t * 6.0 - 15.0 ) + 10.0 );
}
float terminatorLight( float raw, float wrap ) {
  float s = clamp( ( raw + wrap ) / ( 2.0 * wrap ), 0.0, 1.0 );
  return clamp( max( raw, wrap * s * s ), 0.0, 1.0 );
}
float terminatorDay( float raw, float wrap ) {
  return terminatorSmootherstep01( clamp( ( raw + wrap ) / ( 2.0 * wrap ), 0.0, 1.0 ) );
}
float terminatorNight( float raw, float onset, float rampWidth ) {
  return terminatorSmootherstep01( clamp( ( raw - onset ) / -rampWidth, 0.0, 1.0 ) );
}
`;
