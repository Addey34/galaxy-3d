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
 * Grossissement MAXIMAL de la donnée sous un pixel, en pixels d'écran par texel (2026-10-14).
 *
 * `dx` et `dy` sont les dérivées d'écran de la coordonnée de texel (les colonnes de la jacobienne
 * écran → texels). Le grossissement le plus fort est l'inverse de sa PLUS PETITE VALEUR
 * SINGULIÈRE : la direction de l'écran où un pixel parcourt le moins de texels. La première
 * version prenait la plus courte des deux colonnes, ce qui ne vaut que si cette direction est
 * alignée sur un axe de l'écran. Près d'un horizon incliné de 20° (texels à un quart de pixel le
 * long de l'horizon, à un pixel en travers), elle lisait 2,4 px par texel là où il y en a 4 : la
 * couche restait entière, et les bords des nuages y dessinaient la grille de la donnée en
 * escalier, vu à 1 587 km au-dessus de l'Atlantique (lot 48). La valeur singulière ne dépend pas
 * de l'orientation de l'écran.
 */
export function maxPxPerTexel(
  dx: readonly [number, number],
  dy: readonly [number, number]
): number {
  const sum = dx[0] ** 2 + dx[1] ** 2 + dy[0] ** 2 + dy[1] ** 2;
  const det = Math.abs(dx[0] * dy[1] - dx[1] * dy[0]);
  const sigmaMax = Math.sqrt(
    (sum + Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2
  );
  const sigmaMin = sigmaMax > 0 ? det / sigmaMax : 0;
  return 1 / Math.max(sigmaMin, 1e-6);
}

/**
 * Fin de fragment : multiplie `gl_FragColor.a` par le facteur de grossissement de `map`
 * ({@link maxPxPerTexel}, même calcul). Texels parcourus par pixel d'écran, depuis les dérivées
 * d'écran de la coordonnée de texel ; jamais `fwidth`, qui somme les valeurs absolues des deux et
 * surestimait jusqu'au double les texels par pixel (à 2 492 km, la couche restait presque
 * entière). Sans `map`, rien à mesurer.
 */
export const MAGNIFICATION_FADE_GLSL = `
	#ifdef USE_MAP
	{
		vec2 texelCoord = vMapUv * vec2( textureSize( map, 0 ) );
		vec2 jx = dFdx( texelCoord );
		vec2 jy = dFdy( texelCoord );
		float jSum = dot( jx, jx ) + dot( jy, jy );
		float jDet = abs( jx.x * jy.y - jx.y * jy.x );
		float sigmaMax = sqrt( 0.5 * ( jSum + sqrt( max( jSum * jSum - 4.0 * jDet * jDet, 0.0 ) ) ) );
		float sigmaMin = sigmaMax > 0.0 ? jDet / sigmaMax : 0.0;
		float pxPerTexel = 1.0 / max( sigmaMin, 1e-6 );
		gl_FragColor.a *= 1.0 - smoothstep( ${glslFloat(MAGNIFICATION_FADE_START_PX)}, ${glslFloat(MAGNIFICATION_FADE_END_PX)}, pxPerTexel );
	}
	#endif`;
