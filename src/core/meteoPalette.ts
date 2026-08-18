/**
 * PALETTES de rendu des champs scalaires météo modélisés (famille B). Module PUR (grille+palette →
 * octets RGBA équirectangulaires, pas de DOM/three/réseau) → unit-testable.
 *
 * Contrairement aux nuages (couverture → alpha en niveaux de gris, `cloudCoverToRGBA`), la
 * température et la pluie sont des grandeurs QUANTITATIVES qu'on colore via une palette : chaque
 * valeur du champ est mappée sur un domaine [min..max] puis interpolée entre des arrêts de couleur.
 * L'alpha encode « il y a une donnée à afficher » (ex. pluie : transparent là où il ne pleut pas,
 * pour laisser voir la Terre dessous), pilotable par un seuil.
 *
 * La même palette sert au RENDU (texture) et à la LÉGENDE (dégradé CSS via `paletteToCss`) →
 * cohérence garantie entre ce que l'utilisateur voit sur le globe et la barre du panneau.
 */

/** Un arrêt de couleur à une position normalisée `t` (0..1) du domaine. */
export interface PaletteStop {
  /** Position dans le domaine [0..1] (0 = min, 1 = max). */
  t: number;
  /** Couleur RGB (0..255). */
  rgb: [number, number, number];
}

export interface Palette {
  /** Arrêts triés par `t` croissant (0 → 1). */
  stops: PaletteStop[];
}

/**
 * Palette TEMPÉRATURE de l'air 2 m (°C), style météo classique : violet (froid extrême) → bleu →
 * cyan → vert → jaune → orange → rouge (chaud). Domaine par défaut −40 → +45 °C (cf.
 * {@link TEMPERATURE_DOMAIN}).
 */
export const TEMPERATURE_PALETTE: Palette = {
  stops: [
    { t: 0.0, rgb: [68, 1, 84] }, // −40 : violet profond
    { t: 0.18, rgb: [59, 82, 175] }, // bleu
    { t: 0.36, rgb: [64, 170, 216] }, // cyan
    { t: 0.5, rgb: [102, 189, 99] }, // vert (≈ 2 °C)
    { t: 0.64, rgb: [230, 220, 90] }, // jaune
    { t: 0.82, rgb: [244, 148, 54] }, // orange
    { t: 1.0, rgb: [178, 24, 43] }, // +45 : rouge profond
  ],
};

/** Domaine °C par défaut de la palette température. */
export const TEMPERATURE_DOMAIN = { min: -40, max: 45 };

/**
 * Palette PRÉCIPITATION (mm/h) : du bleu clair (bruine) au violet (déluge), transparent sous le
 * seuil. Domaine par défaut 0 → 20 mm/h (au-delà, saturé sur la dernière couleur).
 */
export const PRECIP_PALETTE: Palette = {
  stops: [
    { t: 0.0, rgb: [160, 210, 255] }, // bruine, bleu très clair
    { t: 0.25, rgb: [60, 150, 240] }, // pluie faible
    { t: 0.5, rgb: [30, 90, 220] }, // pluie modérée
    { t: 0.75, rgb: [120, 50, 210] }, // forte
    { t: 1.0, rgb: [150, 20, 140] }, // déluge, violet-magenta
  ],
};

/** Domaine mm/h par défaut de la palette pluie. */
export const PRECIP_DOMAIN = { min: 0, max: 20 };

/** Palette PRESSION au niveau de la mer (hPa) : dépression froide → zone neutre → anticyclone chaud. */
export const PRESSURE_PALETTE: Palette = {
  stops: [
    { t: 0.0, rgb: [82, 32, 160] }, // dépression forte
    { t: 0.2, rgb: [45, 93, 190] }, // dépression
    { t: 0.4, rgb: [84, 181, 218] }, // pression basse
    { t: 0.5, rgb: [238, 245, 235] }, // proche de la normale
    { t: 0.65, rgb: [142, 204, 105] }, // pression élevée
    { t: 0.82, rgb: [245, 178, 55] }, // anticyclone
    { t: 1.0, rgb: [204, 57, 38] }, // anticyclone fort
  ],
};

/** Domaine hPa usuel pour la pression synoptique au niveau de la mer. */
export const PRESSURE_DOMAIN = { min: 960, max: 1060 };

/** Palette HUMIDITÉ relative à 2 m (%) : sec et ocre → humide et bleu profond. */
export const HUMIDITY_PALETTE: Palette = {
  stops: [
    { t: 0.0, rgb: [145, 93, 52] }, // air très sec
    { t: 0.35, rgb: [220, 190, 65] }, // sec à modéré
    { t: 0.55, rgb: [118, 190, 73] }, // humide
    { t: 0.75, rgb: [47, 160, 170] }, // très humide
    { t: 0.9, rgb: [38, 100, 190] }, // humide saturé
    { t: 1.0, rgb: [15, 40, 120] }, // saturation
  ],
};

/** Domaine pourcentage de l'humidité relative. */
export const HUMIDITY_DOMAIN = { min: 0, max: 100 };
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Couleur (0..255) de la palette à une position normalisée `t` (0..1), interpolation linéaire
 * entre les deux arrêts encadrants. `t` hors [0..1] est clampé sur les extrémités.
 */
export function samplePalette(
  palette: Palette,
  t: number
): [number, number, number] {
  const { stops } = palette;
  const u = clamp01(t);
  if (u <= stops[0].t) return stops[0].rgb;
  if (u >= stops[stops.length - 1].t) return stops[stops.length - 1].rgb;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (u >= a.t && u <= b.t) {
      const f = (u - a.t) / (b.t - a.t || 1);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1].rgb;
}

import type { ScalarGrid } from './meteoGrid';

export interface ScalarRenderOptions {
  /** Bornes physiques du domaine (valeur → position palette). */
  min: number;
  max: number;
  /**
   * Sous cette valeur physique, le pixel est TRANSPARENT (alpha 0) : sert la pluie (rien à
   * montrer là où il ne pleut pas). Défaut −Infinity (tout est opaque, cas température).
   */
  transparentBelow?: number;
  /** Opacité maximale (0..255) des pixels au-dessus du seuil. Défaut 255. */
  maxAlpha?: number;
  /**
   * Largeur de la rampe d'alpha (unités physiques) au-dessus de `transparentBelow` : l'alpha monte
   * de 0 à `maxAlpha` sur cet intervalle, pour ne pas avoir de bord dur. Défaut 0 (bord net).
   */
  alphaRamp?: number;
}

/**
 * Encode une `ScalarGrid` en octets RGBA équirectangulaires colorés via une palette. Comme
 * {@link cloudCoverToRGBA}, la rangée 0 de la grille est le SUD → on écrit l'image NORD en haut
 * (inversion verticale). Pur (Uint8ClampedArray, pas de three).
 */
export function scalarGridToRGBA(
  grid: ScalarGrid,
  palette: Palette,
  options: ScalarRenderOptions
): { data: Uint8ClampedArray; width: number; height: number } {
  const { nLat, nLon, values } = grid;
  const { min, max } = options;
  const transparentBelow = options.transparentBelow ?? -Infinity;
  const maxAlpha = options.maxAlpha ?? 255;
  const alphaRamp = options.alphaRamp ?? 0;
  const span = max - min || 1;

  const data = new Uint8ClampedArray(nLat * nLon * 4);
  for (let row = 0; row < nLat; row++) {
    const srcRow = nLat - 1 - row; // NORD (lat max) en haut de l'image
    for (let col = 0; col < nLon; col++) {
      const v = values[srcRow * nLon + col];
      const [r, g, b] = samplePalette(palette, (v - min) / span);
      const o = (row * nLon + col) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      let alpha = maxAlpha;
      if (v < transparentBelow) {
        alpha = 0;
      } else if (alphaRamp > 0) {
        const f = clamp01((v - transparentBelow) / alphaRamp);
        alpha = Math.round(maxAlpha * f);
      }
      data[o + 3] = alpha;
    }
  }
  return { data, width: nLon, height: nLat };
}

/**
 * Construit une valeur CSS `linear-gradient(...)` (horizontal, gauche = min) depuis une palette,
 * pour la barre de légende du panneau — GARANTIT la cohérence avec le rendu (même palette). Le
 * `direction` par défaut `to right` correspond à min→max.
 */
export function paletteToCss(palette: Palette, direction = 'to right'): string {
  const parts = palette.stops.map(
    (s) => `rgb(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]}) ${Math.round(s.t * 100)}%`
  );
  return `linear-gradient(${direction}, ${parts.join(', ')})`;
}
