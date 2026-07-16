/**
 * Réglages du moteur : rendu, performance/LOD, caméra, éclairage, shaders et textures,
 * plus la détection mobile (`IS_MOBILE`) qui pilote la qualité partout.
 *
 * Le catalogue des corps célestes vit à part dans `bodies.ts` (il grossit indépendamment).
 * `settings.ts` ré-exporte les deux pour compatibilité.
 */
import * as THREE from 'three';
import type { TextureQuality } from '../types';

// ============================================================================
// MOBILE DETECTION
// ============================================================================

/**
 * Détection mobile réévaluable à tout moment (dépend de `innerWidth`, donc du
 * redimensionnement). `IS_MOBILE` en fige la valeur au chargement pour les réglages
 * figés à l'init (antialiasing, taille des shadow maps, qualité des textures — non
 * modifiables sans recréer le renderer/les matériaux). Seuls les réglages ré-applicables
 * à chaud, comme le pixel ratio, doivent rappeler `isMobile()`.
 */
export const isMobile = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) || window.innerWidth < 768
  );
};

export const IS_MOBILE = isMobile();

/** Pixel ratio maximal courant, réévalué à chaud (voir `isMobile`). */
export const currentMaxPixelRatio = (): number => (isMobile() ? 1.5 : 2);

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
  high: TextureQualityLevel;
  medium: TextureQualityLevel;
  low: TextureQualityLevel;
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
          ultra: { segments: 128, distance: 10, quality: '4k' },
          high: { segments: 64, distance: 20, quality: '2k' },
          medium: { segments: 64, distance: 40, quality: '2k' },
          low: { segments: 32, distance: 80, quality: '1k' },
        }
      : {
          ultra: { segments: 256, distance: 10, quality: '8k' },
          high: { segments: 128, distance: 20, quality: '4k' },
          medium: { segments: 64, distance: 40, quality: '2k' },
          low: { segments: 32, distance: 80, quality: '1k' },
        },
  },
};

export const RENDER_SETTINGS = {
  antialias: !IS_MOBILE,
  powerPreference: 'high-performance' as const,
  shadowMap: {
    enabled: true,
    type: THREE.PCFSoftShadowMap as THREE.ShadowMapType,
  },
  toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping,
  toneMappingExposure: 1.0,
  maxPixelRatio: IS_MOBILE ? 1.5 : 2,
};

export const CAMERA_SETTINGS = {
  fov: 75,
  // Mode Éducatif — near/far larges (planètes à 2-192u)
  educNear: 0.1,
  educFar: 20_000,
  // Mode Explo — near très petit (planètes réelles à 0.003-0.12u de la caméra)
  exploNear: 1e-6,
  exploFar: 3_000, // Neptune explo ≈ 1050u
  // Vue d'ensemble Éducatif — légèrement inclinée (~35°) pour montrer la profondeur des orbites
  initialPosition: new THREE.Vector3(0, 160, 220),
  // Distance de visite fallback quand un corps ne définit pas cameraDistance.
  defaultBodyDistance: 10,
};

export const CAMERA_CONTROLS_SETTINGS = {
  smoothness: 0.15,
  minDistanceMultiplier: 2,
  educMinDistance: 0.5, // Éducatif — permet d'approcher le soleil visuellement
  exploMinDistance: 0.0001, // Explo — quelques km en vraie échelle
  educMaxDistance: 500, // Éducatif — Neptune à 192u + marge
  exploMaxDistance: 3_000, // Explo — Neptune réel à 1050u
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
};
