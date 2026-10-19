/**
 * LES NOMS DE LA TERRE, CHOISIS PAR LA RÈGLE DE LEUR SOURCE (lot 53, pas 1).
 *
 * Module PUR. Les noms viennent de Natural Earth (`scripts/generate-earth-names.mjs`), qui publie
 * pour chacun le niveau de zoom d'une carte web à partir duquel il doit paraître (`minZoom`) et,
 * pour un nom trop grand vu de près, celui au-delà duquel il s'efface (`maxZoom`, la
 * Méditerranée de 2 à 7,5). Ce module ne décide donc rien d'une taille : il convertit la vue en
 * niveau de zoom, puis applique la règle publiée.
 *
 * LA CONVERSION : un niveau de zoom z d'une carte web est DÉFINI par sa résolution à l'équateur,
 * 40 075 016,686 m répartis sur 256 × 2^z pixels. La vue fournit des mètres par pixel au point
 * de la surface le plus proche de la caméra, et l'on en tire z. Le resserrement de la projection
 * de Mercator vers les pôles n'est pas reproduit : une carte web y affiche un nom plus tôt, un
 * globe n'a pas cette déformation à imiter.
 */

/** Le corps qui porte ces noms : celui du fichier servi, `/assets/earth-names/earth.json`. */
export const EARTH_NAMES_BODY = 'earth';

/** Un nom de Natural Earth, tel que le générateur le livre. */
export interface EarthName {
  readonly name: string;
  readonly kind: string;
  readonly lat: number;
  /** Longitude EST en degrés, −180 à 180 comme dans la source. */
  readonly lon: number;
  readonly minZoom: number;
  readonly maxZoom?: number;
  /** Traductions publiées par la source quand elles diffèrent de l'anglais. */
  readonly names?: {
    readonly fr?: string;
    readonly es?: string;
    readonly pt?: string;
  };
}

/** Circonférence équatoriale de la projection des cartes web (EPSG:3857), en mètres. */
export const WEB_MAP_EQUATOR_M = 40_075_016.686;

/** Taille de tuile qui définit les niveaux de zoom d'une carte web. */
const WEB_MAP_TILE_PX = 256;

/** Niveau de zoom d'une carte web dont la résolution à l'équateur vaut `metresPerPixel`. */
export function webMapZoom(metresPerPixel: number): number {
  if (!(metresPerPixel > 0)) return Number.POSITIVE_INFINITY;
  return Math.log2(WEB_MAP_EQUATOR_M / (WEB_MAP_TILE_PX * metresPerPixel));
}

/**
 * Mètres par pixel CSS au point de la surface le plus proche de la caméra : la hauteur visible à
 * l'altitude `altitudeM`, pour un champ vertical `fovDeg`, répartie sur la hauteur de la vue.
 */
export function metresPerPixelAt(
  altitudeM: number,
  fovDeg: number,
  viewportHeightPx: number
): number {
  if (!(altitudeM > 0) || !(viewportHeightPx > 0)) return 0;
  const visibleM = 2 * altitudeM * Math.tan((fovDeg * Math.PI) / 180 / 2);
  return visibleM / viewportHeightPx;
}

/**
 * Les noms à écrire à ce niveau de zoom, dans l'ordre du fichier (les plus importants d'abord,
 * c'est le générateur qui trie), au plus `max`.
 */
export function earthNamesToLabel(
  names: readonly EarthName[],
  zoom: number,
  max: number
): EarthName[] {
  const out: EarthName[] = [];
  for (const entry of names) {
    if (out.length >= max) break;
    if (entry.minZoom > zoom) continue;
    if (entry.maxZoom !== undefined && zoom > entry.maxZoom) continue;
    out.push(entry);
  }
  return out;
}

/**
 * Le nom dans la langue de l'interface, l'anglais sinon. Le portugais du Brésil lit le portugais
 * de la source, qui n'a pas de variante brésilienne (Wikidata `pt`).
 */
export function earthNameIn(
  entry: EarthName,
  locale: 'en' | 'fr' | 'es' | 'pt-BR'
): string {
  if (locale === 'en') return entry.name;
  const key = locale === 'pt-BR' ? 'pt' : locale;
  return entry.names?.[key] ?? entry.name;
}
