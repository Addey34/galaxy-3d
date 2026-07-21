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
import { assertUniqueBodyNames } from './catalog';
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
      textureResolutions: { surface: ['8k'] },
      textures: { surface: 'stars/starsSurface' },
      loadPriority: 0,
    },

    sun: {
      kind: 'star',
      radius: 10,
      rotationSpeed: _R(609.6),
      orbitalColor: 0x000000,
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      textures: { surface: 'sun/sunSurface' },
      realData: {
        radiusKm: 695_700,
        axialTilt: 7.25 * D2R,
        massKg: 1.989e30,
        gravity: 274,
        meanTempC: 5505,
        moonCount: 8,
        description:
          'The star at the heart of the Solar System: a ball of plasma holding 99.86% of all the mass orbiting it.',
      },
      astroBody: Body.Sun,
      cameraDistance: { educ: 50, explo: exploCameraDistance(695_700) },
      loadPriority: 1,
    },

    mercury: {
      kind: 'planet',
      radius: 0.38,
      rotationSpeed: _R(1407.6),
      orbitalColor: 0xaaaaaa,
      textureResolutions: { surface: ['8k', '4k', '2k', '1k'], bump: ['1k'] },
      textures: {
        surface: 'mercury/mercurySurface',
        bump: 'mercury/mercuryBump',
      },
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
        description:
          'The smallest planet and the closest to the Sun. With no atmosphere, it swings from +430 °C by day to -180 °C at night.',
      },
      astroBody: Body.Mercury,
      cameraDistance: { educ: 2, explo: exploCameraDistance(2_440) },
      loadPriority: 8,
    },

    venus: {
      kind: 'planet',
      radius: 0.95,
      rotationSpeed: _R(5832.6),
      orbitalColor: 0xffa500,
      textureResolutions: {
        surface: ['8k', '4k', '2k', '1k'],
        bump: ['1k'],
        atmosphere: ['4k', '2k', '1k'],
      },
      textures: {
        surface: 'venus/venusSurface',
        atmosphere: 'venus/venusAtmosphere',
        bump: 'venus/venusBump',
      },
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
        description:
          'The hottest planet: its thick CO₂ atmosphere traps heat through a runaway greenhouse effect. It spins backwards, very slowly.',
      },
      astroBody: Body.Venus,
      cameraDistance: { educ: 5, explo: exploCameraDistance(6_052) },
      loadPriority: 7,
    },

    earth: {
      kind: 'planet',
      radius: 1,
      rotationSpeed: _R(23.9345),
      orbitalColor: 0x00bfff,
      textureResolutions: {
        surface: ['8k', '4k', '2k', '1k'],
        normalMap: ['8k', '4k', '2k', '1k'],
        clouds: ['8k', '4k', '2k', '1k'],
        spec: ['8k', '4k', '2k', '1k'],
        lights: ['8k', '4k', '2k', '1k'],
      },
      textures: {
        surface: 'earth/earthSurface',
        normalMap: 'earth/earthNormalMap',
        clouds: 'earth/earthClouds',
        spec: 'earth/earthSpec',
        lights: 'earth/earthLights',
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
        description:
          'The only known planet to harbour life. Liquid water covers 71% of its surface, and its atmosphere shields it from solar radiation.',
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
          frame: 'parentRelative',
          radius: 0.27,
          rotationSpeed: _R(655.72),
          orbitalColor: 0x999999,
          textureResolutions: {
            surface: ['8k', '4k', '2k', '1k'],
            bump: ['4k', '2k', '1k'],
          },
          textures: {
            surface: 'moon/moonSurface',
            bump: 'moon/moonBump',
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
            description:
              "Earth's only natural satellite. It always shows the same face and stabilises our planet's axial tilt.",
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
      orbitalColor: 0xff4500,
      textureResolutions: {
        surface: ['8k', '4k', '2k', '1k'],
        normalMap: ['1k'],
      },
      textures: {
        surface: 'mars/marsSurface',
        normalMap: 'mars/marsNormalMap',
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
        description:
          'The red planet, tinted by iron oxide. It hosts Olympus Mons, the tallest volcano in the Solar System (~22 km).',
      },
      astroBody: Body.Mars,
      cameraDistance: { educ: 3, explo: exploCameraDistance(3_390) },
      loadPriority: 4,
    },

    jupiter: {
      kind: 'planet',
      radius: 4,
      rotationSpeed: _R(9.9259),
      orbitalColor: 0xffc04d,
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      textures: { surface: 'jupiter/jupiterSurface' },
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
        description:
          'The giant of the Solar System: more massive than all the other planets combined. Its Great Red Spot is a storm centuries old.',
      },
      astroBody: Body.Jupiter,
      cameraDistance: { educ: 25, explo: exploCameraDistance(71_492) },
      loadPriority: 5,
    },

    saturn: {
      kind: 'planet',
      radius: 3.5,
      rotationSpeed: _R(10.656),
      orbitalColor: 0xf5deb3,
      ring: {
        bodyName: 'saturn-ring',
        innerRadius: 1.5,
        outerRadius: 2.2,
        textureResolutions: ['8k', '4k', '2k', '1k'],
        textures: 'saturn/saturnRing',
      },
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      textures: { surface: 'saturn/saturnSurface' },
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
        description:
          'Famous for its spectacular rings, made of billions of chunks of ice and rock. So low in density it would float on water.',
      },
      astroBody: Body.Saturn,
      cameraDistance: { educ: 20, explo: exploCameraDistance(60_268) },
      loadPriority: 6,
    },

    uranus: {
      kind: 'planet',
      radius: 2,
      rotationSpeed: _R(17.24),
      orbitalColor: 0x7fffd4,
      textureResolutions: { surface: ['2k', '1k'] },
      textures: { surface: 'uranus/uranusSurface' },
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
        description:
          'The ice giant tipped on its side: its axis leans at 98°, so it rolls along its orbit. Each season lasts 21 years.',
      },
      astroBody: Body.Uranus,
      cameraDistance: { educ: 10, explo: exploCameraDistance(25_559) },
      loadPriority: 9,
    },

    neptune: {
      kind: 'planet',
      radius: 1.9,
      rotationSpeed: _R(16.11),
      orbitalColor: 0x4169e1,
      textureResolutions: { surface: ['2k', '1k'] },
      textures: { surface: 'neptune/neptuneSurface' },
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
        description:
          'The most distant planet, invisible to the naked eye and found by calculation. Its winds reach 2,000 km/h, the fiercest in the Solar System.',
      },
      astroBody: Body.Neptune,
      cameraDistance: { educ: 10, explo: exploCameraDistance(24_764) },
      loadPriority: 10,
    },

    // Petits corps (astéroïdes, comètes, planètes naines) — positionnés par éléments
    // orbitaux képlériens, définis dans `smallBodies.ts`. Fusionnés ici pour dériver comme
    // les autres corps (position, ligne d'orbite, label Explo), sans texture ni mesh.
    ...SMALL_BODIES,
  },
};

// Fail-fast : un nom en doublon (corps ou satellite) écraserait silencieusement une entrée.
assertUniqueBodyNames(CELESTIAL_CONFIG);
