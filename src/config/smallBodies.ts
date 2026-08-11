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
  satellites?: Record<string, CelestialBodyConfig>;
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
    // `textures` est dérivé au chargement du catalogue (voir bodies.ts / deriveTextures).
    ...(el.satellites ? { satellites: el.satellites } : {}),
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
    surfaceResolutions: ['4k', '2k', '1k'],
    visualRadius: 0.1,
    rotationHours: 9.074,
    axialTiltDeg: 4,
    massKg: 9.39e20,
    gravity: 0.28,
    meanTempC: -105,
    moonCount: 0,
    description: {
      en: 'The largest body of the asteroid belt and the only dwarf planet of the inner Solar System. NASA’s Dawn probe revealed bright salt deposits there, traces of a briny subsurface ocean.',
      fr: 'Le plus gros corps de la ceinture d’astéroïdes et la seule planète naine du Système solaire interne. La sonde Dawn y a révélé des dépôts de sel brillants, traces d’un océan souterrain saumâtre.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Ceres_(dwarf_planet)',
      fr: 'https://fr.wikipedia.org/wiki/(1)_C%C3%A9r%C3%A8s',
    },
  },
  {
    name: 'vesta',
    displayName: { en: 'Vesta', fr: 'Vesta' },
    a: 2.3617,
    e: 0.0889,
    iDeg: 7.14,
    omDeg: 103.851,
    wDeg: 151.198,
    maDeg: 307.802,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 262,
    color: 0xc8795d,
    surfaceResolutions: ['8k', '4k', '2k', '1k'],
    rotationHours: 5.342,
    axialTiltDeg: 29,
    massKg: 2.59e20,
    gravity: 0.25,
    meanTempC: -108,
    moonCount: 0,
    description: {
      en: 'The brightest asteroid, and the only one occasionally visible to the naked eye. A giant impact blasted away its south pole, and fragments of that crater rain down on Earth as some of our meteorites.',
      fr: 'L’astéroïde le plus brillant, et le seul parfois visible à l’œil nu. Un impact géant a arraché son pôle sud, et des fragments de ce cratère tombent sur Terre sous forme de certaines de nos météorites.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/4_Vesta',
      fr: 'https://fr.wikipedia.org/wiki/(4)_Vesta',
    },
  },
  {
    name: 'pallas',
    displayName: { en: 'Pallas', fr: 'Pallas' },
    a: 2.7721,
    e: 0.2302,
    iDeg: 34.837,
    omDeg: 173.024,
    wDeg: 310.457,
    maDeg: 40.0,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 256,
    color: 0x9b82d1,
    surfaceResolutions: ['2k'],
    rotationHours: 7.813,
    axialTiltDeg: 84,
    massKg: 2.04e20,
    gravity: 0.21,
    meanTempC: -109,
    moonCount: 0,
    description: {
      en: 'The third-largest asteroid, and the very first to be discovered after Ceres, in 1802. Its steeply tilted orbit is so inclined that no spacecraft has ever visited it.',
      fr: 'Le troisième plus gros astéroïde, et le tout premier découvert après Cérès, en 1802. Son orbite fortement inclinée est si penchée qu’aucune sonde ne l’a jamais visité.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/2_Pallas',
      fr: 'https://fr.wikipedia.org/wiki/(2)_Pallas',
    },
  },
  {
    name: 'hygiea',
    displayName: { en: 'Hygiea', fr: 'Hygie' },
    a: 3.1415,
    e: 0.1125,
    iDeg: 3.842,
    omDeg: 283.198,
    wDeg: 312.301,
    maDeg: 152.18,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 217,
    color: 0x6fbf8a,
    surfaceResolutions: ['2k'],
    rotationHours: 13.83,
    axialTiltDeg: 0,
    massKg: 8.74e19,
    gravity: 0.09,
    meanTempC: -109,
    moonCount: 0,
    description: {
      en: 'The fourth-largest asteroid. In 2019 it was found to be nearly spherical, so round it may qualify as the smallest dwarf planet in the Solar System.',
      fr: 'Le quatrième plus gros astéroïde. En 2019, on l’a découvert quasi sphérique, si rond qu’il pourrait être la plus petite planète naine du Système solaire.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/10_Hygiea',
      fr: 'https://fr.wikipedia.org/wiki/(10)_Hygie',
    },
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
    surfaceResolutions: ['8k', '4k', '2k', '1k'],
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
    satellites: {
      charon: {
        kind: 'moon',
        displayName: { en: 'Charon', fr: 'Charon' },
        radius: 0.1,
        rotationSpeed: (Math.PI * 2) / (153.293328 * 3_600),
        orbitalColor: 0xb9b3aa,
        fallbackColor: 0x8c8882,
        frame: 'parentRelative',
        relativeEphemeris: { kind: 'horizonsParentRelative' },
        relativeOrbitalElements: {
          semiMajorAxisAU: 0.000131017908,
          eccentricity: 0,
          inclinationRad: 0,
          ascendingNodeRad: 0,
          argPerihelionRad: 0,
          meanAnomalyAtEpochRad: 304.1 * D2R,
          epoch: new Date('2000-01-01T12:00:00Z'),
        },
        textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
        realData: {
          radiusKm: 606,
          distanceAU: 0.000131017908,
          orbitPeriodDays: 6.387222,
          orbitalInclination: 0,
          ascendingNode: 0,
          axialTilt: 0,
          massKg: 1.586e21,
          gravity: 0.288,
          meanTempC: -220,
          moonCount: 0,
          description: {
            en: "Pluto's largest moon, so massive that Pluto and Charon orbit a common barycenter.",
            fr: "La plus grande lune de Pluton, si massive que Pluton et Charon orbitent autour d'un barycentre commun.",
          },
          wiki: {
            en: 'https://en.wikipedia.org/wiki/Charon_(moon)',
            fr: 'https://fr.wikipedia.org/wiki/Charon_(lune)',
          },
        },
        cameraDistance: { educ: 0.8, explo: exploCameraDistance(606) },
        loadPriority: 12,
      },
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
    surfaceResolutions: ['4k', '2k', '1k'],
    visualRadius: 0.183,
    rotationHours: 25.9,
    axialTiltDeg: 78,
    massKg: 1.66e22,
    gravity: 0.82,
    meanTempC: -231,
    moonCount: 1,
    description: {
      en: 'More massive than Pluto. Its discovery in 2005 forced astronomers to define what a planet is, and cost Pluto its status. It roams up to three times farther from the Sun than Pluto.',
      fr: 'Plus massive que Pluton. Sa découverte en 2005 a forcé les astronomes à définir ce qu’est une planète, et a coûté son statut à Pluton. Elle s’éloigne jusqu’à trois fois plus loin du Soleil que Pluton.',
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
    surfaceResolutions: ['4k', '2k', '1k'],
    visualRadius: 0.123,
    rotationHours: 3.9155,
    axialTiltDeg: 126,
    massKg: 4.006e21,
    gravity: 0.44,
    meanTempC: -241,
    moonCount: 2,
    description: {
      en: 'It spins in under 4 hours, the fastest of any large body in the Solar System, which has stretched it into an egg shape. In 2017 it became the first trans-Neptunian object found to have a ring.',
      fr: 'Elle tourne sur elle-même en moins de 4 heures, un record parmi les grands corps du Système solaire, ce qui l’a étirée en forme d’œuf. En 2017, elle est devenue le premier objet transneptunien doté d’un anneau connu.',
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
    surfaceResolutions: ['4k', '2k', '1k'],
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
    color: 0xf08ac6,
    surfaceResolutions: ['4k', '2k'],
    kind: 'comet',
    description: {
      en: 'The most famous comet, visible from Earth about every 76 years, with its next return in 2061. It orbits backwards, against the flow of the planets.',
      fr: 'La plus célèbre des comètes, visible depuis la Terre tous les 76 ans environ, avec un prochain retour en 2061. Elle orbite à rebours, à contre-courant des planètes.',
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
