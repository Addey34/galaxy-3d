/**
 * Source de vérité unique de la configuration de l'application.
 *
 * Regroupe : définition de tous les corps célestes (`CELESTIAL_CONFIG` — taille, rotation,
 * couleur d'orbite, anneaux, satellites et données astronomiques réelles), réglages de
 * rendu, caméra, éclairage, shaders et textures, plus la détection mobile (`IS_MOBILE`)
 * qui pilote la qualité partout. Modifier un corps ou un réglage se fait ici.
 */
import * as THREE from 'three';
import type { CelestialBodyConfig, CelestialConfig, TextureQuality } from '../types';
import { educRadius, exploCameraDistance } from '../core/ScaleService';

// ============================================================================
// MOBILE DETECTION
// ============================================================================

const isMobile = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth < 768
  );
};

export const IS_MOBILE = isMobile();

// ============================================================================
// EXPORTED INTERFACES
// ============================================================================

export interface TextureQualityLevel {
  segments: number;
  distance: number;
  quality: TextureQuality;
}

export interface TextureQualityMap {
  ultra: TextureQualityLevel;
  high:  TextureQualityLevel;
  medium: TextureQualityLevel;
  low:   TextureQualityLevel;
}

export interface PerformanceSettings {
  targetFPS: number;
  maxAnisotropy: number;
  textureQuality: TextureQualityMap;
}

export interface AppSettings {
  debug: boolean;
  performance: PerformanceSettings;
}

export interface TextureDefaultSettings {
  wrapS: THREE.Wrapping;
  wrapT: THREE.Wrapping;
  anisotropy: number;
  colorSpace: THREE.ColorSpace;
  minFilter: THREE.MinificationTextureFilter;
  magFilter: THREE.MagnificationTextureFilter;
  generateMipmaps: boolean;
}

export interface TextureSettings {
  basePath: string;
  defaultSettings: TextureDefaultSettings;
  loadPriority: string[];
}

// ============================================================================
// LOGGER
// ============================================================================

export const LOGGER_SETTINGS = {
  debug: false,
};

// ============================================================================
// APP
// ============================================================================

export const APP_SETTINGS: AppSettings = {
  debug: false,
  performance: {
    targetFPS: 60,
    maxAnisotropy: IS_MOBILE ? 8 : 16,
    textureQuality: IS_MOBILE
      ? {
          ultra:  { segments: 128, distance: 10,  quality: '4k' },
          high:   { segments: 64,  distance: 20,  quality: '2k' },
          medium: { segments: 64,  distance: 40,  quality: '2k' },
          low:    { segments: 32,  distance: 80,  quality: '1k' },
        }
      : {
          ultra:  { segments: 256, distance: 10,  quality: '8k' },
          high:   { segments: 128, distance: 20,  quality: '4k' },
          medium: { segments: 64,  distance: 40,  quality: '2k' },
          low:    { segments: 32,  distance: 80,  quality: '1k' },
        },
  },
};

export const RENDER_SETTINGS = {
  antialias: !IS_MOBILE,
  powerPreference: 'high-performance' as const,
  shadowMap: {
    enabled: true,
    type: THREE.PCFSoftShadowMap as THREE.ShadowMapType,
    resolution: [2048, 2048] as [number, number],
  },
  toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping,
  toneMappingExposure: 1.0,
  maxPixelRatio: IS_MOBILE ? 1.5 : 2,
};

export const CAMERA_SETTINGS = {
  fov: 75,
  // Mode Éducatif — near/far larges (planètes à 2-192u)
  educNear: 0.1,
  educFar:  20_000,
  // Mode Explo — near très petit (planètes réelles à 0.003-0.12u de la caméra)
  exploNear: 1e-6,
  exploFar:  3_000, // Neptune explo ≈ 1050u
  // Vue d'ensemble Éducatif — légèrement inclinée (~35°) pour montrer la profondeur des orbites
  initialPosition: new THREE.Vector3(0, 160, 220),
  bodyDistances: {
    sun:     50,
    mercury:  2,
    venus:    5,
    earth:    5,
    moon:     2,
    mars:     3,
    jupiter: 25,
    saturn:  20,
    uranus:  10,
    neptune: 10,
  } as Record<string, number>,
  // Distances de visite Explo (vraie échelle) — dérivées de exploCameraDistance(radiusKm).
  // Formule : (radiusKm / AU_KM) × SQRT_K × 7 ≈ 8° d'angle apparent.
  exploBodyDistances: {
    sun:     exploCameraDistance(695_700),  // ~1.14u (réduit à 1.0 visuellement)
    mercury: exploCameraDistance(2_440),    // ~0.004u
    venus:   exploCameraDistance(6_052),    // ~0.0099u
    earth:   exploCameraDistance(6_371),    // ~0.0104u
    moon:    exploCameraDistance(1_737),    // ~0.0028u
    mars:    exploCameraDistance(3_390),    // ~0.0056u
    jupiter: exploCameraDistance(71_492),   // ~0.117u
    saturn:  exploCameraDistance(60_268),   // ~0.0987u
    uranus:  exploCameraDistance(25_559),   // ~0.0419u
    neptune: exploCameraDistance(24_764),   // ~0.0406u
  } as Record<string, number>,
};

export const CAMERA_CONTROLS_SETTINGS = {
  smoothness: 0.15,
  minDistanceMultiplier: 2,
  educMinDistance: 0.5,      // Éducatif — permet d'approcher le soleil visuellement
  exploMinDistance: 0.0001,  // Explo — quelques km en vraie échelle
  educMaxDistance: 500,      // Éducatif — Neptune à 192u + marge
  exploMaxDistance: 3_000,   // Explo — Neptune réel à 1050u
  maxPolarAngle: Math.PI,
  minPolarAngle: 0,
  screenSpacePanning: false,
  enablePan: false,
  enableZoom: true,
  enableRotate: true,
  rotateSpeed: 0.2,
  zoomSpeed: 0.2,
};

export const LIGHTING_SETTINGS = {
  ambient: {
    color: 0x404040,
    intensity: 0.05,
  },
  sun: {
    color: 0xfffaf0,
    intensity: 2.5,
    distance: 0,
    decay: 0,
    position: new THREE.Vector3(0, 0, 0),
    shadow: {
      enabled: true,
      mapSize: IS_MOBILE ? 2048 : 4096,
      bias: -0.00005,
      normalBias: 0.02,
      radius: 1.5,
      near: 0.1,
      far: 1000,
    },
  },
};

export const SHADER_SETTINGS = {
  nightLights: {
    intensity: 1.5,
    // Le shader perturbe sa normale avec la normalMap (voir NightLightsShader) :
    // son terminateur suit le relief comme l'ombre de la surface. Plus besoin de
    // gonfler le threshold pour cacher un décalage — léger débord côté jour (0.15)
    // pour absorber l'écart du layer (R×1.002) et la lumière à distance finie.
    threshold: 0.15,
    smoothness: 0.08,
  },
};

export const TEXTURE_SETTINGS: TextureSettings = {
  basePath: '/assets/textures/',
  defaultSettings: {
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    anisotropy: 8,
    colorSpace: THREE.SRGBColorSpace,
    minFilter: THREE.LinearMipMapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  },
  loadPriority: [
    'stars', 'sun', 'earth', 'moon', 'mars',
    'jupiter', 'saturn', 'venus', 'mercury', 'uranus', 'neptune',
  ],
};

// Vitesse de rotation axiale — rad / seconde de simulation.
const _R = (hours: number): number => (Math.PI * 2) / (hours * 3_600);

// Degrés → radians pour les éléments orbitaux.
const D2R = Math.PI / 180;

export const CELESTIAL_CONFIG: CelestialConfig = {
  bodies: {
    stars: {
      radius: 0,
      rotationSpeed: 0,
      orbitalRadius: 0,
      orbitalColor: 0x000000,
      textureResolutions: { surface: ['8k'] },
      textures: { surface: 'stars/starsSurface' },
    },

    sun: {
      radius: 10,
      rotationSpeed: _R(609.6),
      orbitalRadius: 0,
      orbitalColor: 0x000000,
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      textures: { surface: 'sun/sunSurface' },
      realData: { radiusKm: 695_700, axialTilt: 7.25 * D2R },
    },

    mercury: {
      radius: 0.38,
      rotationSpeed: _R(1407.6),
      orbitalRadius: educRadius(0.387),
      orbitalColor: 0xaaaaaa,
      textureResolutions: { surface: ['8k', '4k', '2k', '1k'], bump: ['1k'] },
      textures: { surface: 'mercury/mercurySurface', bump: 'mercury/mercuryBump' },
      realData: { radiusKm: 2_440, distanceAU: 0.387, orbitPeriodDays: 87.97, orbitalInclination: 7.005 * D2R, ascendingNode: 48.331 * D2R, axialTilt: 0.034 * D2R },
    },

    venus: {
      radius: 0.95,
      rotationSpeed: _R(5832.6),
      orbitalRadius: educRadius(0.723),
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
      realData: { radiusKm: 6_052, distanceAU: 0.723, orbitPeriodDays: 224.7, orbitalInclination: 3.395 * D2R, ascendingNode: 76.680 * D2R, axialTilt: 177.36 * D2R },
    },

    earth: {
      radius: 1,
      rotationSpeed: _R(23.9345),
      orbitalRadius: educRadius(1.000),
      orbitalColor: 0x00bfff,
      textureResolutions: {
        surface:   ['8k', '4k', '2k', '1k'],
        normalMap: ['8k', '4k', '2k', '1k'],
        clouds:    ['8k', '4k', '2k', '1k'],
        spec:      ['8k', '4k', '2k', '1k'],
        lights:    ['8k', '4k', '2k', '1k'],
      },
      textures: {
        surface:   'earth/earthSurface',
        normalMap: 'earth/earthNormalMap',
        clouds:    'earth/earthClouds',
        spec:      'earth/earthSpec',
        lights:    'earth/earthLights',
      },
      realData: { radiusKm: 6_371, distanceAU: 1.000, orbitPeriodDays: 365.25, orbitalInclination: 0, ascendingNode: 0, axialTilt: 23.44 * D2R },
      satellites: {
        moon: {
          radius: 0.27,
          rotationSpeed: _R(655.72),
          orbitalRadius: educRadius(0.00257),
          orbitalColor: 0x999999,
          textureResolutions: {
            surface: ['8k', '4k', '2k', '1k'],
            bump:    ['4k', '2k', '1k'],
          },
          textures: {
            surface: 'moon/moonSurface',
            bump:    'moon/moonBump',
          },
          realData: { radiusKm: 1_737, distanceAU: 0.00257, orbitPeriodDays: 27.32, orbitalInclination: 5.145 * D2R, ascendingNode: 0, axialTilt: 6.68 * D2R },
        } as CelestialBodyConfig,
      },
    },

    mars: {
      radius: 0.53,
      rotationSpeed: _R(24.6229),
      orbitalRadius: educRadius(1.524),
      orbitalColor: 0xff4500,
      textureResolutions: { surface: ['8k', '4k', '2k', '1k'], normalMap: ['1k'] },
      textures: { surface: 'mars/marsSurface', normalMap: 'mars/marsNormalMap' },
      realData: { radiusKm: 3_390, distanceAU: 1.524, orbitPeriodDays: 686.97, orbitalInclination: 1.850 * D2R, ascendingNode: 49.579 * D2R, axialTilt: 25.19 * D2R },
    },

    jupiter: {
      radius: 4,
      rotationSpeed: _R(9.9259),
      orbitalRadius: educRadius(5.203),
      orbitalColor: 0xffc04d,
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      textures: { surface: 'jupiter/jupiterSurface' },
      realData: { radiusKm: 71_492, distanceAU: 5.203, orbitPeriodDays: 4332.59, orbitalInclination: 1.304 * D2R, ascendingNode: 100.464 * D2R, axialTilt: 3.13 * D2R },
    },

    saturn: {
      radius: 3.5,
      rotationSpeed: _R(10.656),
      orbitalRadius: educRadius(9.537),
      orbitalColor: 0xf5deb3,
      ring: {
        bodyName: 'saturn-ring',
        innerRadius: 1.5,
        outerRadius: 2.2,
        rotationSpeed: 0.0001,
        textureResolutions: ['8k', '4k', '2k', '1k'],
        textures: 'saturn/saturnRing',
      },
      textureResolutions: { surface: ['4k', '2k', '1k'] },
      textures: { surface: 'saturn/saturnSurface' },
      realData: { radiusKm: 60_268, distanceAU: 9.537, orbitPeriodDays: 10759.22, orbitalInclination: 2.485 * D2R, ascendingNode: 113.665 * D2R, axialTilt: 26.73 * D2R },
    },

    uranus: {
      radius: 2,
      rotationSpeed: _R(17.24),
      orbitalRadius: educRadius(19.191),
      orbitalColor: 0x7fffd4,
      textureResolutions: { surface: ['2k', '1k'] },
      textures: { surface: 'uranus/uranusSurface' },
      realData: { radiusKm: 25_559, distanceAU: 19.191, orbitPeriodDays: 30688.5, orbitalInclination: 0.773 * D2R, ascendingNode: 74.006 * D2R, axialTilt: 97.77 * D2R },
    },

    neptune: {
      radius: 1.9,
      rotationSpeed: _R(16.11),
      orbitalRadius: educRadius(30.069),
      orbitalColor: 0x4169e1,
      textureResolutions: { surface: ['2k', '1k'] },
      textures: { surface: 'neptune/neptuneSurface' },
      realData: { radiusKm: 24_764, distanceAU: 30.069, orbitPeriodDays: 60182.0, orbitalInclination: 1.770 * D2R, ascendingNode: 131.784 * D2R, axialTilt: 28.32 * D2R },
    },
  },
};
