/**
 * Catalogue des corps célestes — SOURCE UNIQUE.
 *
 * Chaque entrée porte tout ce qui définit un corps : taille, rotation, couleur d'orbite,
 * anneaux, satellites, données astronomiques réelles (`realData`), enum astronomy-engine
 * (`astroBody`), référentiel (`frame`), distance de visite caméra (`cameraDistance`) et
 * rang de préchargement (`loadPriority`).
 *
 * Ajouter un corps = une entrée ici + son dossier de textures. Tout le reste (boutons de
 * navigation, préchargement, éphéméride, hiérarchie de scène) se dérive du catalogue.
 */
import { Body } from 'astronomy-engine';
import type { CelestialConfig } from '@/types';
import { exploCameraDistance } from '@/core/ScaleService';
import { DEG_TO_RAD as D2R } from '@/core/MathConstants';
import {
  assertUniqueBodyNames,
  deriveTextures,
  forEachBody,
  ringTexturePath,
} from './catalog';
import { assertValidCelestialCatalog } from './catalogValidation';
import {
  DETAIL,
  NOT_YET_SOURCED,
  derived,
  gravityFromGM,
  kmToAu,
  massFromGM,
  measured,
} from './factSources';
import { SMALL_BODIES } from './smallBodies';

// Vitesse de rotation axiale — rad / seconde de simulation.
const _R = (hours: number): number => (Math.PI * 2) / (hours * 3_600);

export const CELESTIAL_CONFIG: CelestialConfig = {
  bodies: {
    stars: {
      kind: 'skybox',
      radius: 0,
      rotationSpeed: 0,
      orbitalColor: 0x000000,
      textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
      loadPriority: 0,
    },

    sun: {
      kind: 'star',
      displayName: { fr: 'Soleil' },
      // Rayon éducatif volontairement tempéré : le Soleil reste dominant sans saturer la vue.
      // En Explo, le rayon physique de realData.radiusKm reprend entièrement la main.
      radius: 7,
      rotationSpeed: _R(609.12),
      orbitalColor: 0x000000,
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      realData: {
        sources: {
          radiusKm: measured('nssdca-fact-sheets'),
          massKg: measured('nssdca-fact-sheets'),
          gravity: measured('nssdca-fact-sheets', {
            detail: DETAIL.equatorialGravity,
          }),
          meanTempC: derived('nssdca-fact-sheets', {
            detail: DETAIL.effectiveTemperature,
          }),
          rotationPeriod: measured('nssdca-fact-sheets', {
            detail: DETAIL.solarRotationAt16Degrees,
          }),
          axialTilt: measured('nssdca-fact-sheets', {
            detail: DETAIL.obliquityToEcliptic,
          }),
        },
        radiusKm: 695_700,
        axialTilt: 7.25 * D2R,
        massKg: 1.9884e30,
        gravity: 274,
        meanTempC: 5772 - 273.15,
        description: {
          en: 'The star at the heart of the Solar System. This ball of plasma holds 99.86% of all the mass orbiting it.',
          fr: 'L’étoile au cœur du Système solaire. Cette boule de plasma concentre 99,86 % de toute la masse en orbite autour d’elle.',
        },
        wiki: {
          en: 'https://en.wikipedia.org/wiki/Sun',
          fr: 'https://fr.wikipedia.org/wiki/Soleil',
        },
      },
      astroBody: Body.Sun,
      cameraDistance: { educ: 50, explo: exploCameraDistance(695_700) },
      loadPriority: 1,
    },

    mercury: {
      kind: 'planet',
      displayName: { fr: 'Mercure' },
      radius: 0.38,
      rotationSpeed: _R(1407.6),
      orbitalColor: 0xb8b0a5,
      textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
      realData: {
        sources: {
          radiusKm: measured('nssdca-fact-sheets'),
          distanceAU: measured('nssdca-fact-sheets'),
          orbitPeriodDays: measured('nssdca-fact-sheets'),
          massKg: measured('nssdca-fact-sheets'),
          gravity: measured('nssdca-fact-sheets'),
          meanTempC: measured('nssdca-fact-sheets'),
          rotationPeriod: measured('nssdca-fact-sheets'),
          moonCount: measured('nssdca-fact-sheets', { asOf: '2024-01-11' }),
          axialTilt: measured('nssdca-fact-sheets'),
        },
        radiusKm: 2_439.7,
        distanceAU: 0.38709893,
        orbitPeriodDays: 87.969,
        orbitalInclination: 7.005 * D2R,
        ascendingNode: 48.331 * D2R,
        axialTilt: 0.034 * D2R,
        massKg: 3.301e23,
        gravity: 3.7,
        meanTempC: 167,
        moonCount: 0,
        description: {
          en: 'The smallest planet and the closest to the Sun. With no atmosphere, it swings from +430 °C by day to -180 °C at night.',
          fr: 'La plus petite planète et la plus proche du Soleil. Sans atmosphère, elle passe de +430 °C le jour à -180 °C la nuit.',
        },
        wiki: {
          en: 'https://en.wikipedia.org/wiki/Mercury_(planet)',
          fr: 'https://fr.wikipedia.org/wiki/Mercure_(plan%C3%A8te)',
        },
      },
      astroBody: Body.Mercury,
      cameraDistance: { educ: 2, explo: exploCameraDistance(2_440) },
      loadPriority: 8,
    },

    venus: {
      kind: 'planet',
      displayName: { fr: 'Vénus' },
      radius: 0.95,
      rotationSpeed: _R(5832.6),
      orbitalColor: 0xe9a13b,
      textureResolutions: {
        surface: ['8k', '4k', '2k', '1k'],
        // Le voile nuageux opaque de Vénus est rendu comme couche `clouds`
        // (sphère texturée), le halo atmosphérique Fresnel s'ajoutant au limbe.
        clouds: ['4k', '2k', '1k'],
      },
      atmosphereColor: 0xd9b26a,
      realData: {
        sources: {
          radiusKm: measured('nssdca-fact-sheets'),
          distanceAU: measured('nssdca-fact-sheets'),
          orbitPeriodDays: measured('nssdca-fact-sheets'),
          massKg: measured('nssdca-fact-sheets'),
          gravity: measured('nssdca-fact-sheets'),
          meanTempC: measured('nssdca-fact-sheets'),
          rotationPeriod: measured('nssdca-fact-sheets'),
          moonCount: measured('nssdca-fact-sheets', { asOf: '2024-01-11' }),
          axialTilt: measured('nssdca-fact-sheets'),
        },
        radiusKm: 6_051.8,
        distanceAU: 0.72333199,
        orbitPeriodDays: 224.701,
        orbitalInclination: 3.395 * D2R,
        ascendingNode: 76.68 * D2R,
        axialTilt: 177.36 * D2R,
        massKg: 4.8673e24,
        gravity: 8.87,
        meanTempC: 464,
        moonCount: 0,
        description: {
          en: 'The hottest planet. Its thick CO₂ atmosphere traps heat through a runaway greenhouse effect, and it spins backwards, very slowly.',
          fr: 'La planète la plus chaude. Son épaisse atmosphère de CO₂ piège la chaleur par un effet de serre emballé, et elle tourne à l’envers, très lentement.',
        },
        wiki: {
          en: 'https://en.wikipedia.org/wiki/Venus',
          fr: 'https://fr.wikipedia.org/wiki/V%C3%A9nus_(plan%C3%A8te)',
        },
      },
      astroBody: Body.Venus,
      cameraDistance: { educ: 5, explo: exploCameraDistance(6_052) },
      loadPriority: 7,
    },

    earth: {
      kind: 'planet',
      displayName: { fr: 'Terre' },
      radius: 1,
      rotationSpeed: _R(23.9345),
      orbitalColor: 0x2f9dff,
      textureResolutions: {
        surface: ['8k', '4k', '2k', '1k'],
        normalMap: ['8k', '4k', '2k', '1k'],
        displacement: ['2k', '1k'],
        clouds: ['8k', '4k', '2k', '1k'],
        spec: ['8k', '4k', '2k', '1k'],
        lights: ['8k', '4k', '2k', '1k'],
      },
      // L'atmosphère terrestre est un phénomène de diffusion rendu par shader ; elle
      // ne nécessite pas une texture bitmap supplémentaire.
      atmosphereColor: 0x4a90e0,
      realData: {
        sources: {
          radiusKm: measured('nssdca-fact-sheets'),
          distanceAU: measured('nssdca-fact-sheets'),
          orbitPeriodDays: measured('nssdca-fact-sheets'),
          massKg: measured('nssdca-fact-sheets'),
          gravity: measured('nssdca-fact-sheets'),
          meanTempC: measured('nssdca-fact-sheets'),
          rotationPeriod: measured('nssdca-fact-sheets'),
          moonCount: measured('nssdca-fact-sheets', { asOf: '2024-11-15' }),
          axialTilt: measured('nssdca-fact-sheets'),
        },
        radiusKm: 6_371,
        distanceAU: 1.00000011,
        orbitPeriodDays: 365.256,
        orbitalInclination: 0,
        ascendingNode: 0,
        axialTilt: 23.44 * D2R,
        massKg: 5.9722e24,
        gravity: 9.82,
        meanTempC: 15,
        moonCount: 1,
        description: {
          en: 'The only known planet to harbour life. Liquid water covers 71% of its surface, and its atmosphere shields it from solar radiation.',
          fr: 'La seule planète connue à abriter la vie. L’eau liquide couvre 71 % de sa surface, et son atmosphère la protège du rayonnement solaire.',
        },
        wiki: {
          en: 'https://en.wikipedia.org/wiki/Earth',
          fr: 'https://fr.wikipedia.org/wiki/Terre',
        },
      },
      astroBody: Body.Earth,
      // Position au barycentre Terre-Lune : évite le ballant lunaire réel (~4700 km, ~27 j)
      // qui se voit comme un zigzag à vraie échelle et vitesse max. L'axe/jour-nuit reste sur
      // Body.Earth. La Lune (parentRelative) est alors référencée à l'EMB, restant à sa vraie position.
      positionBody: Body.EMB,
      cameraDistance: { educ: 5, explo: exploCameraDistance(6_371) },
      loadPriority: 2,
      satellites: {
        moon: {
          kind: 'moon',
          displayName: { fr: 'Lune' },
          frame: 'parentRelative',
          radius: 0.27,
          rotationSpeed: _R(655.72),
          orbitalColor: 0x8f98a5,
          textureResolutions: {
            surface: ['8k', '4k', '2k', '1k'],
          },
          realData: {
            sources: {
              radiusKm: measured('nssdca-fact-sheets'),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: measured('nssdca-fact-sheets'),
              gravity: measured('nssdca-fact-sheets'),
              meanTempC: measured('nssdca-fact-sheets'),
              rotationPeriod: measured('nssdca-fact-sheets'),
              axialTilt: measured('nssdca-fact-sheets'),
            },
            radiusKm: 1_737.4,
            distanceAU: kmToAu(384_400),
            orbitPeriodDays: 27.3217,
            orbitalInclination: 5.145 * D2R,
            ascendingNode: 0,
            axialTilt: 6.68 * D2R,
            massKg: 7.346e22,
            gravity: 1.62,
            meanTempC: -20,
            description: {
              en: "Earth's only natural satellite. It always shows the same face and stabilises our planet's axial tilt.",
              fr: 'Le seul satellite naturel de la Terre. Elle montre toujours la même face et stabilise l’inclinaison de l’axe de notre planète.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Moon',
              fr: 'https://fr.wikipedia.org/wiki/Lune',
            },
          },
          astroBody: Body.Moon,
          cameraDistance: { educ: 2, explo: exploCameraDistance(1_737) },
          loadPriority: 3,
        },
      },
    },

    mars: {
      kind: 'planet',
      radius: 0.53,
      rotationSpeed: _R(24.6229),
      orbitalColor: 0xe85d3f,
      textureResolutions: {
        surface: ['8k', '4k', '2k', '1k'],
      },
      realData: {
        sources: {
          radiusKm: measured('nssdca-fact-sheets'),
          distanceAU: measured('nssdca-fact-sheets'),
          orbitPeriodDays: measured('nssdca-fact-sheets'),
          massKg: measured('nssdca-fact-sheets'),
          gravity: measured('nssdca-fact-sheets'),
          meanTempC: measured('nssdca-fact-sheets'),
          rotationPeriod: measured('nssdca-fact-sheets'),
          moonCount: measured('nasa-science-mars-moons', {
            asOf: '2026-09-17',
          }),
          axialTilt: measured('nssdca-fact-sheets'),
        },
        radiusKm: 3_389.5,
        distanceAU: 1.52366231,
        orbitPeriodDays: 686.98,
        orbitalInclination: 1.85 * D2R,
        ascendingNode: 49.579 * D2R,
        axialTilt: 25.19 * D2R,
        massKg: 6.4169e23,
        gravity: 3.73,
        meanTempC: -65,
        moonCount: 2,
        description: {
          en: 'The red planet, tinted by iron oxide. It hosts Olympus Mons, the tallest volcano in the Solar System (~22 km).',
          fr: 'La planète rouge, teintée par l’oxyde de fer. Elle abrite Olympus Mons, le plus haut volcan du Système solaire (~22 km).',
        },
        wiki: {
          en: 'https://en.wikipedia.org/wiki/Mars',
          fr: 'https://fr.wikipedia.org/wiki/Mars_(plan%C3%A8te)',
        },
      },
      astroBody: Body.Mars,
      cameraDistance: { educ: 3, explo: exploCameraDistance(3_390) },
      loadPriority: 4,
      satellites: {
        phobos: {
          kind: 'moon',
          displayName: { en: 'Phobos', fr: 'Phobos' },
          radius: 0.08,
          rotationSpeed: _R(0.31891012704801625 * 24),
          orbitalColor: 0xb6a28d,
          fallbackColor: 0x8f7b69,
          frame: 'parentRelative',
          rotationBody: Body.Mars,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 6.269718996e-5,
            eccentricity: 0.0154998,
            inclinationRad: 27.4238 * D2R,
            ascendingNodeRad: 81.0943 * D2R,
            argPerihelionRad: 158.0363 * D2R,
            meanAnomalyAtEpochRad: 324.1419 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.04,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.0000006),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 11.08,
            distanceAU: kmToAu(9_378),
            orbitPeriodDays: 0.31891012704801625,
            orbitalInclination: 1.1 * D2R,
            ascendingNode: 169.2 * D2R,
            axialTilt: 0,
            massKg: massFromGM(0.0007087),
            gravity: gravityFromGM(0.0007087, 11.08),
            description: {
              en: "The larger and faster-orbiting of Mars' two small moons, shaped by ancient impacts.",
              fr: 'La plus grande et la plus rapide des deux petites lunes de Mars, façonnée par les impacts anciens.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Phobos_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Phobos_(lune)',
            },
          },
          cameraDistance: { educ: 0.35, explo: exploCameraDistance(11.08) },
          loadPriority: 11,
        },
        deimos: {
          kind: 'moon',
          displayName: { en: 'Deimos', fr: 'Déimos' },
          radius: 0.06,
          rotationSpeed: _R(1.2624407921255993 * 24),
          orbitalColor: 0xc1aa91,
          fallbackColor: 0x927d68,
          frame: 'parentRelative',
          rotationBody: Body.Mars,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.0001568163438,
            eccentricity: 0.000312172,
            inclinationRad: 24.1734 * D2R,
            ascendingNodeRad: 81.2256 * D2R,
            argPerihelionRad: 32.0428 * D2R,
            meanAnomalyAtEpochRad: 22.0077 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          textureResolutions: { surface: ['1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.24,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.0000028),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 6.2,
            distanceAU: kmToAu(23_459),
            orbitPeriodDays: 1.2624407921255993,
            orbitalInclination: 1.8 * D2R,
            ascendingNode: 54.3 * D2R,
            axialTilt: 0.9 * D2R,
            massKg: massFromGM(0.0000962),
            gravity: gravityFromGM(0.0000962, 6.2),
            description: {
              en: "Mars' smaller outer moon, a dark irregular body with a slow synchronous orbit.",
              fr: 'La plus petite lune extérieure de Mars, un corps sombre et irrégulier en orbite synchrone lente.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Deimos_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/D%C3%A9imos_(lune)',
            },
          },
          cameraDistance: { educ: 0.3, explo: exploCameraDistance(6.2) },
          loadPriority: 11,
        },
      },
    },

    jupiter: {
      kind: 'planet',
      radius: 4,
      rotationSpeed: _R(9.925),
      orbitalColor: 0xd89a5b,
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      realData: {
        sources: {
          radiusKm: measured('nssdca-fact-sheets', {
            detail: DETAIL.equatorialRadius1Bar,
          }),
          distanceAU: measured('nssdca-fact-sheets'),
          orbitPeriodDays: measured('nssdca-fact-sheets'),
          massKg: measured('nssdca-fact-sheets'),
          gravity: measured('nssdca-fact-sheets', {
            detail: DETAIL.meanGravity1Bar,
          }),
          meanTempC: measured('nssdca-fact-sheets', {
            detail: DETAIL.temperature1Bar,
          }),
          rotationPeriod: measured('nssdca-fact-sheets'),
          moonCount: measured('nasa-science-jupiter-moons', {
            asOf: '2026-08',
          }),
          axialTilt: measured('nssdca-fact-sheets'),
        },
        radiusKm: 71_492,
        distanceAU: 5.20336301,
        orbitPeriodDays: 4332.589,
        orbitalInclination: 1.304 * D2R,
        ascendingNode: 100.464 * D2R,
        axialTilt: 3.13 * D2R,
        massKg: 1.89813e27,
        gravity: 25.92,
        meanTempC: -110,
        // Chiffre DATÉ (`sources.moonCount.asOf`) : NASA Science l'annonce « as of August 2026 »,
        // alors que la fiche NSSDCA en était encore à 95. Les lots de lunes confirmées par l'UAI
        // le périment en quelques années ; `pnpm facts:snapshot` relit la page.
        moonCount: 115,
        description: {
          en: 'The giant of the Solar System, more massive than all the other planets combined. Its Great Red Spot is a storm centuries old.',
          fr: 'La géante du Système solaire, plus massive que toutes les autres planètes réunies. Sa Grande Tache rouge est une tempête vieille de plusieurs siècles.',
        },
        wiki: {
          en: 'https://en.wikipedia.org/wiki/Jupiter',
          fr: 'https://fr.wikipedia.org/wiki/Jupiter_(plan%C3%A8te)',
        },
      },
      astroBody: Body.Jupiter,
      cameraDistance: { educ: 25, explo: exploCameraDistance(71_492) },
      loadPriority: 5,
      satellites: {
        amalthea: {
          kind: 'moon',
          displayName: { en: 'Amalthea', fr: 'Amalthée' },
          frame: 'parentRelative',
          rotationBody: Body.Jupiter,
          radius: 0.06,
          rotationSpeed: _R(0.49817907177492277 * 24),
          orbitalColor: 0xa8544a,
          fallbackColor: 0x9c4a3c,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          // JPL Horizons osculating elements, epoch 2000-01-01.5 TDB (EPHEM_TYPE=ELEMENTS,
          // TLIST=2451545.0) — même méthode que les autres lunes de ce fichier. Vérifiée
          // cohérente avec la période réelle publiée (0.498 j).
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.001216649081,
            eccentricity: 0.00679747,
            inclinationRad: 2.2995 * D2R,
            ascendingNodeRad: 328.503 * D2R,
            argPerihelionRad: 235.7284 * D2R,
            meanAnomalyAtEpochRad: 357.0786 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          // Aucune mosaïque photo globale contrôlée n'existe côté USGS pour Amalthea (imagée
          // partiellement par Galileo, jamais assemblée en carte globale contrôlée) — vérifié
          // en direct (2026-08-26). Texture procédurale générée (voir texture-sources.json).
          textureResolutions: { surface: ['2k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 3,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00867),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 83.5,
            distanceAU: kmToAu(181_400),
            orbitPeriodDays: 0.49817907177492277,
            orbitalInclination: 2.442089133637652 * D2R,
            ascendingNode: 330.4106584847095 * D2R,
            axialTilt: 0,
            massKg: massFromGM(0.16456),
            gravity: gravityFromGM(0.16456, 83.5),
            description: {
              en: "Jupiter's reddest moon, tidally locked with its long axis always pointing at the planet, likely stained by sulfur from Io.",
              fr: 'La lune la plus rouge de Jupiter, verrouillée par effet de marée avec son grand axe toujours pointé vers la planète, probablement teintée par le soufre en provenance d’Io.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Amalthea_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Amalth%C3%A9e_(lune)',
            },
          },
          cameraDistance: { educ: 0.5, explo: exploCameraDistance(83.5) },
          loadPriority: 10,
        },
        io: {
          kind: 'moon',
          displayName: { fr: 'Io' },
          frame: 'parentRelative',
          relativeEphemeris: { kind: 'jupiterMoon', moon: 'io' },
          rotationBody: Body.Jupiter,
          radius: 0.13,
          rotationSpeed: _R(42.46),
          orbitalColor: 0xffc857,
          fallbackColor: 0xffc857,
          textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.5,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00135),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              axialTilt: NOT_YET_SOURCED,
              meanTempC: {
                en: 'NASA publishes a range, not a mean: about 80-85 K at night, 420-620 K over volcanic regions.',
                fr: 'La NASA publie une plage, pas une moyenne : environ 80-85 K la nuit, 420-620 K sur les zones volcaniques.',
              },
            },
            radiusKm: 1_821.49,
            // Masse et gravite derivees du GM publie par JPL SSD (ephemeride JUP365,
            // https://ssd.jpl.nasa.gov/sats/phys_par/) : m = GM/G, g = GM/R^2. Ni l'un ni
            // l'autre n'est saisi a la main.
            massKg: massFromGM(5959.91547),
            gravity: gravityFromGM(5959.91547, 1_821.49),
            distanceAU: kmToAu(421_800),
            orbitPeriodDays: 1.769,
            orbitalInclination: 0,
            ascendingNode: 0,
            axialTilt: 0,
            description: {
              en: 'The innermost Galilean moon, shaped by intense volcanic activity driven by Jupiter tides.',
              fr: 'La plus proche des lunes galiléennes, modelée par une activité volcanique intense entretenue par les marées de Jupiter.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Io_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Io_(lune)',
            },
          },
          cameraDistance: { educ: 1.2, explo: exploCameraDistance(1_821.6) },
          loadPriority: 11,
        },
        europa: {
          kind: 'moon',
          displayName: { fr: 'Europe' },
          frame: 'parentRelative',
          relativeEphemeris: { kind: 'jupiterMoon', moon: 'europa' },
          rotationBody: Body.Jupiter,
          radius: 0.12,
          rotationSpeed: _R(85.22),
          orbitalColor: 0xd9c7a4,
          fallbackColor: 0xd9c7a4,
          textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.3,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00181),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              axialTilt: NOT_YET_SOURCED,
              meanTempC: {
                en: 'Published range runs from about 50 K at the poles to about 140 K at the equator; no official mean exists.',
                fr: "Plage publiée d'environ 50 K aux pôles à environ 140 K à l'équateur ; aucune moyenne officielle n'existe.",
              },
            },
            radiusKm: 1_560.8,
            // Masse et gravite derivees du GM publie par JPL SSD (ephemeride JUP365,
            // https://ssd.jpl.nasa.gov/sats/phys_par/) : m = GM/G, g = GM/R^2. Ni l'un ni
            // l'autre n'est saisi a la main.
            massKg: massFromGM(3202.7121),
            gravity: gravityFromGM(3202.7121, 1_560.8),
            distanceAU: kmToAu(671_100),
            orbitPeriodDays: 3.551,
            orbitalInclination: 0,
            ascendingNode: 0,
            axialTilt: 0,
            description: {
              en: 'An icy moon with a smooth surface and strong evidence for a global subsurface ocean.',
              fr: 'Une lune glacée à la surface lisse, avec de fortes preuves de l’existence d’un océan souterrain global.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Europa_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Europe_(lune)',
            },
          },
          cameraDistance: { educ: 1.2, explo: exploCameraDistance(1_560.8) },
          loadPriority: 12,
        },
        ganymede: {
          kind: 'moon',
          displayName: { fr: 'Ganymède' },
          frame: 'parentRelative',
          relativeEphemeris: { kind: 'jupiterMoon', moon: 'ganymede' },
          rotationBody: Body.Jupiter,
          radius: 0.2,
          rotationSpeed: _R(171.7),
          orbitalColor: 0x9c8b78,
          fallbackColor: 0x9c8b78,
          textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 1.7,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00247),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              axialTilt: NOT_YET_SOURCED,
              meanTempC: {
                en: 'The NASA fact sheet gives "90 to 160 Kelvin" for daytime, without a mean.',
                fr: 'La fiche NASA donne « 90 to 160 Kelvin » en journée, sans moyenne.',
              },
            },
            radiusKm: 2_631.2,
            // Masse et gravite derivees du GM publie par JPL SSD (ephemeride JUP365,
            // https://ssd.jpl.nasa.gov/sats/phys_par/) : m = GM/G, g = GM/R^2. Ni l'un ni
            // l'autre n'est saisi a la main.
            massKg: massFromGM(9887.83275),
            gravity: gravityFromGM(9887.83275, 2_631.2),
            distanceAU: kmToAu(1_070_400),
            orbitPeriodDays: 7.155,
            orbitalInclination: 0,
            ascendingNode: 0,
            axialTilt: 0,
            description: {
              en: 'The largest moon in the Solar System, larger than Mercury, with its own intrinsic magnetic field.',
              fr: 'La plus grande lune du Système solaire, plus grande que Mercure, et dotée de son propre champ magnétique.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Ganymede_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Ganym%C3%A8de_(lune)',
            },
          },
          cameraDistance: { educ: 1.5, explo: exploCameraDistance(2_634.1) },
          loadPriority: 13,
        },
        callisto: {
          kind: 'moon',
          displayName: { fr: 'Callisto' },
          frame: 'parentRelative',
          relativeEphemeris: { kind: 'jupiterMoon', moon: 'callisto' },
          rotationBody: Body.Jupiter,
          radius: 0.18,
          rotationSpeed: _R(400.5),
          orbitalColor: 0x7c746f,
          fallbackColor: 0x7c746f,
          textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 1.5,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00324),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              axialTilt: NOT_YET_SOURCED,
              meanTempC: {
                en: 'Same as its neighbours: a published range, no single mean surface temperature.',
                fr: 'Même situation que ses voisines : une plage publiée, pas de température moyenne unique.',
              },
            },
            radiusKm: 2_410.3,
            // Masse et gravite derivees du GM publie par JPL SSD (ephemeride JUP365,
            // https://ssd.jpl.nasa.gov/sats/phys_par/) : m = GM/G, g = GM/R^2. Ni l'un ni
            // l'autre n'est saisi a la main.
            massKg: massFromGM(7179.2834),
            gravity: gravityFromGM(7179.2834, 2_410.3),
            distanceAU: kmToAu(1_882_700),
            orbitPeriodDays: 16.689,
            orbitalInclination: 0,
            ascendingNode: 0,
            axialTilt: 0,
            description: {
              en: 'The outermost Galilean moon, heavily cratered and likely hiding a deep salty ocean.',
              fr: 'La plus éloignée des lunes galiléennes, fortement cratérisée et susceptible d’abriter un océan salé profond.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Callisto_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Callisto_(moon)',
            },
          },
          cameraDistance: { educ: 1.5, explo: exploCameraDistance(2_410.3) },
          loadPriority: 14,
        },
      },
    },

    saturn: {
      kind: 'planet',
      displayName: { fr: 'Saturne' },
      radius: 3.5,
      rotationSpeed: _R(10.656),
      orbitalColor: 0xe7d28d,
      ring: {
        bodyName: 'saturn-ring',
        innerRadius: 1.5,
        outerRadius: 2.2,
        textureResolutions: ['8k', '4k', '2k', '1k'],
      },
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      realData: {
        sources: {
          radiusKm: measured('nssdca-fact-sheets', {
            detail: DETAIL.equatorialRadius1Bar,
          }),
          distanceAU: measured('nssdca-fact-sheets'),
          orbitPeriodDays: measured('nssdca-fact-sheets'),
          massKg: measured('nssdca-fact-sheets'),
          gravity: measured('nssdca-fact-sheets', {
            detail: DETAIL.meanGravity1Bar,
          }),
          meanTempC: measured('nssdca-fact-sheets', {
            detail: DETAIL.temperature1Bar,
          }),
          rotationPeriod: measured('nssdca-fact-sheets'),
          moonCount: measured('nasa-science-saturn-moons', { asOf: '2026-08' }),
          axialTilt: measured('nssdca-fact-sheets'),
        },
        radiusKm: 60_268,
        distanceAU: 9.53707032,
        orbitPeriodDays: 10755.699,
        orbitalInclination: 2.485 * D2R,
        ascendingNode: 113.665 * D2R,
        axialTilt: 26.73 * D2R,
        massKg: 5.6832e26,
        gravity: 11.19,
        meanTempC: -140,
        // Chiffre DATÉ, voir Jupiter. La page NASA Science porte encore « 274 » dans ses
        // métadonnées et « 293 … as of August 2026 » dans son texte : c'est la phrase datée qui
        // fait foi (`scripts/snapshot-fact-sources.mjs`).
        moonCount: 293,
        description: {
          en: 'Famous for its spectacular rings, made of billions of chunks of ice and rock. So low in density it would float on water.',
          fr: 'Célèbre pour ses anneaux spectaculaires, faits de milliards de blocs de glace et de roche. Si peu dense qu’elle flotterait sur l’eau.',
        },
        wiki: {
          en: 'https://en.wikipedia.org/wiki/Saturn',
          fr: 'https://fr.wikipedia.org/wiki/Saturne_(plan%C3%A8te)',
        },
      },
      astroBody: Body.Saturn,
      cameraDistance: { educ: 20, explo: exploCameraDistance(60_268) },
      loadPriority: 6,
      satellites: {
        enceladus: {
          kind: 'moon',
          displayName: { en: 'Enceladus', fr: 'Encelade' },
          radius: 0.12,
          rotationSpeed: _R(1.3702181029145903 * 24),
          orbitalColor: 0xdedbd4,
          fallbackColor: 0xc7c8c9,
          frame: 'parentRelative',
          rotationBody: Body.Saturn,
          // JPL SAT441 mean elements, epoch 2000-01-01.5 TDB.
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.001593781246,
            eccentricity: 0.00623192,
            inclinationRad: 28.0528 * D2R,
            ascendingNodeRad: 169.5148 * D2R,
            argPerihelionRad: 103.893 * D2R,
            meanAnomalyAtEpochRad: 8.9737 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          textureResolutions: { surface: ['1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.2,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00009),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 252.1,
            distanceAU: kmToAu(238_020),
            orbitPeriodDays: 1.3702181029145903,
            orbitalInclination: 0,
            ascendingNode: 0,
            axialTilt: 0,
            massKg: massFromGM(7.21037),
            gravity: gravityFromGM(7.21037, 252.1),
            description: {
              en: 'A bright icy moon with an active south-polar plume and a subsurface ocean.',
              fr: 'Une lune glacée très brillante, avec un panache actif au pôle sud et un océan souterrain.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Enceladus',
              fr: 'https://fr.wikipedia.org/wiki/Encelade_(lune)',
            },
          },
          cameraDistance: { educ: 0.8, explo: exploCameraDistance(252.1) },
          loadPriority: 8,
        },
        rhea: {
          kind: 'moon',
          displayName: { en: 'Rhea', fr: 'Rhéa' },
          radius: 0.2,
          rotationSpeed: _R(4.517502711107901 * 24),
          orbitalColor: 0xbcb9b1,
          fallbackColor: 0xa4a39e,
          frame: 'parentRelative',
          rotationBody: Body.Saturn,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          // JPL SAT441 mean elements, epoch 2000-01-01.5 TDB.
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.003524524486,
            eccentricity: 0.000535696,
            inclinationRad: 28.2425 * D2R,
            ascendingNodeRad: 170.0344 * D2R,
            argPerihelionRad: 179.3946 * D2R,
            meanAnomalyAtEpochRad: 169.1991 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          textureResolutions: { surface: ['1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.6,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00041),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 763.5,
            distanceAU: kmToAu(527_040),
            orbitPeriodDays: 4.517502711107901,
            orbitalInclination: 0.3 * D2R,
            ascendingNode: 133.7 * D2R,
            axialTilt: 0,
            massKg: massFromGM(153.94175),
            gravity: gravityFromGM(153.94175, 763.5),
            description: {
              en: "Saturn's second-largest moon, a heavily cratered world of bright water ice.",
              fr: "La deuxième plus grande lune de Saturne, un monde de glace d'eau très cratérisé.",
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Rhea_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Rh%C3%A9a_(lune)',
            },
          },
          cameraDistance: { educ: 1, explo: exploCameraDistance(763.5) },
          loadPriority: 8,
        },
        iapetus: {
          kind: 'moon',
          displayName: { en: 'Iapetus', fr: 'Japet' },
          radius: 0.18,
          rotationSpeed: _R(79.33010433489734 * 24),
          orbitalColor: 0x9b8d79,
          fallbackColor: 0x756e62,
          frame: 'parentRelative',
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          rotationBody: Body.Saturn,
          // JPL SAT441 mean elements, epoch 2000-01-01.5 TDB.
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.02378693598,
            eccentricity: 0.0289728,
            inclinationRad: 16.9971 * D2R,
            ascendingNodeRad: 138.8929 * D2R,
            argPerihelionRad: 230.7372 * D2R,
            meanAnomalyAtEpochRad: 97.8466 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          textureResolutions: { surface: ['4k', '2k', '1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 2.8,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00242),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 734.3,
            distanceAU: kmToAu(3_560_850),
            orbitPeriodDays: 79.33010433489734,
            orbitalInclination: 7.6 * D2R,
            ascendingNode: 86.5 * D2R,
            axialTilt: 0,
            massKg: massFromGM(120.51511),
            gravity: gravityFromGM(120.51511, 734.3),
            description: {
              en: 'A two-toned outer moon known for its dark leading hemisphere and equatorial ridge.',
              fr: 'Une lune extérieure bicolore, connue pour son hémisphère avant sombre et sa crête équatoriale.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Iapetus_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Japet_(lune)',
            },
          },
          cameraDistance: { educ: 1.2, explo: exploCameraDistance(734.3) },
          loadPriority: 8,
        },
        titan: {
          kind: 'moon',
          displayName: { en: 'Titan', fr: 'Titan' },
          radius: 0.55,
          rotationSpeed: _R(15.94546580124095 * 24),
          orbitalColor: 0xc78b57,
          fallbackColor: 0x9b6a45,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          frame: 'parentRelative',
          rotationBody: Body.Saturn,
          // JPL SAT441 mean elements, epoch 2000-01-01.5 TDB.
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.008170397946,
            eccentricity: 0.0290328,
            inclinationRad: 27.709 * D2R,
            ascendingNodeRad: 169.0774 * D2R,
            argPerihelionRad: 177.6352 * D2R,
            meanAnomalyAtEpochRad: 330.0425 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          textureResolutions: { surface: ['2k', '1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.02,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00025),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 2_574.76,
            distanceAU: kmToAu(1_221_870),
            orbitPeriodDays: 15.94546580124095,
            orbitalInclination: 0.3 * D2R,
            ascendingNode: 78.6 * D2R,
            axialTilt: 26.7 * D2R,
            massKg: massFromGM(8978.1371),
            gravity: gravityFromGM(8978.1371, 2_574.76),
            description: {
              en: "Saturn's largest moon, with a dense atmosphere and rivers, lakes, and seas of methane and ethane.",
              fr: "La plus grande lune de Saturne, avec une atmosphere dense et des rivieres, lacs et mers de methane et d'ethane.",
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Titan_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Titan_(lune)',
            },
          },
          cameraDistance: { educ: 2.5, explo: exploCameraDistance(2_574.76) },
          loadPriority: 7,
        },
        mimas: {
          kind: 'moon',
          displayName: { en: 'Mimas', fr: 'Mimas' },
          radius: 0.09,
          rotationSpeed: _R(0.9424243752169399 * 24),
          orbitalColor: 0xd9d6cd,
          fallbackColor: 0xcac8c2,
          frame: 'parentRelative',
          rotationBody: Body.Saturn,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          // JPL Horizons osculating elements, epoch 2000-01-01.5 TDB (EPHEM_TYPE=ELEMENTS,
          // TLIST=2451545.0) — même méthode que pour les autres lunes de ce fichier.
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.001243567234,
            eccentricity: 0.0212823,
            inclinationRad: 29.6251 * D2R,
            ascendingNodeRad: 169.6602 * D2R,
            argPerihelionRad: 256.0964 * D2R,
            meanAnomalyAtEpochRad: 50.0846 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          // Aucune mosaïque photo globale contrôlée n'existe côté USGS pour Mimas (seulement
          // relief ombré et carte picturale, pas une texture réelle) — vérifié en direct
          // (2026-08-26, voir scripts/texture-sources.json). Texture procédurale générée,
          // paramétrée sur le cratère Herschel réel (~1/3 du diamètre, pic central).
          textureResolutions: { surface: ['2k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.4,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00014),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 198.2,
            distanceAU: kmToAu(185_520),
            orbitPeriodDays: 0.9424243752169399,
            orbitalInclination: 27.00265761372071 * D2R,
            ascendingNode: 172.0569449519339 * D2R,
            axialTilt: 0,
            massKg: massFromGM(2.50349),
            gravity: gravityFromGM(2.50349, 198.2),
            description: {
              en: "Saturn's closest major moon, dominated by the giant Herschel crater that gives it a Death-Star silhouette.",
              fr: 'La lune majeure la plus proche de Saturne, dominée par le cratère géant Herschel qui lui donne une silhouette d’Étoile Noire.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Mimas_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Mimas_(lune)',
            },
          },
          cameraDistance: { educ: 0.6, explo: exploCameraDistance(198.2) },
          loadPriority: 20,
        },
        tethys: {
          kind: 'moon',
          displayName: { en: 'Tethys', fr: 'Téthys' },
          radius: 0.16,
          rotationSpeed: _R(1.8878020501022104 * 24),
          orbitalColor: 0xe3e0d6,
          fallbackColor: 0xd8d5cc,
          frame: 'parentRelative',
          rotationBody: Body.Saturn,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.00197185976,
            eccentricity: 0.000999015,
            inclinationRad: 27.2076 * D2R,
            ascendingNodeRad: 171.0212 * D2R,
            argPerihelionRad: 116.0616 * D2R,
            meanAnomalyAtEpochRad: 5.1256 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          textureResolutions: { surface: ['1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.6,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00031),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 531.1,
            distanceAU: kmToAu(294_660),
            orbitPeriodDays: 1.8878020501022104,
            orbitalInclination: 27.22072909012297 * D2R,
            ascendingNode: 167.9977256763769 * D2R,
            axialTilt: 0,
            massKg: massFromGM(41.21353),
            gravity: gravityFromGM(41.21353, 531.1),
            description: {
              en: 'An icy moon almost as bright as fresh snow, scarred by the vast Ithaca Chasma canyon and the Odysseus impact basin.',
              fr: 'Une lune glacée presque aussi brillante que de la neige fraîche, marquée par le vaste canyon Ithaca Chasma et le bassin d’impact Odysseus.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Tethys_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/T%C3%A9thys_(lune)',
            },
          },
          cameraDistance: { educ: 1, explo: exploCameraDistance(531.1) },
          loadPriority: 21,
        },
        dione: {
          kind: 'moon',
          displayName: { en: 'Dione', fr: 'Dioné' },
          radius: 0.17,
          rotationSpeed: _R(2.7369155124886273 * 24),
          orbitalColor: 0xcac7bd,
          fallbackColor: 0xc9c7bf,
          frame: 'parentRelative',
          rotationBody: Body.Saturn,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.002524502777,
            eccentricity: 0.00278575,
            inclinationRad: 28.0246 * D2R,
            ascendingNodeRad: 169.5295 * D2R,
            argPerihelionRad: 259.2396 * D2R,
            meanAnomalyAtEpochRad: 27.6597 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          textureResolutions: { surface: ['1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.4,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00005),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 561.4,
            distanceAU: kmToAu(377_400),
            orbitPeriodDays: 2.7369155124886273,
            orbitalInclination: 28.04139510566285 * D2R,
            ascendingNode: 169.470196786071 * D2R,
            axialTilt: 0,
            massKg: massFromGM(73.11607),
            gravity: gravityFromGM(73.11607, 561.4),
            description: {
              en: 'A dense icy moon with bright wispy fractures cutting across its darker, cratered trailing hemisphere.',
              fr: 'Une lune glacée dense, striée de fractures brillantes qui traversent son hémisphère arrière plus sombre et cratérisé.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Dione_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Dion%C3%A9_(lune)',
            },
          },
          cameraDistance: { educ: 1, explo: exploCameraDistance(561.4) },
          loadPriority: 22,
        },
        hyperion: {
          kind: 'moon',
          displayName: { en: 'Hyperion', fr: 'Hypérion' },
          radius: 0.08,
          // Rotation CHAOTIQUE, pas synchrone (résonance orbitale 4:3 avec Titan + forme
          // très irrégulière) — contrairement à toutes les autres lunes de ce fichier, il n'y
          // a pas de "vraie" période de rotation fixe. Valeur approximative (période moyenne
          // observée), documentée comme telle plutôt que présentée comme une synchronisation
          // réelle.
          rotationSpeed: _R(13 * 24),
          orbitalColor: 0xa08670,
          fallbackColor: 0x8a7060,
          frame: 'parentRelative',
          rotationBody: Body.Saturn,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.009868051277,
            eccentricity: 0.0947541,
            inclinationRad: 27.0526 * D2R,
            ascendingNodeRad: 169.4913 * D2R,
            argPerihelionRad: 81.9189 * D2R,
            meanAnomalyAtEpochRad: 276.1022 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          // Aucune mosaïque globale : Hyperion est trop irrégulier (éponge poreuse
          // ~180×133×103 km) pour qu'une "carte globale" ait vraiment un sens — vérifié en
          // direct (2026-08-26, voir texture-sources.json). Texture procédurale générée,
          // paramétrée sur son aspect "éponge" réel (cratères denses, sans bourrelet d'éjecta).
          textureResolutions: { surface: ['2k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 4,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.00005),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
              rotationPeriod: {
                en: 'NASA NSSDCA lists Hyperion’s rotation as chaotic: it tumbles without a fixed period.',
                fr: 'La NASA (NSSDCA) classe la rotation d’Hypérion comme chaotique : elle bascule sans période fixe.',
              },
            },
            radiusKm: 135,
            distanceAU: kmToAu(1_500_930),
            orbitPeriodDays: 21.27677790839671,
            orbitalInclination: 27.20902903280515 * D2R,
            ascendingNode: 168.305013991762 * D2R,
            axialTilt: 0,
            massKg: massFromGM(0.37049),
            gravity: gravityFromGM(0.37049, 135),
            description: {
              en: 'A spongy, porous outer moon tumbling chaotically through space: its rotation never settles into a fixed period.',
              fr: 'Une lune extérieure spongieuse et poreuse, qui bascule de façon chaotique dans l’espace : sa rotation ne se stabilise jamais sur une période fixe.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Hyperion_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Hyp%C3%A9rion_(lune)',
            },
          },
          cameraDistance: { educ: 0.6, explo: exploCameraDistance(135) },
          loadPriority: 23,
        },
      },
    },
    uranus: {
      kind: 'planet',
      radius: 2,
      rotationSpeed: _R(17.24),
      orbitalColor: 0x69d6d3,
      textureResolutions: { surface: ['2k', '1k'] },
      realData: {
        sources: {
          radiusKm: measured('nssdca-fact-sheets', {
            detail: DETAIL.equatorialRadius1Bar,
          }),
          distanceAU: measured('nssdca-fact-sheets'),
          orbitPeriodDays: measured('nssdca-fact-sheets'),
          massKg: measured('nssdca-fact-sheets'),
          gravity: measured('nssdca-fact-sheets', {
            detail: DETAIL.meanGravity1Bar,
          }),
          meanTempC: measured('nssdca-fact-sheets', {
            detail: DETAIL.temperature1Bar,
          }),
          rotationPeriod: measured('nssdca-fact-sheets'),
          moonCount: measured('nasa-science-uranus-moons', { asOf: '2026-08' }),
          axialTilt: measured('nssdca-fact-sheets'),
        },
        radiusKm: 25_559,
        distanceAU: 19.19126393,
        orbitPeriodDays: 30685.4,
        orbitalInclination: 0.773 * D2R,
        ascendingNode: 74.006 * D2R,
        axialTilt: 97.77 * D2R,
        massKg: 8.6811e25,
        gravity: 9.01,
        meanTempC: -195,
        moonCount: 29,
        description: {
          en: 'The ice giant tipped on its side, with an axis leaning at 98°, so it rolls along its orbit. Each season lasts 21 years.',
          fr: 'La géante de glace couchée sur le côté, avec un axe penché à 98°, si bien qu’elle roule le long de son orbite. Chaque saison dure 21 ans.',
        },
        wiki: {
          en: 'https://en.wikipedia.org/wiki/Uranus',
          fr: 'https://fr.wikipedia.org/wiki/Uranus_(plan%C3%A8te)',
        },
      },
      astroBody: Body.Uranus,
      cameraDistance: { educ: 10, explo: exploCameraDistance(25_559) },
      loadPriority: 9,
      satellites: {
        miranda: {
          kind: 'moon',
          displayName: { en: 'Miranda', fr: 'Miranda' },
          radius: 0.1,
          rotationSpeed: _R(1.4134794388946823 * 24),
          orbitalColor: 0xb7b5ae,
          fallbackColor: 0xa8a6a0,
          frame: 'parentRelative',
          rotationBody: Body.Uranus,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          // JPL Horizons osculating elements, epoch 2000-01-01.5 TDB (EPHEM_TYPE=ELEMENTS,
          // TLIST=2451545.0), même méthode que les lunes de Saturne. L'inclinaison ~97° n'est
          // pas une orbite rétrograde : c'est l'écliptique qui est très inclinée par rapport
          // au plan équatorial d'Uranus (axe couché à 97,77°, voir realData.axialTilt
          // d'Uranus) — ces lunes orbitent normalement dans ce plan équatorial.
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.0008681342197,
            eccentricity: 0.0011455,
            inclinationRad: 99.1894 * D2R,
            ascendingNodeRad: 163.4238 * D2R,
            argPerihelionRad: 40.5448 * D2R,
            meanAnomalyAtEpochRad: 217.1554 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          // Aucune mosaïque globale contrôlée : Voyager 2 (survol unique, 1986) n'a imagé en
          // détail qu'environ la moitié de Miranda — vérifié en direct (2026-08-26, voir
          // texture-sources.json). Texture procédurale générée, avec de larges plages de
          // terrain distinct approximant ses coronae réelles (Inverness/Arden/Elsinore).
          textureResolutions: { surface: ['2k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.7,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.2),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 235.8,
            distanceAU: kmToAu(129_900),
            orbitPeriodDays: 1.4134794388946823,
            orbitalInclination: 97.25415391960598 * D2R,
            ascendingNode: 172.0875833032825 * D2R,
            axialTilt: 0,
            massKg: massFromGM(4.3),
            gravity: gravityFromGM(4.3, 235.8),
            description: {
              en: "Uranus's smallest major moon, a bizarre patchwork of giant fault canyons and terraced 'racetrack' features up to 20 km deep.",
              fr: 'La plus petite grande lune d’Uranus, un patchwork étrange de canyons de faille géants et de formations en terrasses profondes de jusqu’à 20 km.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Miranda_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Miranda_(lune)',
            },
          },
          cameraDistance: { educ: 0.7, explo: exploCameraDistance(235.8) },
          loadPriority: 24,
        },
        ariel: {
          kind: 'moon',
          displayName: { en: 'Ariel', fr: 'Ariel' },
          radius: 0.17,
          rotationSpeed: _R(2.520379095408933 * 24),
          orbitalColor: 0xc7c5bd,
          fallbackColor: 0xb9b8b2,
          frame: 'parentRelative',
          rotationBody: Body.Uranus,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.001276431879,
            eccentricity: 0.000467748,
            inclinationRad: 97.7152 * D2R,
            ascendingNodeRad: 167.6645 * D2R,
            argPerihelionRad: 247.4797 * D2R,
            meanAnomalyAtEpochRad: 126.517 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          // Aucune mosaïque globale contrôlée n'existe côté USGS pour Ariel — vérifié en direct
          // (2026-08-26, voir texture-sources.json). Texture procédurale générée : peu de
          // grands cratères + beaucoup de petits (Voyager 2 imaging science, 1986).
          textureResolutions: { surface: ['2k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 0.6,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(1.4),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 578.9,
            distanceAU: kmToAu(190_900),
            orbitPeriodDays: 2.520379095408933,
            orbitalInclination: 97.719319228073 * D2R,
            ascendingNode: 167.6455486422633 * D2R,
            axialTilt: 0,
            massKg: massFromGM(83.5),
            gravity: gravityFromGM(83.5, 578.9),
            description: {
              en: "The brightest of Uranus's major moons, with the youngest surface and long canyons that may hold traces of past cryovolcanic flows.",
              fr: 'La plus brillante des grandes lunes d’Uranus, avec la surface la plus jeune et de longs canyons qui pourraient garder la trace d’anciens écoulements cryovolcaniques.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Ariel_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Ariel_(lune)',
            },
          },
          cameraDistance: { educ: 1, explo: exploCameraDistance(578.9) },
          loadPriority: 25,
        },
        umbriel: {
          kind: 'moon',
          displayName: { en: 'Umbriel', fr: 'Umbriel' },
          radius: 0.17,
          rotationSpeed: _R(4.1441774518183285 * 24),
          orbitalColor: 0x716f6b,
          fallbackColor: 0x5c5a58,
          frame: 'parentRelative',
          rotationBody: Body.Uranus,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.001778187188,
            eccentricity: 0.00412565,
            inclinationRad: 97.7115 * D2R,
            ascendingNodeRad: 167.7242 * D2R,
            argPerihelionRad: 53.7962 * D2R,
            meanAnomalyAtEpochRad: 295.8029 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          // Aucune mosaïque globale contrôlée n'existe côté USGS pour Umbriel — vérifié en
          // direct (2026-08-26, voir texture-sources.json). Texture procédurale générée, avec
          // un unique point clair approximant le cratère Wunda réel (plancher/parois clairs,
          // pôle nord).
          textureResolutions: { surface: ['2k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 2.8,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(1.9),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 584.7,
            distanceAU: kmToAu(266_000),
            orbitPeriodDays: 4.1441774518183285,
            orbitalInclination: 97.66606723745439 * D2R,
            ascendingNode: 167.6381821495947 * D2R,
            axialTilt: 0,
            massKg: massFromGM(85.1),
            gravity: gravityFromGM(85.1, 584.7),
            description: {
              en: 'The darkest of the five major Uranian moons, heavily cratered with almost no sign of resurfacing since it formed.',
              fr: 'La plus sombre des cinq grandes lunes d’Uranus, fortement cratérisée et presque sans trace de resurfaçage depuis sa formation.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Umbriel_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Umbriel_(lune)',
            },
          },
          cameraDistance: { educ: 1, explo: exploCameraDistance(584.7) },
          loadPriority: 26,
        },
        titania: {
          kind: 'moon',
          displayName: { en: 'Titania', fr: 'Titania' },
          radius: 0.21,
          rotationSpeed: _R(8.705870132517225 * 24),
          orbitalColor: 0xaba89f,
          fallbackColor: 0x9a9893,
          frame: 'parentRelative',
          rotationBody: Body.Uranus,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.002916024747,
            eccentricity: 0.00242536,
            inclinationRad: 97.7633 * D2R,
            ascendingNodeRad: 167.6422 * D2R,
            argPerihelionRad: 263.5451 * D2R,
            meanAnomalyAtEpochRad: 265.2945 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          // Aucune mosaïque globale contrôlée n'existe côté USGS pour Titania — vérifié en
          // direct (2026-08-26, voir texture-sources.json). Texture procédurale générée
          // (cratérisation modérée seule — le générateur ne modélise pas les réseaux de
          // canyons comme Messina Chasma, voir le commentaire sur cette limite dans
          // scripts/generate-procedural-textures.mjs).
          textureResolutions: { surface: ['2k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 1.8,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(4.1),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 788.9,
            distanceAU: kmToAu(436_300),
            orbitPeriodDays: 8.705870132517225,
            orbitalInclination: 97.818368383812 * D2R,
            ascendingNode: 167.6178145945835 * D2R,
            axialTilt: 0,
            massKg: massFromGM(226.9),
            gravity: gravityFromGM(226.9, 788.9),
            description: {
              en: "Uranus's largest moon, featuring one of the solar system's biggest known fault canyons, Messina Chasma.",
              fr: 'La plus grande lune d’Uranus, avec l’un des plus grands canyons de faille connus du système solaire, Messina Chasma.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Titania_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Titania_(lune)',
            },
          },
          cameraDistance: { educ: 1.2, explo: exploCameraDistance(788.4) },
          loadPriority: 27,
        },
        oberon: {
          kind: 'moon',
          displayName: { en: 'Oberon', fr: 'Obéron' },
          radius: 0.2,
          rotationSpeed: _R(13.46323932743319 * 24),
          orbitalColor: 0x9c9188,
          fallbackColor: 0x8f8681,
          frame: 'parentRelative',
          rotationBody: Body.Uranus,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.003901129947,
            eccentricity: 0.00202223,
            inclinationRad: 97.9056 * D2R,
            ascendingNodeRad: 167.7098 * D2R,
            argPerihelionRad: 155.1112 * D2R,
            meanAnomalyAtEpochRad: 297.1523 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          // Aucune mosaïque globale contrôlée n'existe côté USGS pour Obéron — vérifié en
          // direct (2026-08-26, voir texture-sources.json). Texture procédurale générée :
          // surface sombre, cratérisation dense avec quelques grands bassins à pic central.
          textureResolutions: { surface: ['2k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 2.6,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(5.8),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 761.4,
            distanceAU: kmToAu(583_500),
            orbitPeriodDays: 13.46323932743319,
            orbitalInclination: 97.87585296035932 * D2R,
            ascendingNode: 167.7555265636234 * D2R,
            axialTilt: 0,
            massKg: massFromGM(205.3),
            gravity: gravityFromGM(205.3, 761.4),
            description: {
              en: "The outermost of Uranus's major moons, its heavily cratered, reddish surface scarred by one of the tallest known mountains in the solar system.",
              fr: 'La plus extérieure des grandes lunes d’Uranus, à la surface rougeâtre fortement cratérisée, marquée par l’une des plus hautes montagnes connues du système solaire.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Oberon_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Ob%C3%A9ron_(lune)',
            },
          },
          cameraDistance: { educ: 1.2, explo: exploCameraDistance(761.4) },
          loadPriority: 28,
        },
      },
    },

    neptune: {
      kind: 'planet',
      radius: 1.9,
      rotationSpeed: _R(16.11),
      orbitalColor: 0x647cff,
      textureResolutions: { surface: ['2k', '1k'] },
      realData: {
        sources: {
          radiusKm: measured('nssdca-fact-sheets', {
            detail: DETAIL.equatorialRadius1Bar,
          }),
          distanceAU: measured('nssdca-fact-sheets'),
          orbitPeriodDays: measured('nssdca-fact-sheets'),
          massKg: measured('nssdca-fact-sheets'),
          gravity: measured('nssdca-fact-sheets', {
            detail: DETAIL.meanGravity1Bar,
          }),
          meanTempC: measured('nssdca-fact-sheets', {
            detail: DETAIL.temperature1Bar,
          }),
          rotationPeriod: measured('nssdca-fact-sheets'),
          moonCount: measured('nasa-science-neptune-moons', {
            asOf: '2026-09-17',
          }),
          axialTilt: measured('nssdca-fact-sheets'),
        },
        radiusKm: 24_764,
        distanceAU: 30.06896348,
        orbitPeriodDays: 60189.018,
        orbitalInclination: 1.77 * D2R,
        ascendingNode: 131.784 * D2R,
        axialTilt: 28.32 * D2R,
        massKg: 1.02409e26,
        gravity: 11.27,
        meanTempC: -200,
        moonCount: 16,
        description: {
          en: 'The most distant planet, invisible to the naked eye and found by calculation. Its winds reach 2,000 km/h, the fiercest in the Solar System.',
          fr: 'La planète la plus lointaine, invisible à l’œil nu et découverte par le calcul. Ses vents atteignent 2 000 km/h, les plus violents du Système solaire.',
        },
        wiki: {
          en: 'https://en.wikipedia.org/wiki/Neptune',
          fr: 'https://fr.wikipedia.org/wiki/Neptune_(plan%C3%A8te)',
        },
      },
      astroBody: Body.Neptune,
      cameraDistance: { educ: 10, explo: exploCameraDistance(24_764) },
      loadPriority: 10,
      satellites: {
        triton: {
          kind: 'moon',
          displayName: { en: 'Triton', fr: 'Triton' },
          radius: 0.28,
          rotationSpeed: -_R(5.876844606364144 * 24),
          orbitalColor: 0x9dc4cf,
          fallbackColor: 0x7796a2,
          frame: 'parentRelative',
          rotationBody: Body.Neptune,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.002372182357,
            eccentricity: 0.000278328,
            inclinationRad: 129.148 * D2R,
            ascendingNodeRad: 222.6618 * D2R,
            argPerihelionRad: 11.0207 * D2R,
            meanAnomalyAtEpochRad: 337.3679 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 2.4,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(0.61603),
              }),
              gravity: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.gravityFromGM,
              }),
              rotationPeriod: derived('nssdca-fact-sheets', {
                detail: DETAIL.synchronousRotation,
              }),
            },
            unknown: {
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 1_352.6,
            distanceAU: kmToAu(354_760),
            orbitPeriodDays: 5.876844606364144,
            orbitalInclination: 157.3 * D2R,
            ascendingNode: 178.1 * D2R,
            axialTilt: 0.4 * D2R,
            massKg: massFromGM(1428.49546),
            gravity: gravityFromGM(1428.49546, 1_352.6),
            description: {
              en: "Neptune's largest moon and the Solar System's only major retrograde satellite, with nitrogen geysers.",
              fr: "La plus grande lune de Neptune et la seule grande lune rétrograde du Système solaire, avec des geysers d'azote.",
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Triton_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Triton_(lune)',
            },
          },
          cameraDistance: { educ: 1.5, explo: exploCameraDistance(1_352.6) },
          loadPriority: 12,
        },
        proteus: {
          kind: 'moon',
          displayName: { en: 'Proteus', fr: 'Protée' },
          radius: 0.12,
          rotationSpeed: _R(1.1223147385935797 * 24),
          orbitalColor: 0x6a6a6a,
          fallbackColor: 0x4a4a4a,
          frame: 'parentRelative',
          rotationBody: Body.Neptune,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          // JPL Horizons osculating elements, epoch 2000-01-01.5 TDB — cohérents avec la
          // période réelle publiée (1.122 j).
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.0007866692793,
            eccentricity: 0.000438469,
            inclinationRad: 29.0597 * D2R,
            ascendingNodeRad: 48.7125 * D2R,
            argPerihelionRad: 43.5662 * D2R,
            meanAnomalyAtEpochRad: 76.5645 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          // Aucune mosaïque photo globale contrôlée n'existe côté USGS pour Protée (une seule
          // face imagée par Voyager 2, jamais assemblée en carte globale contrôlée) — vérifié
          // en direct (2026-08-26). Texture procédurale générée, paramétrée sur le cratère
          // Pharos réel (~250 km, plus de la moitié du diamètre de Protée, dôme central).
          textureResolutions: { surface: ['2k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 8,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              massKg: derived('jpl-ssd-satellite-physical-parameters', {
                detail: DETAIL.massFromGM,
                uncertainty: massFromGM(2.4207),
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
            radiusKm: 208,
            distanceAU: kmToAu(117_647),
            orbitPeriodDays: 1.1223147385935797,
            orbitalInclination: 28.99163681179519 * D2R,
            ascendingNode: 48.27950205867285 * D2R,
            axialTilt: 0,
            massKg: massFromGM(2.58342),
            gravity: gravityFromGM(2.58342, 208),
            description: {
              en: "Neptune's second-largest moon, an irregularly shaped, tidally locked body near the size limit a body of its density can hold without becoming round.",
              fr: 'La deuxième plus grande lune de Neptune, un corps de forme irrégulière verrouillé par effet de marée, proche de la taille limite qu’un corps de sa densité peut atteindre sans devenir sphérique.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Proteus_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/Prot%C3%A9e_(lune)',
            },
          },
          cameraDistance: { educ: 1.2, explo: exploCameraDistance(208) },
          loadPriority: 13,
        },
        nereid: {
          kind: 'moon',
          displayName: { en: 'Nereid', fr: 'Néréide' },
          radius: 0.11,
          rotationSpeed: _R(11.594),
          orbitalColor: 0x8c8c8c,
          fallbackColor: 0x8c8c8c,
          frame: 'parentRelative',
          rotationBody: Body.Neptune,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          // JPL Horizons osculating elements, epoch 2000-01-01.5 TDB — cohérents avec la
          // période réelle publiée (~360.13 j). Rotation NON verrouillée : 11.594 h, mesure
          // bien déterminée par Kepler (2016) — sans lien avec sa période orbitale.
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.03683832723,
            eccentricity: 0.74552,
            inclinationRad: 5.0266 * D2R,
            ascendingNodeRad: 319.233 * D2R,
            argPerihelionRad: 296.8466 * D2R,
            meanAnomalyAtEpochRad: 349.0552 * D2R,
            epoch: new Date('2025-12-31T00:00:00.000Z'),
          },
          // Aucune mosaïque photo globale contrôlée n'existe côté USGS pour Néréide (résolution
          // Voyager 2 de ~43 km/pixel seulement — insuffisant pour une carte globale) — vérifié
          // en direct (2026-08-26). Texture procédurale générée, avec un contraste hémisphérique
          // doux approximant l'hémisphère sombre réel évoqué pour expliquer sa variabilité
          // photométrique (Schaefer & Schaefer 2000).
          textureResolutions: { surface: ['2k'] },
          realData: {
            sources: {
              radiusKm: measured('jpl-ssd-satellite-physical-parameters', {
                uncertainty: 25,
              }),
              distanceAU: measured('nssdca-fact-sheets'),
              orbitPeriodDays: measured('nssdca-fact-sheets'),
              rotationPeriod: measured('kiss-2016-nereid', {
                uncertainty: 0.017,
              }),
            },
            unknown: {
              massKg: NOT_YET_SOURCED,
              gravity: NOT_YET_SOURCED,
              meanTempC: NOT_YET_SOURCED,
              axialTilt: NOT_YET_SOURCED,
            },
            radiusKm: 170,
            distanceAU: kmToAu(5_513_400),
            orbitPeriodDays: 359.879914569329,
            orbitalInclination: 5.060553241702044 * D2R,
            ascendingNode: 319.5912156886533 * D2R,
            axialTilt: 0,
            massKg: 3.1e19,
            gravity: 0.0716,
            description: {
              en: 'A small, distant moon with the second-most eccentric orbit of any known moon, likely a captured object rather than one formed alongside Neptune.',
              fr: 'Une petite lune lointaine dotée de l’orbite la plus excentrique parmi les lunes connues après une autre, probablement un objet capturé plutôt que formé avec Neptune.',
            },
            wiki: {
              en: 'https://en.wikipedia.org/wiki/Nereid_(moon)',
              fr: 'https://fr.wikipedia.org/wiki/N%C3%A9r%C3%A9ide_(lune)',
            },
          },
          cameraDistance: { educ: 1.2, explo: exploCameraDistance(170) },
          loadPriority: 14,
        },
      },
    },

    // Petits corps (astéroïdes, comètes, planètes naines) — positionnés par éléments
    // orbitaux képlériens, définis dans `smallBodies.ts`. Fusionnés ici pour dériver comme
    // les autres corps (position instantanée, label Explo). Les corps disposant d'une
    // texture locale ont aussi un mesh et deviennent navigables dans les deux modes.
    ...SMALL_BODIES,
  },
};

// Dérive les chemins de texture depuis la clé du corps + les couches déclarées dans
// `textureResolutions` (nommage snake_case `{body}/{body}_{layer}`). Aucun chemin n'est
// écrit à la main dans le catalogue ci-dessus : c'est `catalog.texturePath` qui fait foi.
forEachBody(CELESTIAL_CONFIG, ({ name, config }) => {
  config.textures = deriveTextures(name, config);
  if (config.ring && !config.ring.textures) {
    config.ring.textures = ringTexturePath(name);
  }
});

// Fail-fast : un nom en doublon (corps ou satellite) écraserait silencieusement une entrée.
assertUniqueBodyNames(CELESTIAL_CONFIG);
// Fail-fast: a body without fallback, LOD or safe asset path must fail at startup.
assertValidCelestialCatalog(CELESTIAL_CONFIG);
