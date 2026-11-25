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
 *
 * LE PIXEL DOIT RESSEMBLER À L'EAU DE LA MOSAÏQUE (GAL-EARTH-VISUAL-COHERENCE-001). Le masque d'eau
 * est celui de la base, à ~20 km par pixel : suffisant pour Blue Marble (500 m), faux sur une côte
 * vue en Sentinel-2 (10 m), où une bande de terre de quelques kilomètres aurait été bleuie. Le
 * décalage n'est donc appliqué qu'en proportion de la ressemblance du pixel à la couleur d'océan
 * mesurée de la mosaïque (`oceanLikeness`) : l'eau du large est ramenée, la côte, la terre, l'eau
 * turbide ou peu profonde restent ce que la source a publié.
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

/**
 * Bornes de la ressemblance, en distance euclidienne dans l'espace « racine du linéaire » (une
 * approximation de sRGB à gamma 2, sur [0, 1]) : entièrement ramené en deçà de `OCEAN_LIKE_FULL`
 * (~12 octets), pas du tout au-delà de `OCEAN_LIKE_NONE` (~32 octets).
 */
export const OCEAN_LIKE_FULL = 0.05;
export const OCEAN_LIKE_NONE = 0.13;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * La part du décalage qu'un pixel reçoit selon sa ressemblance à l'eau de la mosaïque : 1 pour l'eau
 * du large, 0 pour la terre ou une eau très différente. Le JUMEAU exact de la ligne du shader
 * (`OCEAN_MATCH_FRAGMENT_GLSL`), testé.
 */
export function oceanLikeness(
  pixelSrgb: readonly [number, number, number],
  tileSrgb: readonly [number, number, number]
): number {
  let d2 = 0;
  for (let i = 0; i < 3; i++) {
    const a = Math.sqrt(srgbByteToLinear(pixelSrgb[i]!));
    const b = Math.sqrt(srgbByteToLinear(tileSrgb[i]!));
    d2 += (a - b) ** 2;
  }
  return 1 - smoothstep(OCEAN_LIKE_FULL, OCEAN_LIKE_NONE, Math.sqrt(d2));
}

/** La couleur d'océan de la mosaïque en LINÉAIRE, pour le shader. */
export function oceanTileLinear(
  match: Pick<OceanMatch, 'tileSrgb'>
): [number, number, number] {
  return [0, 1, 2].map((i) =>
    srgbByteToLinear(match.tileSrgb[i as 0 | 1 | 2])
  ) as [number, number, number];
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
	uniform vec3 uOceanLift;
	uniform vec3 uOceanTile;`;

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
		float oceanLike = 1.0 - smoothstep( ${OCEAN_LIKE_FULL.toFixed(3)}, ${OCEAN_LIKE_NONE.toFixed(3)},
			distance( sqrt( max( diffuseColor.rgb, vec3( 0.0 ) ) ), sqrt( uOceanTile ) ) );
		diffuseColor.rgb = max( diffuseColor.rgb + uOceanLift * oceanShare * oceanLike, vec3( 0.0 ) );
	}
	#endif`;
