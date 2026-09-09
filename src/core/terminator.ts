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
 * adoucissement purement esthétique, assumé — mais il DOIT rester plus serré que celui
 * d'un corps atmosphérique, sinon la Lune aurait un crépuscule plus doux que la Terre.
 * Fixé à la moitié du crépuscule civil pour garder cet ordre par construction.
 */
export const TERMINATOR_WRAP_VACUUM = sinDeg(3);

/**
 * Corps AVEC atmosphère, au niveau du SOL.
 *
 * C'est le crépuscule CIVIL (6°), pas l'astronomique (18°). Les deux angles ne répondent pas
 * à la même question : 18° est le moment où le CIEL devient noir, 6° celui où le SOL cesse
 * d'être utilement éclairé. Cette couche éclaire le sol — c'est donc 6°.
 *
 * Régression réellement livrée, corrigée ici : avec 18°, la rampe du sol s'étendait sur ±18°
 * (~4000 km de bande de terminateur, là où l'imagerie réelle en montre ~1300) alors que les
 * lumières de ville atteignaient déjà leur plein régime à 6° (fin du crépuscule civil, cf.
 * SHADER_SETTINGS.nightLights). Il restait donc ~12° où les villes brillaient à fond SUR un
 * sol encore éclairé. Vu de l'orbite, cela se lit exactement comme des lumières décalées qui
 * « débordent sur le côté éclairé » — un défaut de LARGEUR perçu comme un défaut de rotation.
 * Aligner cette largeur sur celle des lumières fait coïncider les deux extinctions.
 *
 * La lueur du ciel, elle, dure bien jusqu'à 18° : c'est la coque atmosphérique qui la porte
 * (TERMINATOR_WRAP_ATMOSPHERE_SHELL), pas le sol.
 */
export const TERMINATOR_WRAP_ATMOSPHERE = CIVIL_TWILIGHT_DOT;

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
/**
 * Largeur du crépuscule de la coque atmosphérique (halo au limbe).
 *
 * Elle part de la MÊME base que toutes les autres couches (le crépuscule du sol) plus son
 * propre abaissement d'horizon. Tenté un temps sur la base ASTRONOMIQUE au motif que la lueur
 * du ciel dure jusqu'à 18° : erreur visible immédiatement. La coque débordait alors de ~20°
 * au-delà de l'extinction du sol, et cette lueur sans aucun sol éclairé dessous se voyait
 * comme un LISERÉ GRIS uniforme et à bord franc le long du limbe. Le halo doit rester
 * solidaire du sol qu'il surplombe : c'est toute la raison d'être de la base partagée.
 */
export const TERMINATOR_WRAP_ATMOSPHERE_SHELL = twilightWrapAtAltitude(
  ATMOSPHERE_GLOW_ALTITUDE_KM
);

/** Largeur du crépuscule de la couche nuages (sommets à ~10 km). */
export const TERMINATOR_WRAP_CLOUDS = twilightWrapAtAltitude(
  CLOUD_TOP_ALTITUDE_KM
);
/** Largeur du crépuscule de la couche précipitations (sommets d'orage à ~12 km). */
export const TERMINATOR_WRAP_STORM = twilightWrapAtAltitude(
  STORM_TOP_ALTITUDE_KM
);

const smootherstep01 = (t: number): number =>
  t * t * t * (t * (t * 6 - 15) + 10);

// Pente 3 en t = 0, plate en t = 1 : l'inverse exact du profil de smootherstep. Voir
// `terminatorNight`, seule consommatrice, pour la raison.
const easeOutCubic01 = (t: number): number => {
  const u = 1 - t;
  return 1 - u * u * u;
};

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
 *
 * COURBE : ease-out cubique 1−(1−t)³, et NON smootherstep comme les autres fonctions d'ici.
 * Ce n'est pas une incohérence, c'est la seule des trois courbes dont le partenaire s'éteint
 * au même endroit qu'elle s'allume.
 *
 * Smootherstep a une dérivée première ET seconde nulles en t = 0. La couche nocturne démarrait
 * donc à plat exactement là où l'éclairement du sol, lui, a déjà chuté : au terminateur le sol
 * ne vaut plus que wrap/4 ≈ 2,6 % et s'effondre, pendant que les villes restent sous 4 % sur le
 * premier degré. Le total plongeait à 0,65 de sa valeur au terminateur vers 1,9° sous l'horizon
 * — une marge sombre le long du terminateur, côté ombre, avant les premières lumières. Le
 * défaut est une affaire de PENTE À L'ORIGINE, pas de largeur ni de seuil : élargir ou reculer
 * ne fait que déplacer le creux (cf. les deux tentatives documentées dans SHADER_SETTINGS).
 *
 * L'ease-out cubique conserve les deux contraintes dures et corrige la troisième :
 *   - f(0) = 0 EXACTEMENT → aucune lumière nulle part sur le côté éclairé (règle produit) ;
 *   - f(1) = 1 avec f'(1) = f''(1) = 0 → raccord invisible avec le palier de pleine nuit ;
 *   - f'(0) = 3 → la couche monte dès le coucher, plus vite que le sol ne s'éteint.
 * Le total ne décroît plus nulle part (minimum 1,0000, atteint au terminateur même).
 *
 * Physiquement c'est aussi le bon modèle : l'éclairage public est déjà allumé au coucher, et
 * ce qui rend une ville visible depuis l'orbite n'est pas la montée des lampes mais la chute
 * du sol autour d'elles. La visibilité doit donc suivre cette chute, pas s'y ajouter en retard.
 */
export function terminatorNight(
  raw: number,
  onset: number,
  rampWidth: number
): number {
  return easeOutCubic01(clamp01((raw - onset) / -rampWidth));
}

/**
 * Hauteur d'échelle de l'atmosphère terrestre (km) : altitude sur laquelle la densité de
 * l'air est divisée par e. Valeur publiée standard, pas un réglage.
 */
export const ATMOSPHERE_SCALE_HEIGHT_KM = 8;

/**
 * FRACTION DE LA COLONNE D'AIR ENCORE ÉCLAIRÉE au-dessus d'un point d'éclairement `raw`.
 *
 * Après le coucher, le sol est dans l'ombre mais l'air au-dessus de lui ne l'est pas : le
 * rayon solaire rasant passe au-dessus de l'horizon local, et l'ombre monte dans la colonne à
 * mesure que le Soleil descend. Le sommet de cette ombre vaut `R · (1/cos h − 1)`, et comme la
 * densité décroît en `exp(−z/H)`, la part de colonne encore au Soleil vaut `exp(−z/H)`.
 *
 * Aucun paramètre libre : seulement le rayon terrestre et la hauteur d'échelle. En degrés
 * sous l'horizon cela donne 1,00 au coucher, 0,89 à 1°, 0,34 à 3°, 0,012 à 6° et ~0 à 9° —
 * autrement dit la lueur s'éteint d'elle-même à la fin du crépuscule CIVIL, la même borne
 * que `TERMINATOR_WRAP_ATMOSPHERE`, sans qu'on ait eu à la lui imposer.
 */
export function sunlitColumnFraction(raw: number): number {
  if (raw >= 0) return 1;
  // `1/cos h − 1` écrit SANS soustraction : la forme directe retranche deux nombres tous deux
  // proches de 1 (à 1° sous l'horizon, 1,000153 − 1) et perd l'essentiel de ses chiffres
  // significatifs. Négligeable en double, pas en float32 côté GPU — et c'est justement là,
  // dans le premier degré sous l'horizon, que la lueur est la plus forte. L'identité
  // `1/cos − 1 = sin² / (cos·(1+cos))` donne le même nombre sans jamais soustraire.
  const cos = Math.sqrt(Math.max(1 - raw * raw, 1e-12));
  const shadowTopKm = (EARTH_MEAN_RADIUS_KM * raw * raw) / (cos * (1 + cos));
  return Math.exp(-shadowTopKm / ATMOSPHERE_SCALE_HEIGHT_KM);
}

/**
 * BANDEAU CRÉPUSCULAIRE — lumière diffusée par l'atmosphère au-dessus d'un sol déjà éteint.
 *
 * Pourquoi il fallait l'ajouter, mesuré et non supposé. `terminatorLight` porte bien un
 * éclairement jusqu'à `−wrap`, mais il y vaut au plus `wrap/4 ≈ 2,6 %` du plein soleil, et il
 * est ensuite multiplié par l'albédo puis compressé par le tone mapping. Rendu réel, albédo
 * neutre 0,5 : la surface atteint le noir 8 bits dès `raw ≈ +0,013` (0,75° AU-DESSUS de
 * l'horizon) et vaut 0 sur TOUTE la bande de crépuscule. Sur la Terre texturée, la mesure
 * pixel par pixel du disque donne 100 % de pixels au-dessus du plancher d'affichage à +8°,
 * 4 % à +0,6°, puis 0 % de 0° à −2° — le bandeau noir signalé. La rampe des villes ne peut
 * pas le combler : elle ne s'allume que là où il y a des villes.
 *
 * La lumière qui manque n'est donc pas de la lumière de SOL, c'est de la lumière de CIEL :
 * albédo-indépendante, présente au-dessus de l'océan comme du continent. Le halo
 * atmosphérique (`AtmosphereShader`) la modélise déjà, mais son facteur `rim =
 * (1 − |N·V|)^power` s'annule en incidence normale : par construction il ne dessine que le
 * limbe, jamais le bandeau en travers du disque.
 *
 * Le profil combine donc deux facteurs, sans constante réglée à l'œil :
 *   - `sunlitColumnFraction(raw)` — combien d'air reste éclairé, physique pure ;
 *   - `1 − terminatorDay(raw, wrap)` — l'extinction côté JOUR, qui ramène le terme à zéro
 *     exactement en `+wrap` : le côté éclairé garde le rendu qu'il a aujourd'hui, la lueur
 *     n'existe que là où le sol a cessé d'être éclairé.
 * Il s'éteint de lui-même en nuit profonde (la colonne n'est plus éclairée), donc les
 * lumières de ville gardent leur contraste.
 *
 * Renvoie le profil NON normalisé : son maximum est une propriété de la physique, pas un
 * réglage. `TWILIGHT_BAND_PEAK` l'expose pour que l'amplitude puisse être calibrée ailleurs.
 */
export function terminatorTwilight(raw: number, wrap: number): number {
  return sunlitColumnFraction(raw) * (1 - terminatorDay(raw, wrap));
}

/**
 * Maximum du profil ci-dessus pour la largeur du crépuscule au sol — la seule employée, la
 * bande à combler étant exactement celle où le sol s'éteint. Balayé plutôt qu'écrit en dur :
 * si la courbe change, la normalisation suit au lieu de mentir.
 */
export const TWILIGHT_BAND_PEAK = ((): number => {
  let peak = 0;
  for (let raw = -0.4; raw <= 0.4; raw += 1e-4)
    peak = Math.max(peak, terminatorTwilight(raw, TERMINATOR_WRAP_ATMOSPHERE));
  return peak;
})();

/**
 * COUPE DE RELIEF — bornes de la disparition de la normal map à l'approche du terminateur.
 *
 * À lumière rasante, une normale perturbée incline chaque ride du relief vers ou hors du
 * Soleil : les micro-facettes passent en fort contraste et dessinent des contours durs sur la
 * face nuit. La surface fond donc la normale perturbée vers la normale GÉOMÉTRIQUE avant
 * d'arriver au terminateur (cf. `createShadowAwareStandardMaterial`, option `moonlight`).
 *
 * Ces deux bornes sont exportées parce qu'elles ne concernent PAS que la surface : elles
 * définissent, pour toutes les couches, la zone où la seule normale valide est la géométrique.
 * `RELIEF_FADE_END = 0` place cette zone exactement sur la moitié nuit — c'est-à-dire sur
 * TOUTE la bande où la rampe des lumières de ville varie (elle part de 0 vers le négatif).
 *
 * Régression réellement livrée, corrigée grâce à ce partage : `NightLightsShader` perturbait sa
 * normale à 100 % PARTOUT, y compris dans cette bande où la surface, elle, avait déjà basculé
 * sur la normale lisse. Les deux couches ne parlaient donc plus du même terminateur sur les
 * 6° exacts où le masque des villes se construit. Une normal map à pentes de 5–10° y déplace
 * le seuil de plus que la largeur TOTALE de la rampe : villes débordant côté jour là où le
 * terrain penche à l'opposé du Soleil, sol noir sans lumières là où il penche vers lui. Le
 * défaut suit le relief, donc il est irrégulier et asymétrique — ce qui se lit comme un
 * mauvais centrage des lumières, jamais comme un défaut de largeur.
 */
export const RELIEF_FADE_END = 0;
export const RELIEF_FADE_START = 0.25;
const RELIEF_FADE_CENTER = (RELIEF_FADE_START + RELIEF_FADE_END) / 2;
const RELIEF_FADE_HALF_WIDTH = (RELIEF_FADE_START - RELIEF_FADE_END) / 2;

/**
 * Poids de la normale PERTURBÉE à l'éclairement `raw` : 1 en plein jour, 0 dès
 * `raw ≤ RELIEF_FADE_END`. Toute couche qui décide d'un seuil à partir de `dot(N, Soleil)`
 * doit utiliser la même normale que la surface — donc appliquer ce fondu, ou n'employer que
 * la normale géométrique dans la zone où il vaut 0.
 */
export function reliefFade(raw: number): number {
  return terminatorDay(raw - RELIEF_FADE_CENTER, RELIEF_FADE_HALF_WIDTH);
}

/**
 * Les fonctions ci-dessus en GLSL, à l'identique. Injecté dans `#include <common>` par
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
float terminatorEaseOutCubic01( float t ) {
  float u = 1.0 - t;
  return 1.0 - u * u * u;
}
float terminatorNight( float raw, float onset, float rampWidth ) {
  return terminatorEaseOutCubic01( clamp( ( raw - onset ) / -rampWidth, 0.0, 1.0 ) );
}
float terminatorSunlitColumn( float raw ) {
  if ( raw >= 0.0 ) return 1.0;
  float c = sqrt( max( 1.0 - raw * raw, 1e-12 ) );
  float shadowTopKm = ${EARTH_MEAN_RADIUS_KM.toFixed(1)} * raw * raw / ( c * ( 1.0 + c ) );
  return exp( - shadowTopKm / ${ATMOSPHERE_SCALE_HEIGHT_KM.toFixed(1)} );
}
float terminatorTwilight( float raw, float wrap ) {
  return terminatorSunlitColumn( raw ) * ( 1.0 - terminatorDay( raw, wrap ) );
}
float reliefFade( float raw ) {
  return terminatorDay( raw - ${RELIEF_FADE_CENTER.toFixed(4)}, ${RELIEF_FADE_HALF_WIDTH.toFixed(4)} );
}
`;
