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
import colormaps from '@/config/gibsColormap.json';

export interface GibsColormap {
  layer: string;
  source: string;
  retrieved: string;
  units: string;
  min: number;
  max: number;
  stops: { offset: number; rgb: number[] }[];
}

/**
 * Les couches GIBS dont la légende est rendue par nous, seule liste du dépôt : l'outil
 * `scripts/import-gibs-colormap.mjs` la LIT ici (d'où sa forme littérale), et la garde exige que
 * le fichier livré porte exactement ces barèmes.
 */
export const GIBS_LEGEND_LAYERS = [
  'MERRA2_2m_Air_Temperature_Monthly',
  'GHRSST_L4_MUR_Sea_Surface_Temperature',
] as const;

export type GibsLegendLayer = (typeof GIBS_LEGEND_LAYERS)[number];

/** Le barème d'une couche de la liste. */
export function gibsColormap(layer: GibsLegendLayer): GibsColormap {
  const map = (colormaps as Record<string, GibsColormap>)[layer];
  if (!map) throw new Error(`barème GIBS absent : ${layer}`);
  return map;
}

/** Le barème de la température de l'air (MERRA-2), la première couche à en avoir eu un. */
export const GIBS_COLORMAP = gibsColormap('MERRA2_2m_Air_Temperature_Monthly');

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
export function colormapRangeC(map: GibsColormap = GIBS_COLORMAP): {
  lo: number;
  hi: number;
} {
  const toCelsius =
    map.units === 'K'
      ? (v: number): number => v - KELVIN_OFFSET
      : map.units === '°C'
        ? (v: number): number => v
        : null;
  if (!toCelsius)
    throw new Error(`barème GIBS en ${map.units}, attendu en kelvins ou en °C`);
  return {
    lo: Math.round(toCelsius(map.min)),
    hi: Math.round(toCelsius(map.max)),
  };
}

export function colormapBoundsC(map: GibsColormap = GIBS_COLORMAP): {
  lo: string;
  hi: string;
} {
  // Le barème DIT son unité : la température de l'air en kelvins, celle de la mer en degrés
  // Celsius. Toute autre unité est refusée plutôt que lue comme l'une des deux.
  const toCelsius =
    map.units === 'K'
      ? (v: number): number => v - KELVIN_OFFSET
      : map.units === '°C'
        ? (v: number): number => v
        : null;
  if (!toCelsius)
    throw new Error(`barème GIBS en ${map.units}, attendu en kelvins ou en °C`);
  const label = (value: number): string => {
    const celsius = Math.round(toCelsius(value));
    return `${celsius < 0 ? '−' : '+'}${Math.abs(celsius)} °C`;
  };
  return { lo: label(map.min), hi: label(map.max) };
}
