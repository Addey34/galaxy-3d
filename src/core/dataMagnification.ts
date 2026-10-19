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
 * Le shader la calcule par fragment, depuis la position en repère caméra (texels par pixel), donc
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

/**
 * Opacité que garde une couche quand sa donnée est trop grossie, si le visiteur a demandé de la
 * GARDER (réglage « garder les nuages à l'approche », 2026-10-19). Un voile, pas un nuage net :
 * la donnée n'a pas de détail plus fin, donc on n'en invente pas, on laisse la couche apparente à
 * l'opacité qui la fait lire comme une brume plutôt que comme des carrés.
 */
export const MAGNIFICATION_KEPT_FLOOR = 0.4;

/** Plancher courant, partagé par tous les matériaux : 0 = la couche s'efface (règle du lot 48). */
export const magnificationFloorUniform = { value: 0 };

export function setKeepAppearanceLayers(keep: boolean): void {
  magnificationFloorUniform.value = keep ? MAGNIFICATION_KEPT_FLOOR : 0;
}

/** Miroir JS du facteur appliqué à l'alpha final (cf. {@link MAGNIFICATION_FADE_GLSL}). */
export function magnificationFade(pxPerTexel: number, floor = 0): number {
  const t =
    (pxPerTexel - MAGNIFICATION_FADE_START_PX) /
    (MAGNIFICATION_FADE_END_PX - MAGNIFICATION_FADE_START_PX);
  const x = Math.max(0, Math.min(1, t));
  const fade = 1 - x * x * (3 - 2 * x);
  return floor + (1 - floor) * fade;
}

const glslFloat = (value: number): string =>
  Number.isInteger(value) ? `${value}.0` : String(value);

/**
 * Grossissement MAXIMAL de la donnée sous un pixel, en pixels d'écran par texel (2026-10-19).
 *
 * Il se CALCULE, il ne se mesure plus avec les dérivées d'écran de l'UV. Ces dérivées sont
 * constantes sur chaque triangle du maillage (l'UV est linéaire sur le triangle, la sphère ne
 * l'est pas), donc le facteur de fondu changeait d'un triangle à l'autre : à 1 306 km au-dessus de
 * l'Atlantique, des facettes claires aux arêtes nettes dessinaient le maillage de la couche sur
 * l'océan. Ici, tout est lisse : la taille d'un texel sur la coquille (`π R / hauteur`, le plus
 * grand de ses deux côtés pour une carte équirectangulaire de 2:1, quelle que soit la latitude),
 * divisée par la distance à la caméra et par l'angle qu'occupe un pixel.
 *
 * Le côté le plus long d'un texel, vu en travers de la ligne de visée, n'est pas raccourci par
 * l'inclinaison de la surface : c'est le grossissement maximal, celui que la mesure par valeur
 * singulière retrouvait, et il ne dépend plus de l'orientation de l'écran.
 */
export function pxPerTexel(params: {
  /** Rayon de la coquille où la couche est peinte, dans l'unité de `viewDistance`. */
  shellRadius: number;
  texelsWide: number;
  texelsHigh: number;
  /** Distance de la caméra au fragment. */
  viewDistance: number;
  /** Angle sous-tendu par un pixel, en radians. */
  pixelAngle: number;
}): number {
  const { shellRadius, texelsWide, texelsHigh, viewDistance, pixelAngle } =
    params;
  const texelSize =
    Math.PI * shellRadius * Math.max(2 / texelsWide, 1 / texelsHigh);
  return texelSize / Math.max(viewDistance * pixelAngle, 1e-30);
}

/** Varyings de la mesure ci-dessus : à poser dans le shader de SOMMETS (`#include <common>`). */
export const MAGNIFICATION_VERTEX_PARS_GLSL = `
	varying vec3 vMagView;
	varying float vMagShell;`;

/** Fin de `begin_vertex` : position en repère caméra et rayon de la coquille, en unités monde. */
export const MAGNIFICATION_VERTEX_GLSL = `
	vMagView = ( modelViewMatrix * vec4( transformed, 1.0 ) ).xyz;
	vMagShell = length( modelMatrix * vec4( transformed, 0.0 ) );`;

/**
 * Côté fragment : l'uniform de plancher, et le grossissement en pixels d'écran par texel d'une
 * carte de `mapSize` texels. Une FONCTION, pour que le fondu et la reconstruction lisse des
 * nuages lisent la même valeur ; à appeler hors de toute branche (elle prend des dérivées).
 * L'angle d'un pixel est la variation du RAYON de vue normalisé d'un pixel au suivant : il ne
 * dépend que de la caméra, jamais du triangle touché.
 */
export const MAGNIFICATION_FLOOR_PARS_GLSL = `
	uniform float uMagFloor;
	float magnificationPxPerTexel( vec2 mapSize ) {
		vec3 magRay = normalize( vMagView );
		float magPixel = max( length( dFdx( magRay ) ), length( dFdy( magRay ) ) );
		float magTexel = 3.14159265 * vMagShell * max( 2.0 / mapSize.x, 1.0 / mapSize.y );
		return magTexel / max( length( vMagView ) * magPixel, 1e-30 );
	}`;

/**
 * Fin de fragment : multiplie `gl_FragColor.a` par le facteur de grossissement de `map`
 * ({@link pxPerTexel}, même calcul). Sans `map`, rien à mesurer.
 */
export const MAGNIFICATION_FADE_GLSL = `
	#ifdef USE_MAP
	{
		float pxPerTexel = magnificationPxPerTexel( vec2( textureSize( map, 0 ) ) );
		gl_FragColor.a *= mix( uMagFloor, 1.0, 1.0 - smoothstep( ${glslFloat(MAGNIFICATION_FADE_START_PX)}, ${glslFloat(MAGNIFICATION_FADE_END_PX)}, pxPerTexel ) );
	}
	#endif`;
