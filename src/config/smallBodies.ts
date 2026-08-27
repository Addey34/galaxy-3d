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
import { DEG_TO_RAD as D2R } from '@/core/MathConstants';

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
  /** Couleur de secours (0xRRGGBB) quand aucune texture de surface n'existe —
   *  requise par `catalogValidation` si `surfaceResolutions` est absent. */
  fallbackColor?: number;
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
    ...(el.fallbackColor !== undefined ? { fallbackColor: el.fallbackColor } : {}),
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
    // Éléments osculateurs JPL Horizons EXACTEMENT à cette époque (EPHEM_TYPE=ELEMENTS,
    // TLIST=2451545.0) — les anciennes valeurs plaçaient Vesta ~0.9 UA de sa vraie position
    // à cette date (vérifié contre le vecteur d'état Horizons réel).
    a: 2.361534934739072,
    e: 0.09002244561937413,
    iDeg: 7.133935828421654,
    omDeg: 103.9514370845001,
    wDeg: 149.5866679599199,
    maDeg: 341.0238343838706,
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
    // Éléments osculateurs JPL Horizons exactement à cette époque — voir le commentaire sur
    // Vesta ci-dessus (même correction, même méthode de vérification).
    a: 2.772322475089011,
    e: 0.2296435321697976,
    iDeg: 34.84614003622473,
    omDeg: 173.1977991340821,
    wDeg: 310.2656379003444,
    maDeg: 352.9602856167207,
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
    // Éléments osculateurs JPL Horizons exactement à cette époque — voir le commentaire sur
    // Vesta ci-dessus (même correction, même méthode de vérification).
    a: 3.138421324853723,
    e: 0.1194647926154634,
    iDeg: 3.842651449337091,
    omDeg: 283.6632054163321,
    wDeg: 314.3682343023398,
    maDeg: 339.2148139451292,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 217,
    color: 0x6fbf8a,
    surfaceResolutions: ['2k'],
    rotationHours: 13.83,
    axialTiltDeg: 0,
    massKg: 8.74e19,
    // g = GM/r² à partir de massKg/radiusKm ci-dessus (0,09 était ~27 % trop bas et
    // incohérent avec ces deux valeurs).
    gravity: 0.124,
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
      // Styx, Nix, Kerberos et Hydra n'ont volontairement PAS de `relativeOrbitalElements` :
      // un ajustement képlérien à deux corps sur une seule époque (JPL Horizons
      // EPHEM_TYPE=ELEMENTS, TLIST=2451545.0) donne pour ces quatre lunes des résultats
      // incohérents avec leurs périodes réelles publiées (écarts jusqu'à ×3.7 pour Kerberos) —
      // conséquence directe des forts couples gravitationnels du système binaire Pluton-Charon
      // qui rendent l'orbite osculatrice à un instant donné non représentative de l'orbite
      // moyenne réelle. Les propager en avant produirait une position silencieusement fausse.
      // Sans cet élément, `OrbitalMechanics` retombe sur `null` (corps non affiché) plutôt que
      // sur une position erronée si jamais le binaire `horizonsParentRelative` venait à manquer
      // — préférable à une fausse précision. Les champs `distanceAU`/`orbitPeriodDays` de
      // `realData` ci-dessous utilisent donc les valeurs moyennes réelles publiées (Showalter &
      // Hamilton 2015 / Porter et al. 2023), pas les éléments osculateurs Horizons.
      styx: {
        kind: 'moon',
        displayName: { en: 'Styx', fr: 'Styx' },
        radius: 0.04,
        // Rotation chaotique confirmée (pas de verrouillage marémoteur) — période
        // instantanée publiée à titre indicatif seulement, non un cycle fixe réel.
        rotationSpeed: (Math.PI * 2) / (3.24 * 24 * 3_600),
        orbitalColor: 0xcfd6d6,
        fallbackColor: 0xc4cbcb,
        frame: 'parentRelative',
        relativeEphemeris: { kind: 'horizonsParentRelative' },
        // Résolution New Horizons trop faible pour une vraie mosaïque (quelques pixels — voir
        // texture-sources.json). Texture procédurale générée : base claire, peu de cratères,
        // cohérente avec l'albédo élevé (>50 %) mesuré pour les 4 petites lunes de Pluton.
        textureResolutions: { surface: ['2k'] },
        realData: {
          radiusKm: 5.2,
          distanceAU: 2.8514e-4,
          orbitPeriodDays: 20.16,
          orbitalInclination: 0,
          ascendingNode: 0,
          axialTilt: 0,
          massKg: 4.494e15,
          gravity: 0.0111,
          meanTempC: -232,
          moonCount: 0,
          description: {
            en: 'The smallest and innermost of Pluto’s four small moons, tumbling chaotically under the combined pull of Pluto and Charon.',
            fr: 'La plus petite et la plus proche des quatre petites lunes de Pluton, en rotation chaotique sous l’attraction combinée de Pluton et Charon.',
          },
          wiki: {
            en: 'https://en.wikipedia.org/wiki/Styx_(moon)',
            fr: 'https://fr.wikipedia.org/wiki/Styx_(lune)',
          },
        },
        cameraDistance: { educ: 0.5, explo: exploCameraDistance(5.2) },
        loadPriority: 13,
      },
      nix: {
        kind: 'moon',
        displayName: { en: 'Nix', fr: 'Nix' },
        radius: 0.06,
        rotationSpeed: (Math.PI * 2) / (43.9 * 3_600),
        orbitalColor: 0xd8d3c9,
        fallbackColor: 0xcfc9bd,
        frame: 'parentRelative',
        relativeEphemeris: { kind: 'horizonsParentRelative' },
        // Texture procédurale générée : base claire + une tache rougeâtre isolée, paramétrée
        // sur la vraie tache rouge autour d'un cratère d'impact repérée par New Horizons
        // (Showalter et al. 2015 — voir texture-sources.json).
        textureResolutions: { surface: ['2k'] },
        realData: {
          radiusKm: 18,
          distanceAU: 3.2551e-4,
          orbitPeriodDays: 24.85,
          orbitalInclination: 0,
          ascendingNode: 0,
          axialTilt: 0,
          massKg: 2.247e16,
          gravity: 0.00463,
          meanTempC: -232,
          moonCount: 0,
          description: {
            en: 'A moon with a reddish crater on an otherwise bright icy surface, rotating chaotically and retrograde relative to its own orbit.',
            fr: 'Une lune marquée d’un cratère rougeâtre sur une surface glacée par ailleurs brillante, en rotation chaotique et rétrograde par rapport à sa propre orbite.',
          },
          wiki: {
            en: 'https://en.wikipedia.org/wiki/Nix_(moon)',
            fr: 'https://fr.wikipedia.org/wiki/Nix_(lune)',
          },
        },
        cameraDistance: { educ: 0.5, explo: exploCameraDistance(18) },
        loadPriority: 14,
      },
      kerberos: {
        kind: 'moon',
        displayName: { en: 'Kerberos', fr: 'Cerbère' },
        radius: 0.04,
        rotationSpeed: (Math.PI * 2) / (5.31 * 24 * 3_600),
        orbitalColor: 0xbfc4c4,
        fallbackColor: 0xb4baba,
        frame: 'parentRelative',
        relativeEphemeris: { kind: 'horizonsParentRelative' },
        // Résolution New Horizons trop faible pour une vraie mosaïque (voir
        // texture-sources.json). Texture procédurale générée, même traitement que ses 3
        // lunes sœurs (base claire, peu de cratères).
        textureResolutions: { surface: ['2k'] },
        realData: {
          radiusKm: 6,
          distanceAU: 3.8626e-4,
          orbitPeriodDays: 32.17,
          orbitalInclination: 0,
          ascendingNode: 0,
          axialTilt: 0,
          massKg: 2.996e15,
          gravity: 0.00556,
          meanTempC: -232,
          moonCount: 0,
          description: {
            en: 'A double-lobed moon, likely the fusion of two smaller bodies, rotating chaotically in the Pluto-Charon system.',
            fr: 'Une lune à double lobe, probablement issue de la fusion de deux corps plus petits, en rotation chaotique dans le système Pluton-Charon.',
          },
          wiki: {
            en: 'https://en.wikipedia.org/wiki/Kerberos_(moon)',
            fr: 'https://fr.wikipedia.org/wiki/Kerb%C3%A8ros_(lune)',
          },
        },
        cameraDistance: { educ: 0.5, explo: exploCameraDistance(6) },
        loadPriority: 15,
      },
      hydra: {
        kind: 'moon',
        displayName: { en: 'Hydra', fr: 'Hydre' },
        radius: 0.06,
        rotationSpeed: (Math.PI * 2) / (10 * 3_600),
        orbitalColor: 0xdcd8ce,
        fallbackColor: 0xd2cdc1,
        frame: 'parentRelative',
        relativeEphemeris: { kind: 'horizonsParentRelative' },
        // Résolution New Horizons trop faible pour une vraie mosaïque (voir
        // texture-sources.json). Texture procédurale générée, même traitement que ses 3
        // lunes sœurs (base claire, peu de cratères).
        textureResolutions: { surface: ['2k'] },
        realData: {
          radiusKm: 18.5,
          distanceAU: 4.3277e-4,
          orbitPeriodDays: 38.2,
          orbitalInclination: 0,
          ascendingNode: 0,
          axialTilt: 0,
          massKg: 2.996e16,
          gravity: 0.00584,
          meanTempC: -250,
          moonCount: 0,
          description: {
            en: "Pluto's outermost known moon, the fastest tumbler of the small moons, spinning once roughly every 10 hours.",
            fr: 'La plus lointaine lune connue de Pluton, celle qui tourne le plus vite parmi les petites lunes, bouclant un tour environ toutes les 10 heures.',
          },
          wiki: {
            en: 'https://en.wikipedia.org/wiki/Hydra_(moon)',
            fr: 'https://fr.wikipedia.org/wiki/Hydre_(lune)',
          },
        },
        cameraDistance: { educ: 0.5, explo: exploCameraDistance(18.5) },
        loadPriority: 16,
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
    // g = GM/r² à partir de massKg/radiusKm ci-dessus (0,5 était incohérent : ~24 % trop haut,
    // vraisemblablement une estimation de masse pré-découverte de la lune MK2 en 2016, jamais
    // reconciliée avec la masse mise à jour).
    gravity: 0.405,
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
    name: 'orcus',
    displayName: { en: 'Orcus', fr: 'Orcus' },
    // Éléments osculateurs JPL Horizons exactement à cette époque — même méthode que
    // Vesta/Pallas/Hygiea/Halley ci-dessus (EPHEM_TYPE=ELEMENTS, TLIST=2451545.0).
    a: 39.26252228984306,
    e: 0.225751142405386,
    iDeg: 20.53929449722906,
    omDeg: 268.4572431140700,
    wDeg: 73.75098677536380,
    maDeg: 150.0400595978003,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 458,
    kind: 'dwarf',
    color: 0xcbc7c0,
    surfaceResolutions: ['2k'],
    fallbackColor: 0xcbc7c0,
    visualRadius: 0.072,
    // Rotation possiblement verrouillée sur l'orbite de sa lune Vanth (9,5393 j) — les études
    // photométriques directes sont non concluantes (Orcus est vu quasi pôle-sur, ce qui aplatit
    // sa courbe de lumière) mais l'hypothèse de synchronisation mutuelle est la mieux étayée.
    rotationHours: 9.5393 * 24,
    massKg: 5.478e20,
    gravity: 0.174,
    meanTempC: -228,
    moonCount: 1,
    description: {
      en: "Sometimes nicknamed the \"anti-Pluto\" for an orbit that mirrors Pluto's own 2:3 resonance with Neptune, timed so the two are never close together. Its large moon Vanth may be tidally locked to it, much like Charon is to Pluto.",
      fr: "Parfois surnommée « anti-Pluton » pour une orbite qui reflète la même résonance 2:3 avec Neptune que Pluton, mais synchronisée pour que les deux ne soient jamais proches. Sa grande lune Vanth serait verrouillée gravitationnellement, un peu comme Charon l’est à Pluton.",
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Orcus_(dwarf_planet)',
      fr: 'https://fr.wikipedia.org/wiki/(90482)_Orcus',
    },
  },
  {
    name: 'quaoar',
    displayName: { en: 'Quaoar', fr: 'Quaoar' },
    // Éléments osculateurs JPL Horizons exactement à cette époque — voir le commentaire sur
    // Vesta ci-dessus (même méthode de vérification).
    a: 43.13300737717343,
    e: 0.03951007383606750,
    iDeg: 8.005089469375157,
    omDeg: 189.0799904468402,
    wDeg: 163.7854906986470,
    maDeg: 258.9555093443548,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 549,
    kind: 'dwarf',
    color: 0x9c8873,
    surfaceResolutions: ['2k'],
    fallbackColor: 0x9c8873,
    visualRadius: 0.086,
    rotationHours: 8.84,
    massKg: 1.212e21,
    gravity: 0.27,
    meanTempC: -229,
    moonCount: 1,
    description: {
      en: 'A large Kuiper Belt object that surprised astronomers in 2023 with a system of rings orbiting far beyond the distance where rings should be stable — its moon Weywot may be responsible for keeping them from collapsing.',
      fr: 'Un grand objet de la ceinture de Kuiper qui a surpris les astronomes en 2023 : un système d’anneaux en orbite bien au-delà de la distance où des anneaux sont censés rester stables — sa lune Weywot pourrait les empêcher de s’effondrer.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Quaoar',
      fr: 'https://fr.wikipedia.org/wiki/(50000)_Quaoar',
    },
  },
  {
    name: 'gonggong',
    displayName: { en: 'Gonggong', fr: 'Gonggong' },
    // Éléments osculateurs JPL Horizons exactement à cette époque — voir le commentaire sur
    // Vesta ci-dessus (même méthode de vérification).
    a: 67.05125643630976,
    e: 0.4995734299445327,
    iDeg: 30.71460943458106,
    omDeg: 336.8754145198811,
    wDeg: 206.9409316772891,
    maDeg: 94.20389141650462,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 615,
    kind: 'dwarf',
    color: 0xc25a3f,
    surfaceResolutions: ['2k'],
    fallbackColor: 0xc25a3f,
    visualRadius: 0.097,
    rotationHours: 22.4,
    massKg: 1.75e21,
    gravity: 0.31,
    meanTempC: -235,
    moonCount: 1,
    description: {
      en: 'Named after the Chinese god of water and chaos, this reddish, methane-frosted world spins nearly on its side and shares a steeply tilted, eccentric orbit with its lone moon Xiangliu.',
      fr: 'Nommée d’après le dieu chinois de l’eau et du chaos, ce monde rougeâtre couvert de givre de méthane tourne presque couché sur le côté et partage une orbite très inclinée et excentrique avec son unique lune Xiangliu.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Gonggong_(dwarf_planet)',
      fr: 'https://fr.wikipedia.org/wiki/(225088)_Gonggong',
    },
  },
  {
    name: 'sedna',
    displayName: { en: 'Sedna', fr: 'Sedna' },
    // Éléments osculateurs JPL Horizons exactement à cette époque — voir le commentaire sur
    // Vesta ci-dessus (même méthode de vérification).
    a: 549.8732686054069,
    e: 0.8609804671093849,
    iDeg: 11.92524941582647,
    omDeg: 144.3169286137796,
    wDeg: 310.7328635633867,
    maDeg: 357.9014766680082,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 498,
    kind: 'dwarf',
    color: 0xb84a3a,
    surfaceResolutions: ['2k'],
    fallbackColor: 0xb84a3a,
    visualRadius: 0.078,
    rotationHours: 10.273,
    // Masse estimée à partir de sa taille et d'une densité type objet glacé — sans lune connue,
    // sa masse ne peut pas être mesurée directement (aucune sonde ne l'a visitée).
    massKg: 8.3e20,
    gravity: 0.22,
    meanTempC: -240,
    moonCount: 0,
    description: {
      en: 'One of the most distant and coldest known objects in the Solar System, journeying on an extremely elongated, multi-millennial orbit that carries it beyond the Kuiper Belt toward the inner edge of the hypothesized Oort Cloud.',
      fr: 'L’un des objets connus les plus lointains et les plus froids du Système solaire, parcourant une orbite extrêmement allongée, longue de plusieurs millénaires, qui l’entraîne au-delà de la ceinture de Kuiper vers les abords du nuage d’Oort hypothétique.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Sedna_(dwarf_planet)',
      fr: 'https://fr.wikipedia.org/wiki/(90377)_Sedna',
    },
  },
  {
    name: 'halley',
    // Éléments osculateurs JPL Horizons EXACTEMENT à cette époque (record 90000030, apparition
    // 1986 ; EPHEM_TYPE=ELEMENTS, TLIST=2451545.0). L'ancienne maDeg=38.38° était fausse pour
    // cette époque : vérifié en propageant jusqu'à la vraie date de périhélie 1986-02-09, ce qui
    // plaçait la comète à ~15.5 UA du Soleil au lieu de ~0.575 UA (son q réel).
    a: 17.9215074123436,
    e: 0.967270202449048,
    iDeg: 162.1960426230816,
    omDeg: 59.5078653556394,
    wDeg: 112.449622028568,
    maDeg: 65.84890057257185,
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
