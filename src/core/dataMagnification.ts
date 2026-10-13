/**
 * UNE COUCHE D'APPARENCE S'EFFACE QUAND SA DONNÉE N'EST PLUS UNE IMAGE (lot 48, 2026-10-13).
 *
 * Les nuages du jour sont une image VIIRS de 2 048 px pour le globe entier, soit ~20 km par
 * texel. Vus de l'orbite, c'est une image. En descendant, chaque texel finit par couvrir des
 * dizaines de pixels d'écran : mesuré à 1 036 km d'altitude, 14 px par texel, et ce qu'on voit
 * alors n'est plus le ciel du jour mais la GRILLE de la donnée (des bosses d'un ou deux texels),
 * posée sur un sol servi à 10 m. Aucune reconstruction n'en fait une image : l'information
 * n'existe pas à cette échelle.
 *
 * La règle porte donc sur le GROSSISSEMENT de la donnée, pas sur une altitude : pleine tant
 * qu'un texel tient dans {@link MAGNIFICATION_FADE_START_PX} pixels d'écran, nulle au-delà de
 * {@link MAGNIFICATION_FADE_END_PX}. Elle vaut pour toute couche d'apparence quelle que soit sa
 * résolution (nuages, pluie, nuages modèle), et elle couvre d'office le cas de la caméra sous la
 * coquille où ces couches sont peintes (1,01 rayon), où le grossissement est énorme.
 *
 * Le shader la calcule par fragment, avec les dérivées d'écran de l'UV (texels par pixel), donc
 * sans rien à transmettre depuis la caméra. Le GLSL vit ici, à côté de son miroir JS testé, pour
 * qu'une dérive se voie en relecture : il n'existe aucun moyen d'exécuter le GLSL hors WebGL.
 *
 * Les deux seuils ont été lus sur des captures de la vraie Terre (scène du 2026-10-10,
 * au-dessus de l'Atlantique au large du Sahara occidental, fenêtre de 1 280 x 800) : à 3,6 px
 * par texel (4 235 km) les nuages se lisent encore comme des nuages ; à ~6 px (2 492 km) des
 * carrés d'un ou deux texels se voient déjà sur l'océan, et une première borne à 4 et 10 px les
 * y laissait aux trois quarts ; à 14 px (1 036 km) on ne voit plus que la grille.
 */

/** Sous ce nombre de pixels d'écran par texel de donnée, la couche est pleinement visible. */
export const MAGNIFICATION_FADE_START_PX = 3;

/** Au-delà de ce nombre de pixels d'écran par texel, la couche a disparu. */
export const MAGNIFICATION_FADE_END_PX = 6;

/** Miroir JS du facteur appliqué à l'alpha final (cf. {@link MAGNIFICATION_FADE_GLSL}). */
export function magnificationFade(pxPerTexel: number): number {
  const t =
    (pxPerTexel - MAGNIFICATION_FADE_START_PX) /
    (MAGNIFICATION_FADE_END_PX - MAGNIFICATION_FADE_START_PX);
  const x = Math.max(0, Math.min(1, t));
  return 1 - x * x * (3 - 2 * x);
}

const glslFloat = (value: number): string =>
  Number.isInteger(value) ? `${value}.0` : String(value);

/**
 * Fin de fragment : multiplie `gl_FragColor.a` par le facteur de grossissement de `map`.
 * Texels parcourus par pixel d'écran, LONGUEUR de chaque dérivée d'écran et non `fwidth`, qui
 * somme les valeurs absolues des deux et surestimait jusqu'au double les texels par pixel (donc
 * sous-estimait le grossissement : à 2 492 km, la couche restait presque entière). Le plus PETIT
 * des deux, donc le plus GRAND grossissement : en vue rasante, une direction est comprimée et
 * l'autre étire les texels en blocs, et c'est elle qui montre la grille. Choisir l'autre (ce que
 * faisait la première version) laissait des blocs blancs à l'horizon, mesurés à 300 km au-dessus
 * des Alpes une fois la caméra relevée (lot 48, pas 5). Sans `map`, rien à mesurer.
 */
export const MAGNIFICATION_FADE_GLSL = `
	#ifdef USE_MAP
	{
		vec2 texelCoord = vMapUv * vec2( textureSize( map, 0 ) );
		float texelsPerPx = min( length( dFdx( texelCoord ) ), length( dFdy( texelCoord ) ) );
		float pxPerTexel = 1.0 / max( texelsPerPx, 1e-6 );
		gl_FragColor.a *= 1.0 - smoothstep( ${glslFloat(MAGNIFICATION_FADE_START_PX)}, ${glslFloat(MAGNIFICATION_FADE_END_PX)}, pxPerTexel );
	}
	#endif`;
