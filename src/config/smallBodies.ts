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

  // ── Champs documentaires (fiche d'info) — mêmes unités que `RealData`. ──
  /** Masse en kg. */
  massKg?: number;
  /** Gravité de surface en m/s². */
  gravity?: number;
  /** Température moyenne de surface en °C. */
  meanTempC?: number;
  /** Nombre de satellites naturels connus. */
  moonCount?: number;
  /** Courte description grand public, localisée (FR/EN). */
  description?: { en: string; fr: string };
  /** Lien « En savoir plus » par langue (article Wikipédia dédié). */
  wiki?: { en: string; fr: string };
}

const DEFAULT_COLOR: Record<NonNullable<SmallBodyElements['kind']>, number> = {
  asteroid: 0xb3956c,
  comet: 0x6fe6e8,
  dwarf: 0xc391e6,
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
      // Champs documentaires optionnels — transmis tels quels à la fiche d'info.
      ...(el.massKg !== undefined ? { massKg: el.massKg } : {}),
      ...(el.gravity !== undefined ? { gravity: el.gravity } : {}),
      ...(el.meanTempC !== undefined ? { meanTempC: el.meanTempC } : {}),
      ...(el.moonCount !== undefined ? { moonCount: el.moonCount } : {}),
      ...(el.description ? { description: el.description } : {}),
      ...(el.wiki ? { wiki: el.wiki } : {}),
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
    color: 0xc5a46d,
    surfaceResolutions: ['4k', '2k'],
    visualRadius: 0.1,
    rotationHours: 9.074,
    axialTiltDeg: 4,
    massKg: 9.39e20,
    gravity: 0.28,
    meanTempC: -105,
    moonCount: 0,
    description: {
      en: 'The largest body of the asteroid belt and the only dwarf planet of the inner Solar System. NASA’s Dawn probe revealed bright salt deposits there — traces of a briny subsurface ocean.',
      fr: 'Le plus gros corps de la ceinture d’astéroïdes et la seule planète naine du Système solaire interne. La sonde Dawn y a révélé des dépôts de sel brillants — traces d’un océan souterrain saumâtre.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Ceres_(dwarf_planet)',
      fr: 'https://fr.wikipedia.org/wiki/(1)_C%C3%A9r%C3%A8s',
    },
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
    color: 0xd8b894,
    surfaceResolutions: ['4k', '2k'],
    visualRadius: 0.188,
    rotationHours: 153.3,
    axialTiltDeg: 119.6,
    massKg: 1.303e22,
    gravity: 0.62,
    meanTempC: -229,
    moonCount: 5,
    description: {
      en: 'Demoted from planet to dwarf planet in 2006, it hosts a heart-shaped nitrogen glacier photographed by New Horizons in 2015. Its moon Charon is so large that the two form a double system.',
      fr: 'Rétrogradée de planète à planète naine en 2006, elle abrite un glacier d’azote en forme de cœur photographié par New Horizons en 2015. Sa lune Charon est si grande que les deux forment un système double.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Pluto',
      fr: 'https://fr.wikipedia.org/wiki/Pluton_(plan%C3%A8te_naine)',
    },
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
    color: 0x91bce6,
    surfaceResolutions: ['4k', '2k'],
    visualRadius: 0.183,
    rotationHours: 25.9,
    axialTiltDeg: 78,
    massKg: 1.66e22,
    gravity: 0.82,
    meanTempC: -231,
    moonCount: 1,
    description: {
      en: 'More massive than Pluto: its discovery in 2005 forced astronomers to define what a planet is — and cost Pluto its status. It roams up to three times farther from the Sun than Pluto.',
      fr: 'Plus massive que Pluton : sa découverte en 2005 a forcé les astronomes à définir ce qu’est une planète — et a coûté son statut à Pluton. Elle s’éloigne jusqu’à trois fois plus loin du Soleil que Pluton.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Eris_(dwarf_planet)',
      fr: 'https://fr.wikipedia.org/wiki/(136199)_%C3%89ris',
    },
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
    color: 0xe58f7a,
    surfaceResolutions: ['4k', '2k'],
    visualRadius: 0.123,
    rotationHours: 3.9155,
    axialTiltDeg: 126,
    massKg: 4.006e21,
    gravity: 0.44,
    meanTempC: -241,
    moonCount: 2,
    description: {
      en: 'Spinning in under 4 hours — the fastest of any large body in the Solar System — it has been stretched into an egg shape. In 2017 it became the first trans-Neptunian object found to have a ring.',
      fr: 'Tournant sur elle-même en moins de 4 heures — record des grands corps du Système solaire — elle s’est étirée en forme d’œuf. En 2017, elle est devenue le premier objet transneptunien doté d’un anneau connu.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Haumea',
      fr: 'https://fr.wikipedia.org/wiki/(136108)_Haum%C3%A9a',
    },
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
    color: 0xd78352,
    surfaceResolutions: ['4k', '2k'],
    visualRadius: 0.112,
    rotationHours: 22.826,
    axialTiltDeg: 0,
    massKg: 3.1e21,
    gravity: 0.5,
    meanTempC: -239,
    moonCount: 1,
    description: {
      en: 'Discovered just after Easter 2005 and nicknamed “Easterbunny”, it was later named after the creator god of Rapa Nui (Easter Island). Its reddish surface is coated in frozen methane.',
      fr: 'Découverte juste après Pâques 2005 et surnommée « Easterbunny », elle fut ensuite nommée d’après le dieu créateur de Rapa Nui (île de Pâques). Sa surface rougeâtre est couverte de méthane gelé.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Makemake',
      fr: 'https://fr.wikipedia.org/wiki/(136472)_Mak%C3%A9mak%C3%A9',
    },
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
    description: {
      en: 'The most famous comet, visible from Earth every ~76 years — next return in 2061. It orbits backwards, against the flow of the planets.',
      fr: 'La plus célèbre des comètes, visible depuis la Terre tous les ~76 ans — prochain retour en 2061. Elle orbite à rebours, à contre-courant des planètes.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Halley%27s_Comet',
      fr: 'https://fr.wikipedia.org/wiki/Com%C3%A8te_de_Halley',
    },
  },
];

/** Table nom → config des petits corps, fusionnée dans `CELESTIAL_CONFIG`. */
export const SMALL_BODIES: Record<string, CelestialBodyConfig> =
  Object.fromEntries(
    SMALL_BODY_ELEMENTS.map((el) => [el.name, smallBodyToConfig(el)])
  );
