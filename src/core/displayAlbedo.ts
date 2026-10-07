/**
 * LUMINOSITÉ AFFICHÉE D'UNE SURFACE : ELLE SUIT L'ALBÉDO PUBLIÉ (2026-10-07).
 *
 * Avant cette règle, deux conventions cohabitaient et l'ordre des corps à l'écran était faux :
 * les mosaïques importées gardaient la luminosité choisie par leur éditeur (Encelade, albédo 1,0,
 * s'affichait à une luminance moyenne de 0,14), et les cartes fabriquées suivaient la convention
 * de cuisson de `scripts/display-albedo.mjs`, 2,6 par unité d'albédo (Miranda, 0,32, à 0,83).
 * Encelade paraissait six fois plus sombre que Miranda, l'inverse de la réalité.
 *
 * La règle : la luminance linéaire moyenne d'une surface, texture × gain, vaut
 * `DISPLAY_LUMINANCE_PER_ALBEDO` × albédo géométrique publié. Le gain s'applique au rendu (la
 * couleur du matériau), pas aux fichiers : rien n'est réencodé, et un gain supérieur à 1 ne
 * s'écrête pas sur 8 bits, la compression des hautes lumières (ACES) s'en charge. 0,5 est le
 * plus grand facteur qui laisse Encelade, le corps le plus clair, sous 5 % de valeurs saturées
 * sur sa propre texture ; à 0,7 elle en avait 14 %, à 1,0 45 % (mesuré le 2026-10-07).
 *
 * Ce module est le SEUL propriétaire de la règle : le générateur
 * (`scripts/measure-display-albedo.mjs`), la table qu'il écrit (`config/displayAlbedo.json`), le
 * rendu et les vignettes de partage la lisent ici.
 */

/** Luminance linéaire moyenne affichée par unité d'albédo géométrique. */
export const DISPLAY_LUMINANCE_PER_ALBEDO = 0.5;

/**
 * Gain d'une surface texturée : ce qui ramène la luminance moyenne MESURÉE de sa texture à
 * celle que demande son albédo.
 */
export function displayGain(
  albedo: number,
  textureMeanLuminance: number
): number {
  if (!(albedo > 0) || !(textureMeanLuminance > 0))
    throw new Error(
      `gain indéfini : albédo ${albedo}, luminance ${textureMeanLuminance}`
    );
  return (DISPLAY_LUMINANCE_PER_ALBEDO * albedo) / textureMeanLuminance;
}

/**
 * Gain d'un modèle de forme à couleur CUITE : la cuisson a déjà mis sa moyenne à
 * `bakedPerAlbedo` × albédo (`scripts/display-albedo.mjs`, tenu par `shapeModels.test.ts`), donc
 * le même facteur pour tous.
 */
export function bakedGain(bakedPerAlbedo: number): number {
  return DISPLAY_LUMINANCE_PER_ALBEDO / bakedPerAlbedo;
}

const toLinear = (byte: number): number => {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * Luminance LINÉAIRE moyenne d'une image RVB 8 bits (sRGB), pondérée par l'aire : cos(latitude)
 * sur une carte équirectangulaire, uniforme sur l'atlas d'un modèle (xatlas égalise l'aire des
 * texels). Mêmes poids que `scripts/compose-albedo-texture.mjs`.
 */
export function meanLinearLuminance(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  channels: number,
  atlas: boolean
): number {
  const lut = Array.from({ length: 256 }, (_, c) => toLinear(c));
  let sum = 0;
  let area = 0;
  for (let y = 0; y < height; y++) {
    const w = atlas ? 1 : Math.cos(((y + 0.5) / height - 0.5) * Math.PI);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      sum +=
        w *
        (0.2126 * lut[rgb[i]!]! +
          0.7152 * lut[rgb[i + 1]!]! +
          0.0722 * lut[rgb[i + 2]!]!);
      area += w;
    }
  }
  return sum / area;
}

/** Largeur en longitude et demi-hauteur en latitude d'une « face » pour `faceContrast`. */
export const FACE_LONGITUDE_DEG = 60;
export const FACE_HALF_LATITUDE_DEG = 40;

/**
 * LE CONTRASTE ENTRE LES FACES d'une carte équirectangulaire (2026-10-07) : la luminance
 * linéaire moyenne de la fenêtre la plus claire divisée par celle de la plus sombre, chaque
 * fenêtre couvrant `FACE_LONGITUDE_DEG` de longitude sur ±`FACE_HALF_LATITUDE_DEG` de latitude,
 * pondérée cos(latitude), les longitudes balayées tous les degrés. C'est la grandeur qu'un corps
 * à deux albédos (Japet) devrait reproduire pour qu'un gain unique suffise.
 */
export function faceContrast(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  channels: number
): number {
  const lut = Array.from({ length: 256 }, (_, c) => toLinear(c));
  const yFrom = Math.round(height * (0.5 - FACE_HALF_LATITUDE_DEG / 180));
  const yTo = Math.round(height * (0.5 + FACE_HALF_LATITUDE_DEG / 180));
  // Une colonne : somme pondérée de sa luminance et de son aire, sur la bande de latitudes.
  const sum = new Float64Array(width);
  const area = new Float64Array(width);
  for (let y = yFrom; y < yTo; y++) {
    const w = Math.cos(((y + 0.5) / height - 0.5) * Math.PI);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      sum[x]! +=
        w *
        (0.2126 * lut[rgb[i]!]! +
          0.7152 * lut[rgb[i + 1]!]! +
          0.0722 * lut[rgb[i + 2]!]!);
      area[x]! += w;
    }
  }
  const span = Math.max(1, Math.round((width * FACE_LONGITUDE_DEG) / 360));
  const step = Math.max(1, Math.round(width / 360));
  let darkest = Infinity;
  let brightest = 0;
  for (let x0 = 0; x0 < width; x0 += step) {
    let s = 0;
    let a = 0;
    for (let dx = 0; dx < span; dx++) {
      s += sum[(x0 + dx) % width]!;
      a += area[(x0 + dx) % width]!;
    }
    darkest = Math.min(darkest, s / a);
    brightest = Math.max(brightest, s / a);
  }
  return brightest / darkest;
}

/**
 * Pression de surface PUBLIÉE au-delà de laquelle le disque vu est une atmosphère et non la
 * surface de la texture. 1 mbar sépare Mars (6,36 mbar, poussière et calottes saisonnières dans
 * son albédo de disque) de Pluton (~13 µbar) et Mercure (~5 × 10⁻¹⁵ bar), mesurés sur les fiches
 * du NSSDCA le 2026-10-07.
 */
export const ATMOSPHERE_MIN_SURFACE_PRESSURE_BAR = 1e-3;

/** Ce que le générateur a besoin de savoir d'un corps pour décider s'il suit la règle. */
export interface DisplayAlbedoCandidate {
  kind: string;
  /**
   * La PREUVE d'une atmosphère, en une phrase citant sa source, ou `undefined` : le catalogue en
   * déclare une (couleur, couche, nuages), une fiche publie une pression de surface d'au moins
   * `ATMOSPHERE_MIN_SURFACE_PRESSURE_BAR`, ou une citation vérifiée par le relevé le dit.
   */
  atmosphereEvidence?: string;
  hasSurfaceTexture: boolean;
  /** Albédo cuit dans un modèle sans texture (`model.albedo`), s'il y en a un. */
  bakedAlbedo?: number;
}

/**
 * Les RAISONS pour lesquelles un corps ne suit pas la règle, en codes : la table les garde à côté
 * de leur phrase, et `/methodology` les publie dans chaque langue sans relire la phrase française.
 * `noAlbedo` et `twoAlbedos` sont décidées par le générateur, qui seul lit le relevé.
 */
export const DISPLAY_ALBEDO_EXCLUSIONS = [
  'notLit',
  'atmosphere',
  'twoAlbedos',
  'noAlbedo',
  'noColour',
] as const;
export type DisplayAlbedoExclusionKind =
  (typeof DISPLAY_ALBEDO_EXCLUSIONS)[number];

export interface DisplayAlbedoExclusion {
  kind: DisplayAlbedoExclusionKind;
  /** Une phrase publiable, en français : la table la garde, et l'inventaire la lit. */
  reason: string;
}

/** Pourquoi un corps NE suit PAS la règle, ou `null` s'il la suit. */
export function displayAlbedoExclusion(
  body: DisplayAlbedoCandidate
): DisplayAlbedoExclusion | null {
  if (['star', 'skybox', 'spacecraft', 'interstellar'].includes(body.kind))
    return { kind: 'notLit', reason: 'pas une surface éclairée' };
  if (body.atmosphereEvidence)
    return {
      kind: 'atmosphere',
      reason: `atmosphère (${body.atmosphereEvidence}) : l'albédo publié est celui du disque entier, nuages et brumes compris, pas celui de la surface que porte la texture`,
    };
  if (!body.hasSurfaceTexture && body.bakedAlbedo === undefined)
    return {
      kind: 'noColour',
      reason: 'ni texture ni couleur cuite : la teinte de repli de la fiche',
    };
  return null;
}
