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
import {
  assertUniqueBodyNames,
  deriveTextures,
  forEachBody,
  ringTexturePath,
} from './catalog';
import { assertValidCelestialCatalog } from './catalogValidation';
import { SMALL_BODIES } from './smallBodies';

// Vitesse de rotation axiale — rad / seconde de simulation.
const _R = (hours: number): number => (Math.PI * 2) / (hours * 3_600);

// Degrés → radians pour les éléments orbitaux.
const D2R = Math.PI / 180;

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
      rotationSpeed: _R(609.6),
      orbitalColor: 0x000000,
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      realData: {
        radiusKm: 695_700,
        axialTilt: 7.25 * D2R,
        massKg: 1.989e30,
        gravity: 274,
        meanTempC: 5505,
        moonCount: 8,
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
        radiusKm: 2_440,
        distanceAU: 0.387,
        orbitPeriodDays: 87.97,
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
        radiusKm: 6_052,
        distanceAU: 0.723,
        orbitPeriodDays: 224.7,
        orbitalInclination: 3.395 * D2R,
        ascendingNode: 76.68 * D2R,
        axialTilt: 177.36 * D2R,
        massKg: 4.867e24,
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
        clouds: ['8k', '4k', '2k', '1k'],
        spec: ['8k', '4k', '2k', '1k'],
        lights: ['8k', '4k', '2k', '1k'],
      },
      realData: {
        radiusKm: 6_371,
        distanceAU: 1.0,
        orbitPeriodDays: 365.25,
        orbitalInclination: 0,
        ascendingNode: 0,
        axialTilt: 23.44 * D2R,
        massKg: 5.972e24,
        gravity: 9.81,
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
            radiusKm: 1_737,
            distanceAU: 0.00257,
            orbitPeriodDays: 27.32,
            orbitalInclination: 5.145 * D2R,
            ascendingNode: 0,
            axialTilt: 6.68 * D2R,
            massKg: 7.342e22,
            gravity: 1.62,
            meanTempC: -20,
            moonCount: 0,
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
        radiusKm: 3_390,
        distanceAU: 1.524,
        orbitPeriodDays: 686.97,
        orbitalInclination: 1.85 * D2R,
        ascendingNode: 49.579 * D2R,
        axialTilt: 25.19 * D2R,
        massKg: 6.417e23,
        gravity: 3.71,
        meanTempC: -63,
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
          rotationSpeed: _R(7.6488),
          orbitalColor: 0xb6a28d,
          fallbackColor: 0x8f7b69,
          frame: 'parentRelative',
          rotationBody: Body.Mars,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.0000626680043,
            eccentricity: 0.015,
            inclinationRad: 1.1 * D2R,
            ascendingNodeRad: 169.2 * D2R,
            argPerihelionRad: 216.3 * D2R,
            meanAnomalyAtEpochRad: 189.7 * D2R,
            epoch: new Date('2000-01-01T12:00:00Z'),
          },
          textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
          realData: {
            radiusKm: 11.08,
            distanceAU: 0.0000626680043,
            orbitPeriodDays: 0.3187,
            orbitalInclination: 1.1 * D2R,
            ascendingNode: 169.2 * D2R,
            axialTilt: 0,
            massKg: 1.0659e16,
            gravity: 0.0057,
            meanTempC: -40,
            moonCount: 0,
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
          rotationSpeed: _R(30.3),
          orbitalColor: 0xc1aa91,
          fallbackColor: 0x927d68,
          frame: 'parentRelative',
          rotationBody: Body.Mars,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.00015680036,
            eccentricity: 0,
            inclinationRad: 1.8 * D2R,
            ascendingNodeRad: 54.3 * D2R,
            argPerihelionRad: 0,
            meanAnomalyAtEpochRad: 205 * D2R,
            epoch: new Date('2000-01-01T12:00:00Z'),
          },
          textureResolutions: { surface: ['1k'] },
          realData: {
            radiusKm: 6.2,
            distanceAU: 0.00015680036,
            orbitPeriodDays: 1.2625,
            orbitalInclination: 1.8 * D2R,
            ascendingNode: 54.3 * D2R,
            axialTilt: 0.9 * D2R,
            massKg: 1.4762e15,
            gravity: 0.003,
            meanTempC: -40,
            moonCount: 0,
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
      rotationSpeed: _R(9.9259),
      orbitalColor: 0xd89a5b,
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      realData: {
        radiusKm: 71_492,
        distanceAU: 5.203,
        orbitPeriodDays: 4332.59,
        orbitalInclination: 1.304 * D2R,
        ascendingNode: 100.464 * D2R,
        axialTilt: 3.13 * D2R,
        massKg: 1.898e27,
        gravity: 24.79,
        meanTempC: -108,
        moonCount: 95,
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
            radiusKm: 1_821.6,
            distanceAU: 0.002819,
            orbitPeriodDays: 1.769,
            orbitalInclination: 0,
            ascendingNode: 0,
            axialTilt: 0,
            moonCount: 0,
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
            radiusKm: 1_560.8,
            distanceAU: 0.004486,
            orbitPeriodDays: 3.551,
            orbitalInclination: 0,
            ascendingNode: 0,
            axialTilt: 0,
            moonCount: 0,
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
            radiusKm: 2_631.2,
            distanceAU: 0.007155,
            orbitPeriodDays: 7.155,
            orbitalInclination: 0,
            ascendingNode: 0,
            axialTilt: 0,
            moonCount: 0,
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
            radiusKm: 2_410.3,
            distanceAU: 0.012585,
            orbitPeriodDays: 16.689,
            orbitalInclination: 0,
            ascendingNode: 0,
            axialTilt: 0,
            moonCount: 0,
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
        radiusKm: 60_268,
        distanceAU: 9.537,
        orbitPeriodDays: 10759.22,
        orbitalInclination: 2.485 * D2R,
        ascendingNode: 113.665 * D2R,
        axialTilt: 26.73 * D2R,
        massKg: 5.683e26,
        gravity: 10.44,
        meanTempC: -139,
        moonCount: 146,
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
          rotationSpeed: _R(32.885232),
          orbitalColor: 0xdedbd4,
          fallbackColor: 0xc7c8c9,
          frame: 'parentRelative',
          rotationBody: Body.Saturn,
          // JPL SAT441 mean elements, epoch 2000-01-01.5 TDB.
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.00159360557,
            eccentricity: 0.005,
            inclinationRad: 0,
            ascendingNodeRad: 0,
            argPerihelionRad: 119.5 * D2R,
            meanAnomalyAtEpochRad: 57 * D2R,
            epoch: new Date('2000-01-01T12:00:00Z'),
          },
          textureResolutions: { surface: ['1k'] },
          realData: {
            radiusKm: 252.1,
            distanceAU: 0.00159360557,
            orbitPeriodDays: 1.370218,
            orbitalInclination: 0,
            ascendingNode: 0,
            axialTilt: 0,
            massKg: 1.08022e20,
            gravity: 0.113,
            meanTempC: -201,
            moonCount: 0,
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
          rotationSpeed: _R(108.420072),
          orbitalColor: 0xbcb9b1,
          fallbackColor: 0xa4a39e,
          frame: 'parentRelative',
          rotationBody: Body.Saturn,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          // JPL SAT441 mean elements, epoch 2000-01-01.5 TDB.
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.00352411433,
            eccentricity: 0.001,
            inclinationRad: 0.3 * D2R,
            ascendingNodeRad: 133.7 * D2R,
            argPerihelionRad: 44.3 * D2R,
            meanAnomalyAtEpochRad: 31.5 * D2R,
            epoch: new Date('2000-01-01T12:00:00Z'),
          },
          textureResolutions: { surface: ['1k'] },
          realData: {
            radiusKm: 763.5,
            distanceAU: 0.00352411433,
            orbitPeriodDays: 4.517503,
            orbitalInclination: 0.3 * D2R,
            ascendingNode: 133.7 * D2R,
            axialTilt: 0,
            massKg: 2.3065e21,
            gravity: 0.264,
            meanTempC: -174,
            moonCount: 0,
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
          rotationSpeed: _R(1903.944048),
          orbitalColor: 0x9b8d79,
          fallbackColor: 0x756e62,
          frame: 'parentRelative',
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          rotationBody: Body.Saturn,
          // JPL SAT441 mean elements, epoch 2000-01-01.5 TDB.
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.02380849395,
            eccentricity: 0.028,
            inclinationRad: 7.6 * D2R,
            ascendingNodeRad: 86.5 * D2R,
            argPerihelionRad: 254.5 * D2R,
            meanAnomalyAtEpochRad: 74.8 * D2R,
            epoch: new Date('2000-01-01T12:00:00Z'),
          },
          textureResolutions: { surface: ['4k', '2k', '1k'] },
          realData: {
            radiusKm: 734.3,
            distanceAU: 0.02380849395,
            orbitPeriodDays: 79.331002,
            orbitalInclination: 7.6 * D2R,
            ascendingNode: 86.5 * D2R,
            axialTilt: 0,
            massKg: 1.805e21,
            gravity: 0.223,
            meanTempC: -143,
            moonCount: 0,
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
          rotationSpeed: _R(382.690752),
          orbitalColor: 0xc78b57,
          fallbackColor: 0x9b6a45,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          frame: 'parentRelative',
          rotationBody: Body.Saturn,
          // JPL SAT441 mean elements, epoch 2000-01-01.5 TDB.
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.008167897,
            eccentricity: 0.029,
            inclinationRad: 0.3 * D2R,
            ascendingNodeRad: 78.6 * D2R,
            argPerihelionRad: 78.3 * D2R,
            meanAnomalyAtEpochRad: 11.7 * D2R,
            epoch: new Date('2000-01-01T12:00:00Z'),
          },
          textureResolutions: { surface: ['2k', '1k'] },
          realData: {
            radiusKm: 2_574.76,
            distanceAU: 0.008167897,
            orbitPeriodDays: 15.945448,
            orbitalInclination: 0.3 * D2R,
            ascendingNode: 78.6 * D2R,
            axialTilt: 26.7 * D2R,
            massKg: 1.3452e23,
            gravity: 1.352,
            meanTempC: -179,
            moonCount: 0,
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
      },
    },
    uranus: {
      kind: 'planet',
      radius: 2,
      rotationSpeed: _R(17.24),
      orbitalColor: 0x69d6d3,
      textureResolutions: { surface: ['2k', '1k'] },
      realData: {
        radiusKm: 25_559,
        distanceAU: 19.191,
        orbitPeriodDays: 30688.5,
        orbitalInclination: 0.773 * D2R,
        ascendingNode: 74.006 * D2R,
        axialTilt: 97.77 * D2R,
        massKg: 8.681e25,
        gravity: 8.69,
        meanTempC: -197,
        moonCount: 28,
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
    },

    neptune: {
      kind: 'planet',
      radius: 1.9,
      rotationSpeed: _R(16.11),
      orbitalColor: 0x647cff,
      textureResolutions: { surface: ['2k', '1k'] },
      realData: {
        radiusKm: 24_764,
        distanceAU: 30.069,
        orbitPeriodDays: 60182.0,
        orbitalInclination: 1.77 * D2R,
        ascendingNode: 131.784 * D2R,
        axialTilt: 28.32 * D2R,
        massKg: 1.024e26,
        gravity: 11.15,
        meanTempC: -201,
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
          rotationSpeed: -_R(141.047856),
          orbitalColor: 0x9dc4cf,
          fallbackColor: 0x7796a2,
          frame: 'parentRelative',
          rotationBody: Body.Neptune,
          relativeEphemeris: { kind: 'horizonsParentRelative' },
          relativeOrbitalElements: {
            semiMajorAxisAU: 0.00237169151,
            eccentricity: 0,
            inclinationRad: 157.3 * D2R,
            ascendingNodeRad: 178.1 * D2R,
            argPerihelionRad: 0,
            meanAnomalyAtEpochRad: 63 * D2R,
            epoch: new Date('2000-01-01T12:00:00Z'),
          },
          textureResolutions: { surface: ['8k', '4k', '2k', '1k'] },
          realData: {
            radiusKm: 1_352.6,
            distanceAU: 0.00237169151,
            orbitPeriodDays: 5.876994,
            orbitalInclination: 157.3 * D2R,
            ascendingNode: 178.1 * D2R,
            axialTilt: 0.4 * D2R,
            massKg: 2.14e22,
            gravity: 0.779,
            meanTempC: -235,
            moonCount: 0,
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
