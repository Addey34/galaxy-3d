/**
 * Légende d'une couche satellite GIBS, RENDUE PAR NOUS.
 *
 * La couche « température satellite » pointait sa légende vers
 * `gibs.earthdata.nasa.gov/legends/….svg` dans un `<img src>`, que notre propre CSP interdit
 * (`img-src 'self' data: blob:`) : la légende n'est jamais apparue en production, et personne
 * ne l'a vu parce qu'une image bloquée ne dit rien. Le SVG pèse en outre 324 ko et embarque un
 * `<script>`.
 *
 * GIBS publie le même barème sous forme lisible par une machine, importé une fois par
 * `scripts/import-gibs-colormap.mjs` dans `config/gibsColormap.json`. Ce module en fait un
 * dégradé CSS et deux bornes lisibles. **Les couleurs restent celles de la NASA** : ce n'est
 * pas une palette de remplacement, c'est la même, rendue sans requête.
 *
 * Module PUR : ni DOM, ni réseau.
 */
import colormap from '@/config/gibsColormap.json';

export interface GibsColormap {
  layer: string;
  source: string;
  retrieved: string;
  units: string;
  min: number;
  max: number;
  stops: { offset: number; rgb: number[] }[];
}

export const GIBS_COLORMAP = colormap as GibsColormap;

/** Zéro absolu en degrés Celsius : la conversion kelvin → °C, et rien d'autre. */
const KELVIN_OFFSET = 273.15;

/** Dégradé CSS horizontal, arrêts dans l'ordre publié par le barème. */
export function colormapToCss(map: GibsColormap = GIBS_COLORMAP): string {
  const stops = map.stops
    .map(
      ({ offset, rgb }) =>
        `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]}) ${(offset * 100).toFixed(1)}%`
    )
    .join(', ');
  return `linear-gradient(to right, ${stops})`;
}

/**
 * Bornes affichées, en degrés Celsius arrondis. Le barème est publié en kelvins : les montrer
 * tels quels demanderait au lecteur une conversion que la fiche fait partout ailleurs pour lui.
 * Le signe moins est le vrai (U+2212), comme dans les libellés des couches de modèle.
 */
export function colormapBoundsC(map: GibsColormap = GIBS_COLORMAP): {
  lo: string;
  hi: string;
} {
  if (map.units !== 'K')
    throw new Error(`barème GIBS en ${map.units}, attendu en kelvins`);
  const label = (kelvin: number): string => {
    const celsius = Math.round(kelvin - KELVIN_OFFSET);
    return `${celsius < 0 ? '−' : '+'}${Math.abs(celsius)} °C`;
  };
  return { lo: label(map.min), hi: label(map.max) };
}
