/**
 * LE FONDU DE LA FRONTIÈRE EXTÉRIEURE DE L'IMAGERIE DÉTAILLÉE (GAL-EARTH-VISUAL-COHERENCE-001). Pur.
 *
 * Le moteur de tuiles ne couvre qu'une partie du disque visible (budget de tuiles, quadtree autour de la
 * vue) ; hors de cette emprise, c'est la texture globale du corps. Quand les deux diffèrent (une mosaïque
 * annuelle plus claire que la texture livrée, une image du jour plus sombre), le bord de l'emprise se lit
 * comme un rectangle en escalier.
 *
 * Le remède fond la FRONTIÈRE EXTÉRIEURE de la couverture, jamais le bord de chaque tuile : une tuile ne
 * s'efface que vers un côté (ou un coin) qu'aucune autre tuile visible ne recouvre, quel que soit son
 * niveau. Entre deux tuiles voisines, rien ne change : pas de couture, pas de quadrillage. Le fondu court
 * sur toute la largeur de la tuile du bord : le détail du centre de l'observation n'est jamais touché.
 *
 * Rien n'est retouché dans l'image : seule l'opacité de la tuile du bord diminue vers l'extérieur, laissant
 * voir la texture globale (une représentation distincte, que le bandeau de provenance ne confond pas avec
 * l'observation datée). Ni la géométrie ni le relief ne changent.
 */
import type { TileBounds } from './tilePyramid';

/** Côtés et coins vers lesquels une tuile s'efface (1) ou reste entière (0). */
export interface EdgeFade {
  west: number;
  east: number;
  south: number;
  north: number;
  southWest: number;
  southEast: number;
  northWest: number;
  northEast: number;
}

export const NO_FADE: EdgeFade = {
  west: 0,
  east: 0,
  south: 0,
  north: 0,
  southWest: 0,
  southEast: 0,
  northWest: 0,
  northEast: 0,
};

const wrapLon = (lon: number): number =>
  ((((lon + 180) % 360) + 360) % 360) - 180;

/** Le point (degrés) est-il dans l'une des emprises ? Au-delà d'un pôle, il n'y a rien à montrer : couvert. */
function covered(
  lon: number,
  lat: number,
  others: readonly TileBounds[]
): boolean {
  if (lat >= 90 || lat <= -90) return true;
  const l = wrapLon(lon);
  return others.some(
    (b) => l >= b.west && l <= b.east && lat >= b.south && lat <= b.north
  );
}

/**
 * Vers quels côtés et coins la tuile `own` doit s'effacer, d'après les emprises des AUTRES tuiles visibles
 * (tous niveaux). Un côté est couvert quand trois points juste au-delà (quart, milieu, trois quarts) le
 * sont : une tuile plus fine qui n'en recouvre qu'une partie ne suffit pas, et le côté s'efface (mieux vaut
 * un fondu de plus qu'un bord net). Un coin ne s'efface que si ses deux côtés sont couverts mais pas lui.
 */
export function coverageEdges(
  own: TileBounds,
  others: readonly TileBounds[]
): EdgeFade {
  const dLon = (own.east - own.west) * 0.02;
  const dLat = (own.north - own.south) * 0.02;
  const lons = [0.25, 0.5, 0.75].map(
    (f) => own.west + f * (own.east - own.west)
  );
  const lats = [0.25, 0.5, 0.75].map(
    (f) => own.south + f * (own.north - own.south)
  );
  const side = (points: Array<[number, number]>): number =>
    points.every(([lon, lat]) => covered(lon, lat, others)) ? 0 : 1;
  const west = side(lats.map((lat) => [own.west - dLon, lat]));
  const east = side(lats.map((lat) => [own.east + dLon, lat]));
  const south = side(lons.map((lon) => [lon, own.south - dLat]));
  const north = side(lons.map((lon) => [lon, own.north + dLat]));
  const corner = (lon: number, lat: number, a: number, b: number): number =>
    a === 0 && b === 0 && !covered(lon, lat, others) ? 1 : 0;
  return {
    west,
    east,
    south,
    north,
    southWest: corner(own.west - dLon, own.south - dLat, west, south),
    southEast: corner(own.east + dLon, own.south - dLat, east, south),
    northWest: corner(own.west - dLon, own.north + dLat, west, north),
    northEast: corner(own.east + dLon, own.north + dLat, east, north),
  };
}

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * Le facteur d'opacité au point (u, v) de la tuile (u : ouest → est, v : sud → nord, comme `tilePatch`),
 * pour des côtés et coins qui s'effacent dans la mesure de leur poids (0 à 1, lissé dans le temps par le
 * moteur). JUMEAU exact de `COVERAGE_FEATHER_GLSL`, testé.
 */
export function coverageFeatherWeight(
  u: number,
  v: number,
  e: EdgeFade
): number {
  const fade = (amount: number, distance: number): number =>
    1 - amount * (1 - smooth(distance));
  return (
    fade(e.west, u) *
    fade(e.east, 1 - u) *
    fade(e.south, v) *
    fade(e.north, 1 - v) *
    fade(e.southWest, Math.max(u, v)) *
    fade(e.southEast, Math.max(1 - u, v)) *
    fade(e.northWest, Math.max(u, 1 - v)) *
    fade(e.northEast, Math.max(1 - u, 1 - v))
  );
}

/** Déclarations du fragment : côtés (ouest, est, sud, nord) et coins (SO, SE, NO, NE). */
export const COVERAGE_FEATHER_PARS_GLSL = `
	uniform vec4 uEdgeSide;
	uniform vec4 uEdgeCorner;
	float edgeFadeTerm( float amount, float distance ) {
		return 1.0 - amount * ( 1.0 - smoothstep( 0.0, 1.0, distance ) );
	}`;

/** Après `map_fragment` : l'opacité de la tuile du bord diminue vers l'extérieur de la couverture. */
export const COVERAGE_FEATHER_GLSL = `
	#ifdef USE_MAP
	{
		vec2 fuv = clamp( vMapUv, 0.0, 1.0 );
		diffuseColor.a *=
			edgeFadeTerm( uEdgeSide.x, fuv.x ) *
			edgeFadeTerm( uEdgeSide.y, 1.0 - fuv.x ) *
			edgeFadeTerm( uEdgeSide.z, fuv.y ) *
			edgeFadeTerm( uEdgeSide.w, 1.0 - fuv.y ) *
			edgeFadeTerm( uEdgeCorner.x, max( fuv.x, fuv.y ) ) *
			edgeFadeTerm( uEdgeCorner.y, max( 1.0 - fuv.x, fuv.y ) ) *
			edgeFadeTerm( uEdgeCorner.z, max( fuv.x, 1.0 - fuv.y ) ) *
			edgeFadeTerm( uEdgeCorner.w, max( 1.0 - fuv.x, 1.0 - fuv.y ) );
	}
	#endif`;

/**
 * Lissage temporel d'un poids vers sa cible : une couverture qui change (une tuile arrive, un niveau
 * bascule) ne fait pas sauter le fondu d'une image à l'autre (aucun scintillement). Constante de 250 ms.
 */
export const EDGE_FADE_TIME_MS = 250;
export function approach(
  current: number,
  target: number,
  dtMs: number
): number {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / EDGE_FADE_TIME_MS);
  const next = current + (target - current) * k;
  return Math.abs(next - target) < 1e-3 ? target : next;
}
