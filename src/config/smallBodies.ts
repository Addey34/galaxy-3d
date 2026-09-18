/**
 * Dataset des petits corps — séparé du catalogue curé des planètes (`bodies.ts`).
 *
 * Astronomy Engine ne fournit pas d'éphéméride pour les astéroïdes, comètes, géocroiseurs
 * et planètes naines : ils sont positionnés par leurs éléments orbitaux képlériens
 * (cf. `core/kepler.ts`). Ce module tient les données brutes dans les unités publiées par
 * les astronomes (JPL Small-Body Database, Minor Planet Center — degrés + UA) et un
 * convertisseur pur `smallBodyToConfig` vers le format catalogue.
 *
 * Les corps ci-dessous sont un socle curé de corps notables. Chaque jeu d'éléments est
 * l'osculateur JPL Horizons EXACTEMENT à son époque déclarée, dérivé par
 * `pnpm ephemeris:small-body` et jamais recopié à la main : `smallBodies.test.ts` compare
 * chacun à un vecteur d'état Horizons à cette époque. Loin de l'époque, un modèle à deux
 * corps dérive (perturbations planétaires) : c'est une limite du modèle, pas des éléments.
 * À l'échelle de milliers de corps, alimenter ce même convertisseur depuis un JSON streamé.
 */
import { Body } from 'astronomy-engine';
import type { CelestialBodyConfig } from '@/types';
import { exploCameraDistance } from '@/core/ScaleService';
import { DEG_TO_RAD as D2R } from '@/core/MathConstants';
import { smallBodyToConfig, type SmallBodyElements } from './smallBodyConfig';
export { smallBodyToConfig, type SmallBodyElements } from './smallBodyConfig';
import {
  DETAIL,
  NOT_YET_SOURCED,
  derived,
  gravityFromGM,
  gravityFromMass,
  kmToAu,
  massFromDensity,
  massFromGM,
  measured,
} from './factSources';

/**
 * Socle curé de petits corps notables (éléments osculateurs Horizons à l'époque de chacun).
 * Halley est rétrograde (i > 90°) : la propagation képlérienne le gère nativement.
 */
export const SMALL_BODY_ELEMENTS: readonly SmallBodyElements[] = [
  {
    name: 'ceres',
    displayName: { fr: 'Cérès' },
    // Éléments osculateurs JPL Horizons EXACTEMENT à cette époque (COMMAND '1;',
    // EPHEM_TYPE=ELEMENTS, TLIST=2451545.0), par `pnpm ephemeris:small-body`. Les valeurs
    // recopiées à la main plaçaient le corps loin de sa position dès l'époque (cf. test).
    a: 2.766496019994375,
    e: 0.0783756264716304,
    iDeg: 10.58336045805628,
    omDeg: 80.49435747295276,
    wDeg: 73.92286274285223,
    maDeg: 6.176654513180486,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 939.4 / 2,
    kind: 'dwarf',
    color: 0xc5a46d,
    surfaceResolutions: ['4k', '2k', '1k'],
    visualRadius: 0.1,
    rotationHours: 9.07417,
    axialTiltDeg: 4.0,
    massKg: massFromGM(62.6284),
    gravity: gravityFromGM(62.6284, 939.4 / 2),
    moonCount: 0,
    sources: {
      radiusKm: derived('jpl-sbdb', {
        detail: DETAIL.radiusFromDiameter,
        citation: 'Nature vol. 537, pp515-517 (22 September 2016)',
        uncertainty: 0.1,
      }),
      massKg: derived('jpl-sbdb', {
        detail: DETAIL.massFromGM,
        citation: 'Nature vol. 537, pp515-517 (22 September 2016)',
        uncertainty: massFromGM(0.0009),
      }),
      gravity: derived('jpl-sbdb', {
        detail: DETAIL.gravityFromGM,
        citation: 'Nature vol. 537, pp515-517 (22 September 2016)',
      }),
      rotationPeriod: measured('jpl-sbdb', {
        citation: 'Nature vol. 537, pp515-517 (22 September 2016)',
      }),
      axialTilt: derived('jpl-sbdb', {
        detail: DETAIL.obliquityFromPole,
        citation: 'Nature vol. 537, pp515-517 (22 September 2016)',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      meanTempC: NOT_YET_SOURCED,
    },
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
    radiusKm: 522.77 / 2,
    color: 0xc8795d,
    surfaceResolutions: ['8k', '4k', '2k', '1k'],
    rotationHours: 5.3421276322,
    axialTiltDeg: 27.5,
    massKg: massFromGM(17.2882844),
    gravity: gravityFromGM(17.2882844, 522.77 / 2),
    moonCount: 0,
    sources: {
      radiusKm: derived('jpl-sbdb', {
        detail: DETAIL.radiusFromDiameter,
        citation:
          'Park, R.S. et al. 2025, Nat Astron, DOI: 10.1038/s41550-025-02533-7',
        uncertainty: 0.05,
      }),
      massKg: derived('jpl-sbdb', {
        detail: DETAIL.massFromGM,
        citation:
          'Park, R.S. et al. 2025, Nat Astron, DOI: 10.1038/s41550-025-02533-7',
        uncertainty: massFromGM(3e-6),
      }),
      gravity: derived('jpl-sbdb', {
        detail: DETAIL.gravityFromGM,
        citation:
          'Park, R.S. et al. 2025, Nat Astron, DOI: 10.1038/s41550-025-02533-7',
      }),
      rotationPeriod: measured('jpl-sbdb', {
        citation:
          'Park, R.S. et al. 2025, Nat Astron, DOI: 10.1038/s41550-025-02533-7',
      }),
      axialTilt: derived('jpl-sbdb', {
        detail: DETAIL.obliquityFromPole,
        citation:
          'Park, R.S. et al. 2025, Nat Astron, DOI: 10.1038/s41550-025-02533-7',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      meanTempC: NOT_YET_SOURCED,
    },
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
    radiusKm: 513 / 2,
    color: 0x9b82d1,
    surfaceResolutions: ['2k'],
    rotationHours: 7.8132214,
    axialTiltDeg: 83.6,
    massKg: massFromGM(13.63),
    gravity: gravityFromGM(13.63, 513 / 2),
    moonCount: 0,
    sources: {
      radiusKm: derived('jpl-sbdb', {
        detail: DETAIL.radiusFromDiameter,
        citation: 'Marsset et al., Nature Astronomy 4, 569-576 (2020)',
        uncertainty: 3,
      }),
      massKg: derived('jpl-sbdb', {
        detail: DETAIL.massFromGM,
        citation: 'Vernazza et al., A&A 654, A56 (2021)',
        uncertainty: massFromGM(0.18),
      }),
      gravity: derived('jpl-sbdb', {
        detail: DETAIL.gravityFromGM,
        citation: 'Vernazza et al., A&A 654, A56 (2021)',
      }),
      rotationPeriod: measured('jpl-sbdb', {
        citation: 'Carry et al., Icarus 205, 460-472 (2010)',
      }),
      axialTilt: derived('jpl-sbdb', {
        detail: DETAIL.obliquityFromPole,
        citation: 'Carry et al., Icarus 205, 460-472 (2010)',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      meanTempC: NOT_YET_SOURCED,
    },
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
    radiusKm: 407.12 / 2,
    color: 0x6fbf8a,
    surfaceResolutions: ['2k'],
    rotationHours: 13.828,
    massKg: massFromGM(7),
    // Valeurs de la SBDB, qui cite encore IRAS pour le diamètre et Scholl et al. (1987) pour
    // GM, sans incertitude : la fiche nomme donc ces références d'origine.
    gravity: gravityFromGM(7, 407.12 / 2),
    moonCount: 0,
    sources: {
      radiusKm: derived('jpl-sbdb', {
        detail: DETAIL.radiusFromDiameter,
        citation: 'IRAS-A-FPA-3-RDR-IMPS-V6.0',
        uncertainty: 3.4,
      }),
      massKg: derived('jpl-sbdb', {
        detail: DETAIL.massFromGM,
        citation: 'Scholl et al., A&A, v.179, p.311, 1987',
      }),
      gravity: derived('jpl-sbdb', {
        detail: DETAIL.gravityFromGM,
        citation: 'Scholl et al., A&A, v.179, p.311, 1987',
      }),
      rotationPeriod: measured('jpl-sbdb', {
        citation: 'LCDB (Rev. 2023-October); Warner et al., 2009',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      meanTempC: NOT_YET_SOURCED,
    },
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
    // Éléments osculateurs JPL Horizons BARYCENTRIQUES exactement à cette époque (COMMAND
    // '9', CENTER=500@0, TLIST=2451545.0), par `pnpm ephemeris:small-body --center 500@0`.
    // Barycentriques car mesuré meilleur au-delà de Neptune (cf. `OrbitalElements.barycentric`).
    // Cible '9' = barycentre du système Pluton-Charon, pas le centre de Pluton, qui en fait
    // le tour en 6,4 j : cette oscillation (~24 m/s) fausse l'osculateur comme le réflexe
    // solaire (mesuré sur 1900-2100 : 5,5e7 km d'erreur moyenne avec '999', 4,7e5 avec '9').
    a: 39.48741550384992,
    e: 0.2489763560923634,
    iDeg: 17.14055930776762,
    omDeg: 110.3012538561415,
    wDeg: 113.7774660018993,
    maDeg: 14.84874908032896,
    epoch: '2000-01-01T12:00:00Z',
    barycentric: true,
    radiusKm: 1188,
    kind: 'dwarf',
    color: 0xd8b894,
    surfaceResolutions: ['8k', '4k', '2k', '1k'],
    visualRadius: 0.188,
    rotationHours: 153.2928,
    axialTiltDeg: 119.51,
    rotationBody: Body.Pluto,
    massKg: 1.303e22,
    gravity: 0.62,
    meanTempC: -225,
    moonCount: 5,
    sources: {
      radiusKm: measured('nssdca-fact-sheets'),
      massKg: measured('nssdca-fact-sheets'),
      gravity: measured('nssdca-fact-sheets'),
      meanTempC: measured('nssdca-fact-sheets'),
      rotationPeriod: measured('nssdca-fact-sheets'),
      axialTilt: measured('nssdca-fact-sheets'),
      moonCount: measured('nssdca-fact-sheets', { asOf: '2024-01-11' }),
    },
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
        rotationSpeed: (Math.PI * 2) / (6.38722209972658 * 86_400),
        orbitalColor: 0xb9b3aa,
        fallbackColor: 0x8c8882,
        frame: 'parentRelative',
        rotationBody: Body.Pluto,
        relativeEphemeris: { kind: 'horizonsParentRelative' },
        relativeOrbitalElements: {
          semiMajorAxisAU: 0.0001309776734,
          eccentricity: 8.03236e-5,
          inclinationRad: 112.8878 * D2R,
          ascendingNodeRad: 227.393 * D2R,
          argPerihelionRad: 150.543 * D2R,
          meanAnomalyAtEpochRad: 41.117 * D2R,
          epoch: new Date('2025-12-31T00:00:00.000Z'),
        },
        textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
        realData: {
          sources: {
            radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
              uncertainty: 0.5,
            }),
            distanceAU: measured('jpl-ssd-satellite-mean-elements'),
            orbitPeriodDays: measured('nssdca-fact-sheets'),
            massKg: derived('jpl-ssd-satellite-physical-parameters', {
              detail: DETAIL.massFromGM,
              uncertainty: massFromGM(0.3),
            }),
            gravity: derived('jpl-ssd-satellite-physical-parameters', {
              detail: DETAIL.gravityFromGM,
            }),
            rotationPeriod: measured('nssdca-fact-sheets'),
          },
          unknown: {
            meanTempC: NOT_YET_SOURCED,
            axialTilt: NOT_YET_SOURCED,
          },
          radiusKm: 606,
          distanceAU: kmToAu(19_600),
          orbitPeriodDays: 6.38722209972658,
          orbitalInclination: 0,
          ascendingNode: 0,
          axialTilt: 0,
          massKg: massFromGM(106.1),
          gravity: gravityFromGM(106.1, 606),
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
      // `realData` ci-dessous utilisent donc les valeurs MOYENNES de la table JPL SSD des éléments
      // de satellites (`sources`), pas les éléments osculateurs Horizons.
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
        rotationBody: Body.Pluto,
        // Elements MOYENS, mesures sur le binaire (cf. scripts/derive-relative-elements.mjs
        // --mean). Les elements OSCULATEURS sont ici aberrants : cette lune orbite le
        // barycentre Pluton-Charon, et Pluton oscille de 2 100 km autour de ce point, si
        // bien que l'etat instantane decrit une conique qui n'existe pas (Styx : periode
        // osculatrice 47 j pour 20,2 j reels). Le plan et le rayon sont donc moyennes sur
        // 400 jours, ou le ballant se compense ; la periode vient du catalogue.
        // Precision attendue : de l'ordre du ballant residuel, quelques pour cent.
        relativeOrbitalElements: {
          semiMajorAxisAU: 0.0002837055114,
          eccentricity: 0,
          inclinationRad: 112.8548 * D2R,
          ascendingNodeRad: 227.3768 * D2R,
          argPerihelionRad: 0,
          meanAnomalyAtEpochRad: 194.2283 * D2R,
          epoch: new Date('2025-12-31T00:00:00.000Z'),
        },
        relativeEphemeris: { kind: 'horizonsParentRelative' },
        // Résolution New Horizons trop faible pour une vraie mosaïque (quelques pixels — voir
        // registry/products/textures). Texture procédurale générée : base claire, peu de cratères,
        // cohérente avec l'albédo élevé (>50 %) mesuré pour les 4 petites lunes de Pluton.
        textureResolutions: { surface: ['2k'] },
        realData: {
          sources: {
            radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
              uncertainty: 1,
            }),
            distanceAU: measured('jpl-ssd-satellite-mean-elements'),
            orbitPeriodDays: measured('jpl-ssd-satellite-mean-elements'),
          },
          unknown: {
            meanTempC: NOT_YET_SOURCED,
            axialTilt: NOT_YET_SOURCED,
            rotationPeriod: NOT_YET_SOURCED,
            massKg: {
              en: 'Only an upper limit to its mass has been published (Porter et al. 2023, from Hubble and New Horizons astrometry), not a measured value.',
              fr: 'Seule une limite supérieure de sa masse a été publiée (Porter et al. 2023, astrométrie Hubble et New Horizons), pas une valeur mesurée.',
            },
            gravity: {
              en: 'No measured mass has been published, only an upper limit (Porter et al. 2023), so no surface gravity can be derived.',
              fr: 'Aucune masse mesurée n’a été publiée, seulement une limite supérieure (Porter et al. 2023) : aucune gravité de surface ne peut en être dérivée.',
            },
          },
          radiusKm: 5.2,
          distanceAU: kmToAu(43_200),
          orbitPeriodDays: 20.16188738471113,
          orbitalInclination: 0,
          ascendingNode: 0,
          axialTilt: 0,
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
        rotationBody: Body.Pluto,
        // Elements MOYENS, mesures sur le binaire (cf. scripts/derive-relative-elements.mjs
        // --mean). Les elements OSCULATEURS sont ici aberrants : cette lune orbite le
        // barycentre Pluton-Charon, et Pluton oscille de 2 100 km autour de ce point, si
        // bien que l'etat instantane decrit une conique qui n'existe pas (Styx : periode
        // osculatrice 47 j pour 20,2 j reels). Le plan et le rayon sont donc moyennes sur
        // 400 jours, ou le ballant se compense ; la periode vient du catalogue.
        // Precision attendue : de l'ordre du ballant residuel, quelques pour cent.
        relativeOrbitalElements: {
          semiMajorAxisAU: 0.0003256427173,
          eccentricity: 0,
          inclinationRad: 112.8719 * D2R,
          ascendingNodeRad: 227.3803 * D2R,
          argPerihelionRad: 0,
          meanAnomalyAtEpochRad: 125.705 * D2R,
          epoch: new Date('2025-12-31T00:00:00.000Z'),
        },
        relativeEphemeris: { kind: 'horizonsParentRelative' },
        // Texture procédurale générée : base claire + une tache rougeâtre isolée, paramétrée
        // sur la vraie tache rouge autour d'un cratère d'impact repérée par New Horizons
        // (Showalter et al. 2015 — voir registry/products/textures).
        textureResolutions: { surface: ['2k'] },
        realData: {
          sources: {
            radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
              uncertainty: 1,
            }),
            distanceAU: measured('jpl-ssd-satellite-mean-elements'),
            orbitPeriodDays: measured('jpl-ssd-satellite-mean-elements'),
            massKg: derived('jpl-ssd-satellite-physical-parameters', {
              detail: DETAIL.massFromGM,
              uncertainty: massFromGM(0.0005),
            }),
            gravity: derived('jpl-ssd-satellite-physical-parameters', {
              detail: DETAIL.gravityFromGM,
            }),
          },
          unknown: {
            meanTempC: NOT_YET_SOURCED,
            axialTilt: NOT_YET_SOURCED,
            rotationPeriod: NOT_YET_SOURCED,
          },
          radiusKm: 18,
          distanceAU: kmToAu(49_300),
          orbitPeriodDays: 24.85465798523317,
          orbitalInclination: 0,
          ascendingNode: 0,
          axialTilt: 0,
          massKg: massFromGM(0.0015),
          gravity: gravityFromGM(0.0015, 18),
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
        rotationBody: Body.Pluto,
        // Elements MOYENS, mesures sur le binaire (cf. scripts/derive-relative-elements.mjs
        // --mean). Les elements OSCULATEURS sont ici aberrants : cette lune orbite le
        // barycentre Pluton-Charon, et Pluton oscille de 2 100 km autour de ce point, si
        // bien que l'etat instantane decrit une conique qui n'existe pas (Styx : periode
        // osculatrice 47 j pour 20,2 j reels). Le plan et le rayon sont donc moyennes sur
        // 400 jours, ou le ballant se compense ; la periode vient du catalogue.
        // Precision attendue : de l'ordre du ballant residuel, quelques pour cent.
        relativeOrbitalElements: {
          semiMajorAxisAU: 0.0003860530818,
          eccentricity: 0,
          inclinationRad: 113.2981 * D2R,
          ascendingNodeRad: 227.3586 * D2R,
          argPerihelionRad: 0,
          meanAnomalyAtEpochRad: 350.4908 * D2R,
          epoch: new Date('2025-12-31T00:00:00.000Z'),
        },
        relativeEphemeris: { kind: 'horizonsParentRelative' },
        // Résolution New Horizons trop faible pour une vraie mosaïque (voir
        // registry/products/textures). Texture procédurale générée, même traitement que ses 3
        // lunes sœurs (base claire, peu de cratères).
        textureResolutions: { surface: ['2k'] },
        realData: {
          sources: {
            radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
              uncertainty: 1,
            }),
            distanceAU: measured('jpl-ssd-satellite-mean-elements'),
            orbitPeriodDays: measured('jpl-ssd-satellite-mean-elements'),
          },
          unknown: {
            meanTempC: NOT_YET_SOURCED,
            axialTilt: NOT_YET_SOURCED,
            rotationPeriod: NOT_YET_SOURCED,
            massKg: {
              en: 'Only an upper limit to its mass has been published (Porter et al. 2023, from Hubble and New Horizons astrometry), not a measured value.',
              fr: 'Seule une limite supérieure de sa masse a été publiée (Porter et al. 2023, astrométrie Hubble et New Horizons), pas une valeur mesurée.',
            },
            gravity: {
              en: 'No measured mass has been published, only an upper limit (Porter et al. 2023), so no surface gravity can be derived.',
              fr: 'Aucune masse mesurée n’a été publiée, seulement une limite supérieure (Porter et al. 2023) : aucune gravité de surface ne peut en être dérivée.',
            },
          },
          radiusKm: 6,
          distanceAU: kmToAu(58_300),
          orbitPeriodDays: 32.16803411478301,
          orbitalInclination: 0,
          ascendingNode: 0,
          axialTilt: 0,
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
        rotationBody: Body.Pluto,
        // Elements MOYENS, mesures sur le binaire (cf. scripts/derive-relative-elements.mjs
        // --mean). Les elements OSCULATEURS sont ici aberrants : cette lune orbite le
        // barycentre Pluton-Charon, et Pluton oscille de 2 100 km autour de ce point, si
        // bien que l'etat instantane decrit une conique qui n'existe pas (Styx : periode
        // osculatrice 47 j pour 20,2 j reels). Le plan et le rayon sont donc moyennes sur
        // 400 jours, ou le ballant se compense ; la periode vient du catalogue.
        // Precision attendue : de l'ordre du ballant residuel, quelques pour cent.
        relativeOrbitalElements: {
          semiMajorAxisAU: 0.0004327871245,
          eccentricity: 0,
          inclinationRad: 112.6164 * D2R,
          ascendingNodeRad: 227.4572 * D2R,
          argPerihelionRad: 0,
          meanAnomalyAtEpochRad: 93.1374 * D2R,
          epoch: new Date('2025-12-31T00:00:00.000Z'),
        },
        relativeEphemeris: { kind: 'horizonsParentRelative' },
        // Résolution New Horizons trop faible pour une vraie mosaïque (voir
        // registry/products/textures). Texture procédurale générée, même traitement que ses 3
        // lunes sœurs (base claire, peu de cratères).
        textureResolutions: { surface: ['2k'] },
        realData: {
          sources: {
            radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
              uncertainty: 1,
            }),
            distanceAU: measured('jpl-ssd-satellite-mean-elements'),
            orbitPeriodDays: measured('jpl-ssd-satellite-mean-elements'),
            massKg: derived('jpl-ssd-satellite-physical-parameters', {
              detail: DETAIL.massFromGM,
              uncertainty: massFromGM(0.0003),
            }),
            gravity: derived('jpl-ssd-satellite-physical-parameters', {
              detail: DETAIL.gravityFromGM,
            }),
          },
          unknown: {
            meanTempC: NOT_YET_SOURCED,
            axialTilt: NOT_YET_SOURCED,
            rotationPeriod: NOT_YET_SOURCED,
          },
          radiusKm: 18.5,
          distanceAU: kmToAu(65_200),
          orbitPeriodDays: 38.20192500649081,
          orbitalInclination: 0,
          ascendingNode: 0,
          axialTilt: 0,
          massKg: massFromGM(0.002),
          gravity: gravityFromGM(0.002, 18.5),
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
    // Éléments osculateurs JPL Horizons BARYCENTRIQUES exactement à cette époque (COMMAND
    // '136199;', CENTER=500@0, TLIST=2451545.0), par `pnpm ephemeris:small-body --center 500@0`.
    // Barycentriques car mesuré meilleur au-delà de Neptune (cf. `OrbitalElements.barycentric`).
    a: 67.83513506437887,
    e: 0.4384299959852953,
    iDeg: 43.99285596415268,
    omDeg: 35.9765290736987,
    wDeg: 151.2211963180349,
    maDeg: 193.8429965779992,
    epoch: '2000-01-01T12:00:00Z',
    barycentric: true,
    radiusKm: 1163,
    kind: 'dwarf',
    color: 0x91bce6,
    surfaceResolutions: ['4k', '2k', '1k'],
    visualRadius: 0.183,
    rotationHours: 15.8 * 24,
    axialTiltDeg: 78,
    massKg: massFromDensity(2.52, 1163),
    gravity: gravityFromMass(massFromDensity(2.52, 1163), 1163),
    moonCount: 1,
    sources: {
      radiusKm: measured('sicardy-2011-eris', { uncertainty: 6 }),
      massKg: derived('sicardy-2011-eris', { detail: DETAIL.massFromDensity }),
      gravity: derived('sicardy-2011-eris', { detail: DETAIL.gravityFromMass }),
      rotationPeriod: measured('szakats-2023-eris', {
        detail: DETAIL.synchronousRotation,
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      meanTempC: NOT_YET_SOURCED,
      axialTilt: NOT_YET_SOURCED,
    },
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
    // Éléments osculateurs JPL Horizons BARYCENTRIQUES exactement à cette époque (COMMAND
    // '136108;', CENTER=500@0, TLIST=2451545.0), par `pnpm ephemeris:small-body --center 500@0`.
    // Barycentriques car mesuré meilleur au-delà de Neptune (cf. `OrbitalElements.barycentric`).
    a: 43.10286749752674,
    e: 0.1950094391276499,
    iDeg: 28.20492617114719,
    omDeg: 121.9476444856607,
    wDeg: 239.9472445347778,
    maDeg: 190.4250671251033,
    epoch: '2000-01-01T12:00:00Z',
    barycentric: true,
    radiusKm: 780,
    kind: 'dwarf',
    color: 0xe58f7a,
    surfaceResolutions: ['4k', '2k', '1k'],
    visualRadius: 0.123,
    rotationHours: 3.9154,
    axialTiltDeg: 126,
    massKg: 4.006e21,
    gravity: 0.44,
    moonCount: 2,
    sources: {
      massKg: measured('ragozzine-brown-2009-haumea', { uncertainty: 0.04e21 }),
      rotationPeriod: measured('jpl-sbdb', {
        citation: 'LCDB (Rev. 2023-October); Warner et al., 2009',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      radiusKm: NOT_YET_SOURCED,
      gravity: NOT_YET_SOURCED,
      meanTempC: NOT_YET_SOURCED,
      axialTilt: NOT_YET_SOURCED,
    },
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
    // Éléments osculateurs JPL Horizons BARYCENTRIQUES exactement à cette époque (COMMAND
    // '136472;', CENTER=500@0, TLIST=2451545.0), par `pnpm ephemeris:small-body --center 500@0`.
    // Barycentriques car mesuré meilleur au-delà de Neptune (cf. `OrbitalElements.barycentric`).
    a: 45.4988931027048,
    e: 0.1603866278527415,
    iDeg: 29.00199283692018,
    omDeg: 79.44279338452822,
    wDeg: 296.0688272466675,
    maDeg: 140.1042105425099,
    epoch: '2000-01-01T12:00:00Z',
    barycentric: true,
    radiusKm: 1434 / 2,
    kind: 'dwarf',
    color: 0xd78352,
    surfaceResolutions: ['4k', '2k', '1k'],
    visualRadius: 0.112,
    rotationHours: 22.8266,
    massKg: 3.1e21,
    // Masse et gravité gardées pour la simulation mais NON publiées (`unknown`) : aucune source
    // primaire rattachée. L'orbite préliminaire de MK2 (Bamberger 2025, prépublication à un seul
    // auteur) donnerait ~2,7e21 kg, pas 3,1e21 : raison de plus pour ne rien afficher.
    gravity: 0.405,
    moonCount: 1,
    sources: {
      radiusKm: derived('brown-2013-makemake', {
        detail: DETAIL.equatorialRadiusFromDiameter,
        uncertainty: 7,
      }),
      rotationPeriod: measured('jpl-sbdb', {
        detail: DETAIL.partialLightcurve,
        citation: 'LCDB (Rev. 2023-October); Warner et al., 2009',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      massKg: NOT_YET_SOURCED,
      gravity: NOT_YET_SOURCED,
      meanTempC: NOT_YET_SOURCED,
    },
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
    // Éléments osculateurs JPL Horizons BARYCENTRIQUES exactement à cette époque (COMMAND
    // '90482;', CENTER=500@0, TLIST=2451545.0), par `pnpm ephemeris:small-body --center 500@0`.
    // Barycentriques car mesuré meilleur au-delà de Neptune (cf. `OrbitalElements.barycentric`).
    a: 39.2798751411889,
    e: 0.2238491715385574,
    iDeg: 20.56780730671753,
    omDeg: 268.5849268277011,
    wDeg: 73.02643860598275,
    maDeg: 151.0542756150432,
    epoch: '2000-01-01T12:00:00Z',
    barycentric: true,
    radiusKm: 458,
    kind: 'dwarf',
    color: 0xcbc7c0,
    surfaceResolutions: ['2k'],
    fallbackColor: 0xcbc7c0,
    visualRadius: 0.072,
    // Période de la base LCDB citée par la SBDB, que la source signale comme fondée sur une
    // couverture incomplète. Le catalogue portait 9,5393 j (synchronisation supposée avec
    // Vanth) : une hypothèse, pas une mesure publiée, remplacée par la valeur sourcée.
    rotationHours: 13.188,
    massKg: 5.478e20,
    gravity: 0.174,
    moonCount: 1,
    sources: {
      rotationPeriod: measured('jpl-sbdb', {
        detail: DETAIL.partialLightcurve,
        citation: 'LCDB (Rev. 2023-October); Warner et al., 2009',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      radiusKm: NOT_YET_SOURCED,
      massKg: NOT_YET_SOURCED,
      gravity: NOT_YET_SOURCED,
      meanTempC: NOT_YET_SOURCED,
    },
    description: {
      en: 'Sometimes nicknamed the "anti-Pluto" for an orbit that mirrors Pluto\'s own 2:3 resonance with Neptune, timed so the two are never close together. Its large moon Vanth may be tidally locked to it, much like Charon is to Pluto.',
      fr: 'Parfois surnommée « anti-Pluton » pour une orbite qui reflète la même résonance 2:3 avec Neptune que Pluton, mais synchronisée pour que les deux ne soient jamais proches. Sa grande lune Vanth serait verrouillée gravitationnellement, un peu comme Charon l’est à Pluton.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Orcus_(dwarf_planet)',
      fr: 'https://fr.wikipedia.org/wiki/(90482)_Orcus',
    },
  },
  {
    name: 'quaoar',
    displayName: { en: 'Quaoar', fr: 'Quaoar' },
    // Éléments osculateurs JPL Horizons BARYCENTRIQUES exactement à cette époque (COMMAND
    // '50000;', CENTER=500@0, TLIST=2451545.0), par `pnpm ephemeris:small-body --center 500@0`.
    // Barycentriques car mesuré meilleur au-delà de Neptune (cf. `OrbitalElements.barycentric`).
    a: 43.33509246671098,
    e: 0.03694225430757929,
    iDeg: 7.990872930653528,
    omDeg: 188.9142102666829,
    wDeg: 157.5498851270579,
    maDeg: 265.1482774560987,
    epoch: '2000-01-01T12:00:00Z',
    barycentric: true,
    radiusKm: 1094.4 / 2,
    kind: 'dwarf',
    color: 0x9c8873,
    surfaceResolutions: ['2k'],
    fallbackColor: 0x9c8873,
    visualRadius: 0.086,
    rotationHours: 8.8394,
    massKg: massFromDensity(1.76, 1094.4 / 2),
    gravity: gravityFromMass(massFromDensity(1.76, 1094.4 / 2), 1094.4 / 2),
    moonCount: 1,
    sources: {
      radiusKm: derived('margoti-2026-quaoar', {
        detail: DETAIL.volumetricRadiusFromDiameter,
        uncertainty: 2.3,
      }),
      massKg: derived('margoti-2026-quaoar', {
        detail: DETAIL.massFromDensity,
      }),
      gravity: derived('margoti-2026-quaoar', {
        detail: DETAIL.gravityFromMass,
      }),
      rotationPeriod: measured('margoti-2026-quaoar', { uncertainty: 0.0002 }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      meanTempC: NOT_YET_SOURCED,
    },
    description: {
      en: 'A large Kuiper Belt object that surprised astronomers in 2023 with a system of rings orbiting far beyond the distance where rings should be stable; its moon Weywot may be responsible for keeping them from collapsing.',
      fr: 'Un grand objet de la ceinture de Kuiper qui a surpris les astronomes en 2023 : un système d’anneaux en orbite bien au-delà de la distance où des anneaux sont censés rester stables ; sa lune Weywot pourrait les empêcher de s’effondrer.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Quaoar',
      fr: 'https://fr.wikipedia.org/wiki/(50000)_Quaoar',
    },
  },
  {
    name: 'gonggong',
    displayName: { en: 'Gonggong', fr: 'Gonggong' },
    // Éléments osculateurs JPL Horizons BARYCENTRIQUES exactement à cette époque (COMMAND
    // '225088;', CENTER=500@0, TLIST=2451545.0), par `pnpm ephemeris:small-body --center 500@0`.
    // Barycentriques car mesuré meilleur au-delà de Neptune (cf. `OrbitalElements.barycentric`).
    a: 67.06649002606795,
    e: 0.5034146432904725,
    iDeg: 30.80268415463649,
    omDeg: 336.8395088422051,
    wDeg: 206.9906512032046,
    maDeg: 93.65145846699514,
    epoch: '2000-01-01T12:00:00Z',
    barycentric: true,
    radiusKm: 1230 / 2,
    kind: 'dwarf',
    color: 0xc25a3f,
    surfaceResolutions: ['2k'],
    fallbackColor: 0xc25a3f,
    visualRadius: 0.097,
    rotationHours: 22.4,
    massKg: 1.75e21,
    gravity: gravityFromMass(1.75e21, 1230 / 2),
    moonCount: 1,
    sources: {
      radiusKm: derived('kiss-2019-gonggong', {
        detail: DETAIL.radiusFromDiameter,
        uncertainty: 25,
      }),
      massKg: measured('kiss-2019-gonggong', { detail: DETAIL.systemMass }),
      gravity: derived('kiss-2019-gonggong', {
        detail: DETAIL.gravityFromSystemMass,
      }),
      rotationPeriod: measured('jpl-sbdb', {
        detail: DETAIL.partialLightcurve,
        citation: 'LCDB (Rev. 2023-October); Warner et al., 2009',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      meanTempC: NOT_YET_SOURCED,
    },
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
    // Éléments osculateurs JPL Horizons BARYCENTRIQUES exactement à cette époque (COMMAND
    // '90377;', CENTER=500@0, TLIST=2451545.0), par `pnpm ephemeris:small-body --center 500@0`.
    // Barycentriques car mesuré meilleur au-delà de Neptune (cf. `OrbitalElements.barycentric`).
    a: 506.4484207674334,
    e: 0.8495572493958709,
    iDeg: 11.92852404316633,
    omDeg: 144.401716933437,
    wDeg: 311.2846178310521,
    maDeg: 357.5940836366447,
    epoch: '2000-01-01T12:00:00Z',
    barycentric: true,
    radiusKm: 995 / 2,
    kind: 'dwarf',
    color: 0xb84a3a,
    surfaceResolutions: ['2k'],
    fallbackColor: 0xb84a3a,
    visualRadius: 0.078,
    rotationHours: 10.273,
    moonCount: 0,
    sources: {
      radiusKm: derived('pal-2012-sedna', {
        detail: DETAIL.radiusFromDiameter,
        uncertainty: 40,
      }),
      rotationPeriod: measured('jpl-sbdb', {
        detail: DETAIL.partialLightcurve,
        citation: 'LCDB (Rev. 2023-October); Warner et al., 2009',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    unknown: {
      massKg: NOT_YET_SOURCED,
      gravity: NOT_YET_SOURCED,
      meanTempC: NOT_YET_SOURCED,
    },
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
    radiusKm: 11.0 / 2,
    // Periode de rotation mesuree par Vega 1/2 : 53,5 +/- 1 h, confirmee par les images
    // Giotto. A prendre pour ce qu'elle est : le noyau est en PRECESSION LIBRE (rotation
    // hors axe principal), et la litterature en tire deux periodicites, ~2,2 j et ~7,4 j.
    // Il n'existe donc pas de cycle fixe unique, comme pour Hyperion et Styx ailleurs
    // dans ce fichier ; on retient la valeur observee plutot que de laisser le corps fige.
    rotationHours: 53.5,
    moonCount: 0,
    unknown: {
      rotationPeriod: NOT_YET_SOURCED,
      massKg: {
        en: 'No direct measurement: the nucleus mass is inferred from a density that is itself poorly constrained ("no more than a quarter that of ice").',
        fr: "Aucune mesure directe : la masse du noyau se déduit d'une densité elle-même mal contrainte (« pas plus du quart de celle de la glace »).",
      },
      gravity: {
        en: 'Irregular nucleus of about 15 x 8 km: surface gravity varies by a large factor depending on where you stand, so a single value would mislead.',
        fr: "Noyau irrégulier d'environ 15 x 8 km : la gravité de surface varie d'un facteur important selon l'endroit, une valeur unique serait trompeuse.",
      },
      meanTempC: {
        en: 'Temperature sweeps about 340 K along the orbit, from below -250 C at aphelion to tens of degrees C at perihelion: a mean would describe no real moment.',
        fr: "La température parcourt environ 340 K le long de l'orbite, de moins de -250 C à l'aphélie à plusieurs dizaines de degrés au périhélie : une moyenne ne décrirait aucun instant réel.",
      },
    },
    color: 0xf08ac6,
    surfaceResolutions: ['4k', '2k'],
    kind: 'comet',
    sources: {
      radiusKm: derived('jpl-sbdb', {
        detail: DETAIL.radiusFromDiameter,
        citation:
          'Lamy,P.L.;Toth,I.;Fernandez,Y.R.;Weaver,H.A. (2004) Comets II, pp. 223-264',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    description: {
      en: 'The most famous comet, visible from Earth about every 76 years, with its next return in 2061. It orbits backwards, against the flow of the planets.',
      fr: 'La plus célèbre des comètes, visible depuis la Terre tous les 76 ans environ, avec un prochain retour en 2061. Elle orbite à rebours, à contre-courant des planètes.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/Halley%27s_Comet',
      fr: 'https://fr.wikipedia.org/wiki/Com%C3%A8te_de_Halley',
    },
  },
  {
    name: 'bennu',
    displayName: { en: 'Bennu', fr: 'Bennu' },
    // Éléments osculateurs JPL Horizons EXACTEMENT à cette époque (COMMAND '101955;',
    // EPHEM_TYPE=ELEMENTS, TLIST=2461041.5), par `pnpm ephemeris:small-body`. Ils étaient à
    // l'époque J2000 : propagés en deux corps sur 26 ans, ils plaçaient Bennu à 0,47 UA de sa
    // vraie position au 1er janvier 2026 (0,72 UA en 2036) — mesuré contre les vecteurs
    // Horizons. Un géocroiseur frôle la Terre : les perturbations s'y accumulent vite.
    a: 1.12599000686509,
    e: 0.203694590837364,
    iDeg: 6.032844145249296,
    omDeg: 1.968709536577289,
    wDeg: 66.41044379803537,
    maDeg: 301.2865775321327,
    epoch: '2026-01-01T00:00:00.000Z',
    // Diamètre 0,48444 km (JPL SBDB, ±0,0003) → rayon moyen.
    radiusKm: 0.48444 / 2,
    kind: 'asteroid',
    color: 0x6b6560,
    // Pas de texture : la surface de Bennu n'a pas de mosaïque équirectangulaire publiée à
    // laquelle on puisse se fier. C'est la FORME qui la fait reconnaître, pas sa couleur.
    fallbackColor: 0x5e5e5e,
    model: {
      resolutions: ['4k', '2k', '1k'],
      // Mesuré sur le fichier : rayon max / rayon équivalent-volume.
      extentRatio: 1.18,
      // Luminosité et couleur RÉELLES, cuites dans le modèle (bake-shape-colour.mjs) ; la sphère
      // d'attente ci-dessus a la même couleur moyenne, pour ne pas changer d'aspect au chargement.
      albedo: 0.044,
      albedoSource:
        'Hergenrother et al. 2019, Nat. Commun. 10, 1291 (JPL SBDB)',
      colourSource: {
        en: 'NASA/USGS, Bennu OSIRIS-REx OCAMS Global Albedo Mosaic (Golish et al. 2021), public domain',
        fr: 'NASA/USGS, Bennu OSIRIS-REx OCAMS Global Albedo Mosaic (Golish et al. 2021), domaine public',
      },
      credit: {
        en: 'NASA/Goddard Scientific Visualization Studio, OSIRIS-REx OLA v20 PTM global shape model (NASA/University of Arizona/CSA/York University/MDA), decimated for the web.',
        fr: 'NASA/Goddard Scientific Visualization Studio, modèle de forme global OSIRIS-REx OLA v20 PTM (NASA/University of Arizona/CSA/York University/MDA), décimé pour le web.',
      },
    },
    rotationHours: 4.296061,
    // Obliquité DÉRIVÉE, pas recopiée : pôle SBDB (RA 85,4522°, Dec −60,3678°) converti en
    // écliptique puis comparé à la normale orbitale (i, Ω ci-dessus) → 177,5° (177,6° avec
    // les éléments J2000 : le plan orbital a très légèrement tourné). Bennu tourne donc à
    // l'envers, ce qui est bien la valeur publiée — le calcul la retrouve.
    axialTiltDeg: 177.5,
    // GM = 4,8904e-9 km³/s² (SBDB) ÷ G → 7,33e10 kg.
    massKg: massFromGM(4.8904e-9),
    moonCount: 0,
    unknown: {
      gravity: {
        en: 'About 8e-5 m/s2, a hundred-thousandth of Earth: a walking pace would put you into orbit, and the usual two-decimal figure would read as zero.',
        fr: "Environ 8e-5 m/s2, cent-millième de celle de la Terre : marcher vite suffirait à se mettre en orbite, et l'affichage habituel à deux décimales lirait zéro.",
      },
      meanTempC: {
        en: 'Surface temperature swings by more than 100 C over its 4.3-hour day: a mean would describe no real moment.',
        fr: 'La température de surface varie de plus de 100 C au fil de sa journée de 4,3 heures : une moyenne ne décrirait aucun instant réel.',
      },
    },
    sources: {
      radiusKm: derived('jpl-sbdb', {
        detail: DETAIL.radiusFromDiameter,
        citation: 'Daly, M.G., et al., Sci. Adv. 6, eabd3649 (2020)',
        uncertainty: 0.00015,
      }),
      massKg: derived('jpl-sbdb', {
        detail: DETAIL.massFromGM,
        citation:
          'Chesley, S.R., et al., J. Geophys. Res. (Planets) 125, e06363 (2020)',
        uncertainty: massFromGM(0.0009e-9),
      }),
      rotationPeriod: measured('jpl-sbdb', {
        citation: 'Hergenrother, M.C., et al., Nat. Commun. 10, 1291 (2019)',
        uncertainty: 0.000002,
      }),
      axialTilt: derived('jpl-sbdb', {
        detail: DETAIL.obliquityFromPole,
        citation: 'Daly, M.G., et al., Sci. Adv. 6, eabd3649 (2020)',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    description: {
      en: 'A 500-metre rubble pile shaped like a spinning top, visited by OSIRIS-REx, which brought a sample of it back to Earth in 2023.',
      fr: 'Un amas de gravats de 500 mètres en forme de toupie, visité par OSIRIS-REx, qui en a rapporté un échantillon sur Terre en 2023.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/101955_Bennu',
      fr: 'https://fr.wikipedia.org/wiki/(101955)_Bennu',
    },
  },
  // ── Vague A : astéroïdes visités, avec leur modèle de forme scientifique ──────────────────
  // Même famille que Bennu : pas de binaire Horizons, la position dépend entièrement de ces
  // éléments. Ils sont dérivés par `scripts/derive-small-body-elements.mjs` à l'époque
  // 2026-01-01, et non J2000 : mesuré contre Horizons, des éléments J2000 placent aujourd'hui
  // Itokawa, Ryugu et Ida à 0,11-0,13 UA de leur vraie position (6° pour Ryugu, près de la
  // Terre), contre ≤ 0,003 UA à un an de 2026. Rayons = rayons équivalents-volume publiés, que
  // le volume des modèles retrouve (cf. `shapeModels.test.ts`).
  {
    name: 'eros',
    displayName: { en: 'Eros', fr: 'Éros' },
    // Éléments osculateurs JPL Horizons EXACTEMENT à cette époque (COMMAND '433;',
    // EPHEM_TYPE=ELEMENTS, TLIST=2461041.5).
    a: 1.45819547852407,
    e: 0.2228676636398718,
    iDeg: 10.82863065156889,
    omDeg: 304.2685688172245,
    wDeg: 178.9239475110484,
    maDeg: 333.5121645523216,
    epoch: '2026-01-01T00:00:00.000Z',
    // Diamètre équivalent 16,84 ± 0,06 km (SBDB, Yeomans et al. 2000).
    radiusKm: 16.84 / 2,
    kind: 'asteroid',
    color: 0xe0a45c,
    fallbackColor: 0xe8cfb8,
    model: {
      resolutions: ['4k', '2k', '1k'],
      // Mesuré sur le fichier : rayon max / rayon équivalent-volume.
      extentRatio: 2.1,
      // Luminosité et couleur RÉELLES, cuites dans le modèle (bake-shape-colour.mjs) ; la sphère
      // d'attente ci-dessus a la même couleur moyenne, pour ne pas changer d'aspect au chargement.
      albedo: 0.25,
      albedoSource: 'Veverka et al. 2000, Science 289, 2088 (JPL SBDB)',
      colourSource: {
        en: 'NASA/USGS, Eros NEAR MSI Global Albedo Mosaics at 760, 550 and 450 nm (Golish et al. 2023, doi:10.17189/sv8w-5125), public domain',
        fr: 'NASA/USGS, Eros NEAR MSI Global Albedo Mosaics à 760, 550 et 450 nm (Golish et al. 2023, doi:10.17189/sv8w-5125), domaine public',
      },
      credit: {
        en: 'NASA/JHU-APL NEAR Shoemaker, MSI shape model by R. Gaskell, NASA PDS NEAR-A-MSI-5-EROSSHAPE-V1.0 (q = 128), decimated for the web.',
        fr: 'NASA/JHU-APL NEAR Shoemaker, modèle de forme MSI de R. Gaskell, NASA PDS NEAR-A-MSI-5-EROSSHAPE-V1.0 (q = 128), décimé pour le web.',
      },
    },
    rotationHours: 5.27,
    // DÉRIVÉE du pôle SBDB (RA 11,37°, Dec 17,22°, Yeomans et al. 2000) et de la normale
    // orbitale : Éros tourne presque couché sur son orbite.
    axialTiltDeg: 89.0,
    // GM = 4,463e-4 km³/s² (SBDB) ÷ G.
    massKg: massFromGM(4.463e-4),
    moonCount: 0,
    unknown: {
      gravity: {
        en: 'A 34-kilometre peanut: surface gravity varies strongly depending on where you stand, so a single value would mislead.',
        fr: "Une cacahuète de 34 kilomètres : la gravité de surface varie fortement selon l'endroit, une valeur unique serait trompeuse.",
      },
      meanTempC: {
        en: 'Surface temperature swings strongly over its 5.3-hour day and along its eccentric orbit: a mean would describe no real moment.',
        fr: 'La température de surface varie fortement au fil de sa journée de 5,3 heures et le long de son orbite excentrique : une moyenne ne décrirait aucun instant réel.',
      },
    },
    sources: {
      radiusKm: derived('jpl-sbdb', {
        detail: DETAIL.radiusFromDiameter,
        citation: 'Yeomans et al. (2000) Science v.289,pp.2085-2088',
        uncertainty: 0.03,
      }),
      massKg: derived('jpl-sbdb', {
        detail: DETAIL.massFromGM,
        citation: 'Yeomans et al. (2000) Science v.289,pp.2085-2088',
        uncertainty: massFromGM(0.001e-4),
      }),
      rotationPeriod: measured('jpl-sbdb', {
        citation: 'LCDB (Rev. 2023-October); Warner et al., 2009',
      }),
      axialTilt: derived('jpl-sbdb', {
        detail: DETAIL.obliquityFromPole,
        citation: 'Yeomans et al. (2000) Science v.289,pp.2085-2088',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    description: {
      en: 'The first asteroid ever orbited and landed on: NASA’s NEAR Shoemaker circled it for a year and touched down on its surface in February 2001.',
      fr: 'Le premier astéroïde jamais mis en orbite puis touché : la sonde NEAR Shoemaker de la NASA l’a survolé pendant un an et s’est posée à sa surface en février 2001.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/433_Eros',
      fr: 'https://fr.wikipedia.org/wiki/(433)_%C3%89ros',
    },
  },
  {
    name: 'itokawa',
    displayName: { en: 'Itokawa', fr: 'Itokawa' },
    // Éléments osculateurs JPL Horizons EXACTEMENT à cette époque (COMMAND '25143;',
    // EPHEM_TYPE=ELEMENTS, TLIST=2461041.5).
    a: 1.324127117232954,
    e: 0.2801540468526449,
    iDeg: 1.620937434229415,
    omDeg: 69.07544850295109,
    wDeg: 162.8518643924063,
    maDeg: 67.7838526010873,
    epoch: '2026-01-01T00:00:00.000Z',
    // Diamètre moyen 0,33 km (SBDB, Fujiwara et al. 2006) ; le volume du modèle Gaskell donne
    // 0,162 km, à 2 % près.
    radiusKm: 0.33 / 2,
    kind: 'asteroid',
    color: 0x7fb3c9,
    fallbackColor: 0xdadada,
    model: {
      resolutions: ['4k', '2k', '1k'],
      // Mesuré sur le fichier : rayon max / rayon équivalent-volume.
      extentRatio: 1.93,
      // Luminosité et couleur RÉELLES, cuites dans le modèle (bake-shape-colour.mjs) ; la sphère
      // d'attente ci-dessus a la même couleur moyenne, pour ne pas changer d'aspect au chargement.
      albedo: 0.27,
      albedoSource:
        'Hayabusa AMICA disk-integrated photometry near opposition (Icarus, 2018)',
      colourSource: null,
      credit: {
        en: 'JAXA Hayabusa AMICA images, shape model by R. Gaskell (PSI), NASA PDS HAY-A-AMICA-5-ITOKAWASHAPE-V1.0 (q = 128), decimated for the web.',
        fr: 'Images JAXA Hayabusa AMICA, modèle de forme de R. Gaskell (PSI), NASA PDS HAY-A-AMICA-5-ITOKAWASHAPE-V1.0 (q = 128), décimé pour le web.',
      },
    },
    rotationHours: 12.132,
    // DÉRIVÉE du pôle SBDB (RA 90,53°, Dec −66,30°, Demura et al. 2006) : rotation rétrograde.
    axialTiltDeg: 178.7,
    // Masse PUBLIÉE (3,51e10 kg ± 3 %, Fujiwara et al. 2006), citée dans les notes de la SBDB.
    // Le GM de la même fiche (2,1e-9 km³/s²) ne lui correspond pas : 2,1e-9 / G = 3,15e10 kg,
    // la valeur que ce catalogue affichait jusqu'ici.
    massKg: 3.51e10,
    moonCount: 0,
    unknown: {
      gravity: {
        en: 'About a hundred-thousandth of Earth’s, and it changes by a large factor between the two lobes: a single value would mislead.',
        fr: "Environ un cent-millième de celle de la Terre, et elle change d'un facteur important d'un lobe à l'autre : une valeur unique serait trompeuse.",
      },
      meanTempC: {
        en: 'Surface temperature swings strongly between day and night and along its orbit: a mean would describe no real moment.',
        fr: 'La température de surface varie fortement entre le jour et la nuit et le long de son orbite : une moyenne ne décrirait aucun instant réel.',
      },
    },
    sources: {
      radiusKm: derived('jpl-sbdb', {
        detail: DETAIL.radiusFromDiameter,
        citation: 'Science 312:1330-1334',
      }),
      massKg: measured('jpl-sbdb', {
        detail: DETAIL.itokawaPublishedMass,
        citation: 'Science 312:1330-1334',
        uncertainty: 0.03 * 3.51e10,
      }),
      rotationPeriod: measured('jpl-sbdb', {
        citation: 'LCDB (Rev. 2023-October); Warner et al., 2009',
      }),
      axialTilt: derived('jpl-sbdb', {
        detail: DETAIL.obliquityFromPole,
        citation: 'Demura, H., et al., Science, 312, 1347 (2006)',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    description: {
      en: 'A 535-metre rubble pile shaped like a sea otter. JAXA’s Hayabusa landed on it in 2005 and brought the first grains of an asteroid back to Earth in 2010.',
      fr: 'Un amas de gravats de 535 mètres en forme de loutre de mer. La sonde japonaise Hayabusa s’y est posée en 2005 et a rapporté sur Terre, en 2010, les premiers grains d’un astéroïde.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/25143_Itokawa',
      fr: 'https://fr.wikipedia.org/wiki/(25143)_Itokawa',
    },
  },
  {
    name: 'ryugu',
    displayName: { en: 'Ryugu', fr: 'Ryugu' },
    // Éléments osculateurs JPL Horizons EXACTEMENT à cette époque (COMMAND '162173;',
    // EPHEM_TYPE=ELEMENTS, TLIST=2461041.5).
    a: 1.190915530274858,
    e: 0.191066697591621,
    iDeg: 5.866565344845061,
    omDeg: 251.2911945048745,
    wDeg: 211.6188712177815,
    maDeg: 301.7512745052471,
    epoch: '2026-01-01T00:00:00.000Z',
    // Diamètre équivalent 0,896 ± 0,004 km (SBDB, Watanabe et al. 2019).
    radiusKm: 0.896 / 2,
    kind: 'asteroid',
    color: 0x9c6fd6,
    fallbackColor: 0x5f5f5f,
    model: {
      resolutions: ['4k', '2k', '1k'],
      // Mesuré sur le fichier : rayon max / rayon équivalent-volume.
      extentRatio: 1.18,
      // Luminosité et couleur RÉELLES, cuites dans le modèle (bake-shape-colour.mjs) ; la sphère
      // d'attente ci-dessus a la même couleur moyenne, pour ne pas changer d'aspect au chargement.
      albedo: 0.045,
      albedoSource: 'Sugita et al. 2019, Science 364, 6437 (JPL SBDB)',
      colourSource: {
        en: 'ISAS/JAXA, Ryugu v-band normal albedo map, Hayabusa2 ONC (JAXA DARTS); data modified: sampled per vertex',
        fr: 'ISAS/JAXA, carte d’albédo normal en bande v de Ryugu, Hayabusa2 ONC (JAXA DARTS) ; données modifiées : échantillonnée par sommet',
      },
      credit: {
        en: 'ISAS/JAXA Hayabusa2, SfM shape model SHAPE_SFM_200k_v20180804 (Watanabe et al. 2019, DARTS); data modified: decimated for the web, pole brought onto Y.',
        fr: 'ISAS/JAXA Hayabusa2, modèle de forme SfM SHAPE_SFM_200k_v20180804 (Watanabe et al. 2019, DARTS) ; données modifiées : décimé pour le web, pôle ramené sur Y.',
      },
    },
    rotationHours: 7.63262,
    // DÉRIVÉE du pôle SBDB (RA 96,3956°, Dec −66,3937°, Preusker et al. 2019) : rétrograde.
    axialTiltDeg: 171.7,
    // GM = 3,00e-8 km³/s² (SBDB) ÷ G.
    massKg: massFromGM(3.0e-8),
    moonCount: 0,
    unknown: {
      gravity: {
        en: 'About 0.1 mm/s², a hundred-thousandth of Earth’s, and about a fifth weaker on its equatorial ridge, where the spin works against it: a single value would mislead.',
        fr: "Environ 0,1 mm/s², un cent-millième de celle de la Terre, et plus faible d'un cinquième environ sur son bourrelet équatorial, où la rotation s'y oppose : une valeur unique serait trompeuse.",
      },
      meanTempC: {
        en: 'Surface temperature swings strongly over its 7.6-hour day: a mean would describe no real moment.',
        fr: 'La température de surface varie fortement au fil de sa journée de 7,6 heures : une moyenne ne décrirait aucun instant réel.',
      },
    },
    sources: {
      radiusKm: derived('jpl-sbdb', {
        detail: DETAIL.radiusFromDiameter,
        citation:
          'Watanabe, S.; Hirabayashi, M.; Hirata, N.; Hirata, Na.; et al. (2019) Science 364, 267-272.',
        uncertainty: 0.002,
      }),
      massKg: derived('jpl-sbdb', {
        detail: DETAIL.massFromGM,
        citation:
          'Watanabe, S.; Hirabayashi, M.; Hirata, N.; Hirata, Na.; et al. (2019) Science 364, 267-272.',
        uncertainty: massFromGM(0.04e-8),
      }),
      rotationPeriod: measured('jpl-sbdb', {
        citation:
          'Watanabe, S.; Hirabayashi, M.; Hirata, N.; Hirata, Na.; et al. (2019) Science 364, 267-272.',
        uncertainty: 0.00002,
      }),
      axialTilt: derived('jpl-sbdb', {
        detail: DETAIL.obliquityFromPole,
        citation:
          'Preusker, F.; Scholten, F.; Elgner, S.; Matz, K. D.; et al. (2019) A&A 632 L4.',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    description: {
      en: 'A dark, carbon-rich spinning top about 900 metres across. JAXA’s Hayabusa2 fired a projectile into it to dig a fresh crater and brought 5.4 grams of it back to Earth in December 2020.',
      fr: 'Une toupie sombre et riche en carbone d’environ 900 mètres. La sonde japonaise Hayabusa2 y a tiré un projectile pour creuser un cratère frais et en a rapporté 5,4 grammes sur Terre en décembre 2020.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/162173_Ryugu',
      fr: 'https://fr.wikipedia.org/wiki/(162173)_Ryugu',
    },
  },
  {
    name: 'ida',
    displayName: { en: 'Ida', fr: 'Ida' },
    // Éléments osculateurs JPL Horizons EXACTEMENT à cette époque (COMMAND '243;',
    // EPHEM_TYPE=ELEMENTS, TLIST=2461041.5).
    a: 2.862971354381273,
    e: 0.04570747515204408,
    iDeg: 1.13020036408425,
    omDeg: 323.5426573297611,
    wDeg: 113.7244045691694,
    maDeg: 16.88744495932398,
    epoch: '2026-01-01T00:00:00.000Z',
    // Rayon moyen 15,7 km (Thomas et al. 1996, le même travail que le modèle de forme ; le
    // « 32 km » de la SBDB est un diamètre antérieur, arrondi).
    radiusKm: 32 / 2,
    kind: 'asteroid',
    color: 0xd6c16f,
    fallbackColor: 0xd8d8d8,
    model: {
      resolutions: ['2k', '1k'],
      // Mesuré sur le fichier : rayon max / rayon équivalent-volume.
      extentRatio: 2.0,
      // Luminosité et couleur RÉELLES, cuites dans le modèle (bake-shape-colour.mjs) ; la sphère
      // d'attente ci-dessus a la même couleur moyenne, pour ne pas changer d'aspect au chargement.
      albedo: 0.262,
      albedoSource: 'NEOWISE, Mainzer et al. 2012, ApJ 759 L8 (JPL SBDB)',
      colourSource: null,
      credit: {
        en: 'NASA Galileo SSI, shape model by P. Thomas et al. (1996), NASA PDS EAR-A-5-DDR-SHAPE-MODELS-V2.1, converted to a mesh for the web.',
        fr: 'NASA Galileo SSI, modèle de forme de P. Thomas et al. (1996), NASA PDS EAR-A-5-DDR-SHAPE-MODELS-V2.1, converti en maillage pour le web.',
      },
    },
    rotationHours: 4.634,
    // DÉRIVÉE du pôle PDS (Thomas et al. : RA 348,76°, Dec +87,10°, rotation RÉTROGRADE, donc
    // moment cinétique vers RA 168,76°, Dec −87,10°) et de la normale orbitale.
    axialTiltDeg: 156.0,
    // GM = 0,00275 km³/s² (SBDB, Belton et al. 1996, mesuré grâce à Dactyle) ÷ G.
    massKg: massFromGM(0.00275),
    // Dactyle, découverte sur les images de Galileo — pas encore dans ce catalogue.
    moonCount: 1,
    unknown: {
      axialTilt: NOT_YET_SOURCED,
      gravity: {
        en: 'A 60-kilometre elongated body spinning in 4.6 hours: surface gravity changes by a large factor from its ends to its middle, so a single value would mislead.',
        fr: "Un corps allongé de 60 kilomètres qui tourne en 4,6 heures : la gravité de surface change d'un facteur important de ses extrémités à son centre, une valeur unique serait trompeuse.",
      },
      meanTempC: {
        en: 'Surface temperature swings strongly over its 4.6-hour day: a mean would describe no real moment.',
        fr: 'La température de surface varie fortement au fil de sa journée de 4,6 heures : une moyenne ne décrirait aucun instant réel.',
      },
    },
    sources: {
      radiusKm: derived('jpl-sbdb', {
        detail: DETAIL.radiusFromDiameter,
        citation: 'Belton et al. (1995)',
      }),
      massKg: derived('jpl-sbdb', {
        detail: DETAIL.massFromGM,
        citation: 'Belton et al. (1996) Icarus v.120, pp.185-199',
        uncertainty: massFromGM(0.00035),
      }),
      rotationPeriod: measured('jpl-sbdb', {
        citation: 'LCDB (Rev. 2023-October); Warner et al., 2009',
      }),
      moonCount: measured('jpl-sbdb', {
        detail: DETAIL.confirmedSatellites,
        asOf: '2026-09-17',
      }),
    },
    description: {
      en: 'The first asteroid found to have its own moon: images taken by NASA’s Galileo probe in 1993 revealed tiny Dactyl orbiting this 60-kilometre main-belt asteroid.',
      fr: 'Le premier astéroïde découvert avec sa propre lune : les images prises en 1993 par la sonde Galileo de la NASA ont révélé la petite Dactyle en orbite autour de cet astéroïde de 60 kilomètres de la ceinture principale.',
    },
    wiki: {
      en: 'https://en.wikipedia.org/wiki/243_Ida',
      fr: 'https://fr.wikipedia.org/wiki/(243)_Ida',
    },
  },
];

/** Table nom → config des petits corps, fusionnée dans `CELESTIAL_CONFIG`. */
export const SMALL_BODIES: Record<string, CelestialBodyConfig> =
  Object.fromEntries(
    SMALL_BODY_ELEMENTS.map((el) => [el.name, smallBodyToConfig(el)])
  );
