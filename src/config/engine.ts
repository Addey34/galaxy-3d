/**
 * Réglages du moteur : rendu, performance/LOD, caméra, éclairage, shaders et textures,
 * plus la détection mobile (`IS_MOBILE`) qui pilote la qualité partout.
 *
 * Le catalogue des corps célestes vit à part dans `bodies.ts` (il grossit indépendamment).
 */
import * as THREE from 'three';
import type { TextureQuality } from '@/types';

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

/** Optional SPK runtime source; unset deployments keep the local Horizons path. */
export const SPK_SETTINGS = {
  url: import.meta.env.VITE_SPK_KERNEL_URL?.trim() || null,
  bodyIds: {
    sun: 10,
    mercury: 199,
    venus: 299,
    earth: 399,
    moon: 301,
    mars: 499,
    phobos: 401,
    deimos: 402,
    jupiter: 599,
    io: 501,
    europa: 502,
    ganymede: 503,
    callisto: 504,
    saturn: 699,
    enceladus: 602,
    rhea: 605,
    titan: 606,
    iapetus: 608,
    uranus: 799,
    neptune: 899,
    triton: 801,
    pluto: 999,
    charon: 901,
  } as const,
};

export const RENDER_SETTINGS = {
  antialias: !IS_MOBILE,
  powerPreference: 'high-performance' as const,
  shadowMap: {
    // Shadow maps désactivées : la PointLight solaire nécessiterait un cube map
    // 6 faces (6 passes de rendu par frame) — coût GPU énorme pour des ombres
    // quasi invisibles à l'échelle du système solaire. Le shader jour/nuit
    // (NightLightsShader) gère déjà le terminateur lumière/ombre sur chaque corps.
    enabled: false,
    type: THREE.PCFSoftShadowMap as THREE.ShadowMapType,
  },
  toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping,
  toneMappingExposure: 1.0,
  maxPixelRatio: IS_MOBILE ? 1.5 : 2,
  // Intensité du fond étoilé (Voie lactée équirectangulaire). Volontairement
  // modérée : la texture JPEG est compressée, et un boost trop fort (2.2)
  // surexpose les blocs de compression DCT autour des étoiles brillantes → elles
  // apparaissent « carrées ». 1.4 garde la bande galactique lisible et nourrit le
  // bloom sans révéler ces artefacts.
  backgroundIntensity: 1.4,
};

export const CAMERA_SETTINGS = {
  fov: 65,
  focusFov: 55,
  opticalMinFov: 8,
  opticalMaxFov: 55,
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
  // ── Bornes de zoom ADAPTÉES AU CORPS ciblé (multiples de son rayon visuel courant) ──
  // Recalculées à chaque sélection : un petit corps se zoome autant qu'un gros,
  // proportionnellement à sa taille, sans jamais traverser la surface.
  targetMinRadiusFactor: 1.15, // au plus près : on frôle la surface (1.15× le rayon)
  targetMaxRadiusFactor: 60, // au plus loin d'un corps suivi : 60× son rayon
  // Garde-fous absolus (le facteur ne doit pas descendre/monter hors de ces bornes par mode).
  educMinFloor: 0.05,
  exploMinFloor: 0.00002,
  maxPolarAngle: Math.PI,
  minPolarAngle: 0,
  screenSpacePanning: false,
  enablePan: false,
  enableZoom: true,
  enableRotate: true,
  rotateSpeed: 0.5,
  zoomSpeed: 0.7,
};

export const LIGHTING_SETTINGS = {
  ambient: {
    color: 0x404040,
    intensity: 0.02,
  },
  sun: {
    color: 0xfffaf0,
    intensity: 2.5,
    distance: 0,
    // L'atténuation 1/r² et les éclipses sont appliquées par corps dans AnimationSystem.
    decay: 0,
    position: new THREE.Vector3(0, 0, 0),
    shadow: {
      enabled: false,
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
    intensity: 1.0,
    // Le shader perturbe sa normale avec la normalMap (voir NightLightsShader) :
    // son terminateur suit le relief comme l'ombre de la surface. threshold ramené
    // à ~0 : les lumières s'arrêtent pile au terminateur, sans déborder côté jour
    // (le débord + le bloom produisaient une tache blanche saturée sur la face jour).
    threshold: 0.02,
    smoothness: 0.08,
  },
  atmosphere: {
    // Halo Fresnel (voir AtmosphereShader). power élevé = liseré fin ; nightWrap
    // laisse un peu de halo déborder côté nuit pour un dégradé crépusculaire doux.
    power: 3.0,
    intensity: 1.1,
    nightWrap: 0.25,
    defaultColor: 0x5a8fdb,
  },
};

export const BLOOM_SETTINGS = {
  // Désactivé sur mobile : une passe de post-process supplémentaire coûte cher sur
  // GPU intégré. Le seuil élevé sélectionne naturellement les sources très
  // lumineuses (Soleil, lumières de ville additives) sans faire baver les planètes.
  enabled: !IS_MOBILE,
  // strength/radius relevés pour un halo de Soleil lisible (le réglage précédent
  // restait imperceptible à distance) ; le seuil reste haut pour ne pas faire
  // baver les planètes éclairées (elles plafonnent sous 0.85 après tone mapping).
  strength: 0.85,
  radius: 0.5,
  threshold: 0.85,
};

// Couverture nuageuse RÉELLE de la Terre depuis NASA GIBS (imagerie satellite
// quotidienne), synchronisée sur la date de la simulation. Remplace la couche
// nuages statique quand disponible ; repli automatique sur la texture statique
// hors-ligne / date hors plage. Voir core/gibsClouds.ts (URL/date) et
// ui/realtimeClouds.ts (chargement + application). Un seul endroit à régler.
export const REALTIME_CLOUDS_SETTINGS = {
  enabled: true,
  // Couche GIBS : VIIRS SNPP True Color (nuages blancs réalistes, fauchée large).
  layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
  // Résolution de l'image équirectangulaire (2:1). 2048×1024 ≈ 150–300 Ko.
  resolution: 2048,
  // Latence de publication GIBS : « aujourd'hui » charge J-latencyDays.
  latencyDays: 1,
  // Borne basse de la couche (avant → fallback statique).
  minDate: '2015-11-24',
  // Extraction shader : seuils de luminance (min RGB) et de saturation max pour ne
  // garder que les nuages (blanc désaturé lumineux) et rejeter le sol coloré. Deux
  // seuils bas : sur l'océan (fond sombre) on capte même les nuages fins ; sur la
  // terre (sable clair ≈ nuage) on n'accepte que les nuages francs (lumLowLand plus
  // haut). La distinction eau/terre vient du canal g de la spec map surface.
  cloudLuminanceLow: 0.32,
  cloudLuminanceLowLand: 0.55,
  cloudLuminanceHigh: 0.62,
  cloudSaturationMax: 0.3,
  // Opacité globale de la couche nuages réelle (0..1).
  opacity: 0.9,
};

// Couche PLUIE mondiale (NASA IMERG, taux de précipitation toutes les 30 min).
// Superposée aux nuages, remappée en nuages d'orage réalistes (createPrecipMaterial).
// On affiche la frame RÉELLE de l'instant de simulation : la pluie change au rythme réel
// des données (nouvelle image toutes les 30 min), jamais en time-lapse accéléré. Elle
// « bouge » quand le temps de simulation avance (lecture accélérée) ou en time-travel.
export const PRECIP_SETTINGS = {
  enabled: !IS_MOBILE,
  layer: 'IMERG_Precipitation_Rate_30min',
  resolution: 1024,
  // Latence de publication IMERG (heures) : « maintenant » vise now - latencyHours.
  latencyHours: 4,
  minDate: '2000-06-01',
  // Opacité globale de la couche pluie.
  opacity: 0.85,
};

// Prototype couche VENT : particules advectées par le champ de vent réel (Open-Meteo GFS).
// Voir core/windField.ts, components/celestial/WindParticles.ts, ui/windLayer.ts.
export const WIND_SETTINGS = {
  enabled: !IS_MOBILE,
  // Pas de la grille de vent (degrés). 10° = 612 points en une requête.
  gridStep: 10,
  // Nombre de particules (advection CPU au prototype).
  particleCount: 2500,
  // Vitesse d'advection : degrés de déplacement par (km/h · s). Réglé pour un flux lisible.
  speedScale: 0.02,
  // Durée de vie moyenne d'une particule (s) avant ré-ensemencement (traînées).
  lifeSeconds: 4,
  color: 0xcfe6ff,
  opacity: 0.5,
  // Décalage de longitude (rad) pour aligner les particules sur les textures.
  lonOffset: Math.PI / 2,
};

export const TEXTURE_SETTINGS: TextureSettings = {
  // Vite BASE_URL keeps Firebase Hosting sub-path deployments working.
  basePath: `${import.meta.env.BASE_URL}assets/textures/`,
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
