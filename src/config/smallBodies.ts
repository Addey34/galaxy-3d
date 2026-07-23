/**
 * Dataset des petits corps — séparé du catalogue curé des planètes (`bodies.ts`).
 *
 * Astronomy Engine ne fournit pas d'éphéméride pour les astéroïdes, comètes, géocroiseurs
 * et planètes naines : ils sont positionnés par leurs éléments orbitaux képlériens
 * (cf. `core/kepler.ts`). Ce module tient les données brutes dans les unités publiées par
 * les astronomes (JPL Small-Body Database, Minor Planet Center — degrés + UA) et un
 * convertisseur pur `smallBodyToConfig` vers le format catalogue.
 *
 * Les corps ci-dessous sont un socle curé de corps notables. Les éléments sont des valeurs
 * J2000 approximatives ; pour la précision long terme, les rafraîchir depuis JPL/MPC
 * (nouvelle époque). À l'échelle de milliers de corps, alimenter ce même convertisseur
 * depuis un JSON streamé (phase ultérieure) plutôt que des littéraux.
 */
import type { CelestialBodyConfig, TextureQuality } from '@/types';
import { exploCameraDistance } from '@/core/ScaleService';

const D2R = Math.PI / 180;

/** Éléments orbitaux d'un petit corps, dans les unités publiées (degrés, UA). */
export interface SmallBodyElements {
  /** Clé unique dans le catalogue (minuscule, sans espace). */
  name: string;
  /** Nom d'affichage localisé — renseigner par langue seulement là où il diffère de la
   *  clé capitalisée (français : Cérès, Hygie, Éris). Absent → clé capitalisée. */
  displayName?: { en?: string; fr?: string };
  /** Demi-grand axe (UA). */
  a: number;
  /** Excentricité. */
  e: number;
  /** Inclinaison (deg). */
  iDeg: number;
  /** Longitude du nœud ascendant Ω (deg). */
  omDeg: number;
  /** Argument du périhélie ω (deg). */
  wDeg: number;
  /** Anomalie moyenne à l'époque M₀ (deg). */
  maDeg: number;
  /** Époque de référence des éléments (ISO). */
  epoch: string;
  /** Rayon physique moyen (km). */
  radiusKm: number;
  /** Catégorie — défaut 'asteroid'. */
  kind?: 'asteroid' | 'comet' | 'dwarf';
  /** Couleur d'orbite/marqueur (0xRRGGBB) — défaut selon la catégorie. */
  color?: number;
  /** Résolutions d'une texture de surface locale. Absent = corps sans mesh. */
  surfaceResolutions?: TextureQuality[];
  /** Rayon visuel en mode Éducatif. Absent = 0,1 unité. */
  visualRadius?: number;
  /** Période de rotation sidérale (heures). */
  rotationHours?: number;
  /** Obliquité de l'axe de rotation (degrés). */
  axialTiltDeg?: number;
}

const DEFAULT_COLOR: Record<NonNullable<SmallBodyElements['kind']>, number> = {
  asteroid: 0x9c8f7a,
  comet: 0x6fd8e0,
  dwarf: 0xc9a0dc,
};

/**
 * Convertit une ligne d'éléments (degrés/UA) en entrée de catalogue : angles en radians,
 * période dérivée du demi-grand axe (3ᵉ loi de Kepler). Une texture de surface peut être
 * déclarée pour les corps disposant d'un asset local ; les autres restent sans mesh.
 * Fonction pure, testée.
 */
export function smallBodyToConfig(el: SmallBodyElements): CelestialBodyConfig {
  const kind = el.kind ?? 'asteroid';
  const periodDays = 365.256 * Math.pow(el.a, 1.5);
  const inclinationRad = el.iDeg * D2R;
  const ascendingNodeRad = el.omDeg * D2R;

  return {
    kind,
    ...(el.displayName ? { displayName: el.displayName } : {}),
    // Rayon de base nominal : évite une division par zéro dans setScaleMode et sert aussi
    // de garde-fou de cadrage pour les corps sans mesh.
    radius: el.visualRadius ?? 0.1,
    rotationSpeed: el.rotationHours
      ? (Math.PI * 2) / (el.rotationHours * 3_600)
      : 0,
    orbitalColor: el.color ?? DEFAULT_COLOR[kind],
    textureResolutions: el.surfaceResolutions
      ? { surface: el.surfaceResolutions }
      : {},
    textures: el.surfaceResolutions
      ? { surface: `${el.name}/${el.name}Surface` }
      : {},
    realData: {
      radiusKm: el.radiusKm,
      distanceAU: el.a,
      orbitPeriodDays: periodDays,
      orbitalInclination: inclinationRad,
      ascendingNode: ascendingNodeRad,
      axialTilt: (el.axialTiltDeg ?? 0) * D2R,
    },
    orbitalElements: {
      semiMajorAxisAU: el.a,
      eccentricity: el.e,
      inclinationRad,
      ascendingNodeRad,
      argPerihelionRad: el.wDeg * D2R,
      meanAnomalyAtEpochRad: el.maDeg * D2R,
      epoch: new Date(el.epoch),
    },
    cameraDistance: { educ: 2, explo: exploCameraDistance(el.radiusKm) },
  };
}

/**
 * Socle curé de petits corps notables (éléments J2000 approximatifs, époque 2451545.0).
 * Halley est rétrograde (i > 90°) : la propagation képlérienne le gère nativement.
 */
export const SMALL_BODY_ELEMENTS: readonly SmallBodyElements[] = [
  {
    name: 'ceres',
    displayName: { fr: 'Cérès' },
    a: 2.7691,
    e: 0.076,
    iDeg: 10.594,
    omDeg: 80.305,
    wDeg: 73.597,
    maDeg: 95.989,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 473,
    kind: 'dwarf',
    color: 0xa09880,
    surfaceResolutions: ['4k', '2k'],
    visualRadius: 0.1,
    rotationHours: 9.074,
    axialTiltDeg: 4,
  },
  {
    name: 'vesta',
    a: 2.3617,
    e: 0.0889,
    iDeg: 7.14,
    omDeg: 103.851,
    wDeg: 151.198,
    maDeg: 307.802,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 262,
  },
  {
    name: 'pallas',
    a: 2.7721,
    e: 0.2302,
    iDeg: 34.837,
    omDeg: 173.024,
    wDeg: 310.457,
    maDeg: 40.0,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 256,
  },
  {
    name: 'hygiea',
    displayName: { fr: 'Hygie' },
    a: 3.1415,
    e: 0.1125,
    iDeg: 3.842,
    omDeg: 283.198,
    wDeg: 312.301,
    maDeg: 152.18,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 217,
  },
  {
    name: 'pluto',
    displayName: { en: 'Pluto', fr: 'Pluton' },
    a: 39.482,
    e: 0.2488,
    iDeg: 17.14,
    omDeg: 110.299,
    wDeg: 113.834,
    maDeg: 14.53,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 1188,
    kind: 'dwarf',
    color: 0xd4c4a8,
  },
  {
    name: 'eris',
    displayName: { fr: 'Éris' },
    a: 67.78,
    e: 0.436,
    iDeg: 44.04,
    omDeg: 35.951,
    wDeg: 151.639,
    maDeg: 205.989,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 1163,
    kind: 'dwarf',
    color: 0x88aad0,
    surfaceResolutions: ['4k', '2k'],
    visualRadius: 0.183,
    rotationHours: 25.9,
    axialTiltDeg: 78,
  },
  {
    name: 'haumea',
    displayName: { en: 'Haumea', fr: 'Hauméa' },
    a: 43.218,
    e: 0.1913,
    iDeg: 28.19,
    omDeg: 121.91,
    wDeg: 239.04,
    maDeg: 205.65,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 780,
    kind: 'dwarf',
    color: 0xe08878,
    surfaceResolutions: ['4k', '2k'],
    visualRadius: 0.123,
    rotationHours: 3.9155,
    axialTiltDeg: 126,
  },
  {
    name: 'makemake',
    displayName: { en: 'Makemake', fr: 'Makémaké' },
    a: 45.715,
    e: 0.1559,
    iDeg: 28.98,
    omDeg: 79.62,
    wDeg: 294.83,
    maDeg: 165.51,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 715,
    kind: 'dwarf',
    color: 0xc98c68,
    surfaceResolutions: ['4k', '2k'],
    visualRadius: 0.112,
    rotationHours: 22.826,
    axialTiltDeg: 0,
  },
  {
    name: 'halley',
    a: 17.834,
    e: 0.9671,
    iDeg: 162.26,
    omDeg: 58.42,
    wDeg: 111.33,
    maDeg: 38.38,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 5.5,
    kind: 'comet',
  },
];

/** Table nom → config des petits corps, fusionnée dans `CELESTIAL_CONFIG`. */
export const SMALL_BODIES: Record<string, CelestialBodyConfig> =
  Object.fromEntries(
    SMALL_BODY_ELEMENTS.map((el) => [el.name, smallBodyToConfig(el)])
  );
