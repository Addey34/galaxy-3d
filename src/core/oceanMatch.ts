/**
 * L'OCÉAN D'UNE MOSAÏQUE RAMENÉ À CELUI DE LA BASE (2026-10-19).
 *
 * La texture de base de la Terre montre un océan de (63, 82, 110), la mosaïque Blue Marble de
 * GIBS un océan de (2, 5, 20). Chaque carreau qui arrive remplace donc la base par un océan bien
 * plus sombre, et l'eau de la scène s'assombrit de proche en proche (mesuré à 1 306 km : 22 % de
 * bleu en moins en quelques secondes). Le shader des carreaux ajoute l'ÉCART des deux couleurs,
 * en linéaire, aux seuls pixels que le masque d'eau de la base désigne : le relief de la
 * bathymétrie, qui est dans la mosaïque, reste ; seule sa couleur de fond change.
 *
 * C'est une retouche d'une image publiée, et le bandeau de provenance la dit.
 */
import { srgbByteToLinear } from './srgb';

export interface OceanMatch {
  /** Couleur d'océan de la mosaïque, sRGB 8 bits. */
  tileSrgb: readonly [number, number, number];
  /** Couleur d'océan de la texture de base, sRGB 8 bits. */
  baseSrgb: readonly [number, number, number];
  /** Jour de la mesure. */
  measured: string;
  method: string;
}

/** Ce que le shader ajoute à la couleur LINÉAIRE d'un pixel d'océan : base − mosaïque. */
export function oceanLiftLinear(
  match: Pick<OceanMatch, 'tileSrgb' | 'baseSrgb'>
): [number, number, number] {
  const lift = (i: 0 | 1 | 2): number =>
    srgbByteToLinear(match.baseSrgb[i]) - srgbByteToLinear(match.tileSrgb[i]);
  return [lift(0), lift(1), lift(2)];
}

/** Varying de la direction locale, côté sommets : le masque est global, le carreau local. */
export const OCEAN_MATCH_VERTEX_PARS_GLSL = `
	varying vec3 vOceanDir;`;

/** Fin de `begin_vertex` : direction du sommet dans le repère du corps. */
export const OCEAN_MATCH_VERTEX_GLSL = `
	vOceanDir = position;`;

/** Déclarations côté fragment. */
export const OCEAN_MATCH_FRAGMENT_PARS_GLSL = `
	varying vec3 vOceanDir;
	uniform sampler2D uOceanMask;
	uniform vec3 uOceanLift;`;

/**
 * Après `map_fragment`. La longitude et la latitude se lisent dans la direction, avec la
 * convention de `THREE.SphereGeometry` (celle de la texture de base) : `u = atan(z, −x) / 2π`,
 * `v = 1 − θ / π`. Les gradients sont recalés d'un tour à la couture u = 0 : sans cela le GPU y
 * choisit le niveau de mipmap le plus grossier, et une ligne apparaît sur le méridien d'origine.
 */
export const OCEAN_MATCH_FRAGMENT_GLSL = `
	#ifdef USE_MAP
	{
		vec3 oceanDir = normalize( vOceanDir );
		vec2 oceanUv = vec2(
			fract( atan( oceanDir.z, - oceanDir.x ) / 6.28318531 ),
			1.0 - acos( clamp( oceanDir.y, - 1.0, 1.0 ) ) / 3.14159265
		);
		vec2 oceanGx = dFdx( oceanUv );
		vec2 oceanGy = dFdy( oceanUv );
		oceanGx.x -= floor( oceanGx.x + 0.5 );
		oceanGy.x -= floor( oceanGy.x + 0.5 );
		float oceanShare = textureGrad( uOceanMask, oceanUv, oceanGx, oceanGy ).r;
		diffuseColor.rgb = max( diffuseColor.rgb + uOceanLift * oceanShare, vec3( 0.0 ) );
	}
	#endif`;
