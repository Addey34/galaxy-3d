/**
 * Réglages du moteur : rendu, performance/LOD, caméra, éclairage, shaders et textures,
 * plus la détection mobile (`IS_MOBILE`) qui pilote la qualité partout.
 *
 * Le catalogue des corps célestes vit à part dans `bodies.ts` (il grossit indépendamment).
 */
import * as THREE from 'three';
import type { TextureQuality } from '@/types';
import {
  qualityProfile,
  readQualityMode,
  resolveQualityTier,
  type QualityProfile,
} from '@/core/qualityTier';

// ============================================================================
// MOBILE DETECTION
// ============================================================================

/**
 * Signaux d'appareil, pour classer « rendu allégé » (mobile/tablette) vs « rendu complet »
 * (desktop). Extrait de `isMobile()` pour rester PUR et testable (pas d'accès à `window`).
 */
export interface DeviceSignals {
  /** User-agent d'un mobile/tablette connu. */
  mobileUserAgent: boolean;
  /** L'appareil expose une entrée tactile (`navigator.maxTouchPoints > 0`). */
  touch: boolean;
  /** Plus grande dimension de l'écran en px CSS (max(innerWidth, innerHeight)). */
  largestViewportSide: number;
  /** Plus petite dimension CSS, utile pour reconnaitre un mobile portrait haut. */
  smallestViewportSide?: number;
}

// Au-delà de cette largeur, un appareil tactile est traité comme un desktop (écran de
// bureau tactile, PC tout-en-un) : assez puissant pour le rendu complet. En deçà, un
// appareil tactile est une tablette → rendu allégé, même en paysage (≥ 768).
const TOUCH_TABLET_MAX_SIDE = 1280;
// Petit écran : mobile quelle que soit l'entrée (filet de sécurité historique).
const SMALL_SCREEN_SIDE = 768;

/**
 * Décide si l'appareil mérite un rendu allégé (profil « mobile »). PUR : ne dépend que des
 * signaux passés. Un appareil TACTILE à écran moyen (tablette, même en paysage ≥ 768) est
 * désormais capté — l'ancien seuil `innerWidth < 768` classait une tablette paysage comme
 * desktop et lui infligeait un rendu trop lourd.
 */
export function isLowPowerDevice(signals: DeviceSignals): boolean {
  if (signals.mobileUserAgent) return true;
  const smallestViewportSide =
    signals.smallestViewportSide ?? signals.largestViewportSide;
  if (
    smallestViewportSide < SMALL_SCREEN_SIDE &&
    signals.largestViewportSide < 1024
  )
    return true;
  return signals.touch && signals.largestViewportSide <= TOUCH_TABLET_MAX_SIDE;
}

/**
 * Détection réévaluable à tout moment (dépend de `innerWidth`/`innerHeight`, donc du
 * redimensionnement). `IS_MOBILE` en fige la valeur au chargement pour les réglages
 * figés à l'init (antialiasing, taille des shadow maps, qualité des textures — non
 * modifiables sans recréer le renderer/les matériaux). Seuls les réglages ré-applicables
 * à chaud, comme le pixel ratio, doivent rappeler `isMobile()`.
 */
export const isMobile = (): boolean => {
  if (typeof window === 'undefined') return false;
  return isLowPowerDevice({
    mobileUserAgent:
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      ),
    touch: navigator.maxTouchPoints > 0,
    largestViewportSide: Math.max(window.innerWidth, window.innerHeight),
    smallestViewportSide: Math.min(window.innerWidth, window.innerHeight),
  });
};

export const IS_MOBILE = isMobile();

// ============================================================================
// QUALITY TIER (perf adaptative)
// ============================================================================

/**
 * Palier de qualité résolu AU CHARGEMENT depuis le choix persisté (localStorage) : `auto`
 * reproduit l'ancien binaire mobile→medium / desktop→high (personne n'est dégradé par
 * défaut). Les réglages FIGÉS à l'init (antialiasing, anisotropie, densité géométrie) en
 * dérivent une fois pour toutes ; les leviers À CHAUD (pixel ratio, bloom, LOD) sont
 * re-résolus dynamiquement via `activeQualityProfile()`.
 */
export const BOOT_QUALITY_TIER = resolveQualityTier(
  readQualityMode(),
  IS_MOBILE
);

/** Profil de rendu du palier de démarrage (réglages figés à l'init). */
export const BOOT_QUALITY_PROFILE: QualityProfile =
  qualityProfile(BOOT_QUALITY_TIER);

/**
 * Profil de qualité COURANT, re-résolu à la demande pour les leviers ajustables à chaud
 * (pixel ratio, bloom, densité LOD). Relit le choix persisté à chaque appel → un changement
 * de mode en cours de session est pris en compte sans recharger, pour ces leviers-là.
 */
export const activeQualityProfile = (): QualityProfile =>
  qualityProfile(resolveQualityTier(readQualityMode(), isMobile()));

/** Pixel ratio maximal courant, dérivé du palier actif (réévalué à chaud). */
export const currentMaxPixelRatio = (): number =>
  activeQualityProfile().maxPixelRatio;

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
    maxAnisotropy: BOOT_QUALITY_PROFILE.maxAnisotropy,
    // Le palier de tête (ultra) est plafonné par la résolution max du profil : high sert 8k,
    // medium 2k, low 2k. Les paliers inférieurs restent inchangés (déjà légers).
    textureQuality: textureQualityForProfile(BOOT_QUALITY_PROFILE),
  },
};

/** Construit la table LOD de textures selon la résolution max autorisée par le palier. */
function textureQualityForProfile(profile: QualityProfile): TextureQualityMap {
  const ultraQuality = profile.maxTextureQuality;
  const highQuality: TextureQuality = ultraQuality === '8k' ? '4k' : '2k';
  return {
    ultra: {
      segments: profile.hiResSegments,
      distance: 10,
      quality: ultraQuality,
    },
    high: { segments: 128, distance: 20, quality: highQuality },
    medium: { segments: 64, distance: 40, quality: '2k' },
    low: { segments: 32, distance: 80, quality: '1k' },
  };
}

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
  antialias: BOOT_QUALITY_PROFILE.antialias,
  powerPreference: 'high-performance' as const,
  // Uniquement pour ui/capture.ts : sans ça, le buffer de rendu serait déjà remplacé (double
  // buffer navigateur) par le prochain requestAnimationFrame avant qu'un toBlob() asynchrone
  // ne puisse le lire. Coût : désactive une optimisation navigateur mineure, en permanence.
  preserveDrawingBuffer: true,
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
  maxPixelRatio: BOOT_QUALITY_PROFILE.maxPixelRatio,
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
      // Inerte (shadow.enabled=false) ; taille dérivée du palier par cohérence si réactivé.
      mapSize: BOOT_QUALITY_PROFILE.antialias ? 4096 : 2048,
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
    // threshold=0.02 laissait les lumières atteindre ~90 % d'intensité DÈS le terminateur
    // géométrique (dot=0), alors que la surface y est encore clairement éclairée — vu comme
    // des lumières nocturnes qui « bavent » sur le jour.
    //
    // Cette plage (dot -0.12 → -0.30, soit ~6.9° → ~18° sous l'horizon) est le crépuscule
    // nautique→astronomique réel : la fenêtre où les lumières de ville deviennent
    // effectivement visibles depuis l'espace. Elle FONDU-ENCHAÎNE avec le crépuscule de la
    // surface (createShadowAwareStandardMaterial, TERMINATOR_WRAP_ATMOSPHERE=0.31 dans
    // layerConfig.ts) : les villes commencent à s'allumer à -0.12, quand la lueur
    // crépusculaire du sol a déjà perdu les deux tiers de son intensité, et atteignent leur
    // plein régime à -0.30 — juste avant que cette lueur ne s'éteigne complètement à -0.31.
    // Aucune des deux couches ne saute : l'une monte pendant que l'autre descend.
    //
    // Bug antérieur (corrigé) : NightLightsShader utilisait -smoothness seul comme borne
    // basse, donnant une rampe de 0.06 au lieu de 0.18 — quasi un cutoff dur.
    threshold: -0.12,
    smoothness: 0.18,
  },
  atmosphere: {
    // Diffusion analytique single-pass (voir AtmosphereShader). power élevé = bord
    // fin ; nightWrap conserve uniquement une frange crépusculaire très faible.
    power: 3.0,
    intensity: 1.35,
    nightWrap: 0.08,
    rayleighStrength: 1.0,
    mieStrength: 0.55,
    mieG: 0.76,
    opticalDepth: 3.2,
    defaultColor: 0x4a90e0,
  },
};

export const BLOOM_SETTINGS = {
  // Passe de post-process coûteuse sur GPU intégré → réservée au palier `high`. Le seuil
  // élevé sélectionne les sources très lumineuses (Soleil, villes) sans faire baver les
  // planètes. Levier ajustable à chaud (la passe est ajoutée/retirée du composer).
  enabled: BOOT_QUALITY_PROFILE.bloom,
  // strength/radius relevés pour un halo de Soleil lisible (le réglage précédent
  // restait imperceptible à distance) ; le seuil reste haut pour ne pas faire
  // baver les planètes éclairées (elles plafonnent sous 0.85 après tone mapping).
  strength: 0.85,
  radius: 0.5,
  threshold: 0.85,
};

// Variation procédurale très faible de la rugosité océanique Earth. Elle agit uniquement
// dans le shader : la spec map et son canal vert restent donc la source intacte du masque
// océan utilisé par l'extraction des nuages réels.
export const EARTH_OCEAN_ROUGHNESS_SETTINGS = {
  land: 0.92,
  // Océan abaissé (0.08 → 0.06, min 0.055 → 0.04) : une mer sous vent faible vue de
  // l'espace a une rugosité ~0.03–0.06 et concentre le sun-glint en un point chaud net.
  // La variation procédurale reste identique → le masque océan (spec map, canal g) intact.
  oceanBase: 0.06,
  oceanVariation: 0.028,
  oceanMin: 0.04,
  oceanMax: 0.13,
  longitudeFrequencyA: 3,
  latitudeFrequencyA: 1,
  longitudeFrequencyB: 7,
  latitudeFrequencyB: 2,
  longitudeFrequencyC: 13,
  latitudeFrequencyC: 4,
} as const;
// Couverture nuageuse RÉELLE de la Terre depuis NASA GIBS (imagerie satellite
// quotidienne), synchronisée sur la date de la simulation. Remplace la couche
// nuages statique quand disponible ; repli automatique sur la texture statique
// hors-ligne / date hors plage. Voir core/gibsClouds.ts (URL/date) et
// ui/realtimeClouds.ts (chargement + application). Un seul endroit à régler.
export const REALTIME_CLOUDS_SETTINGS = {
  enabled: true,
  // Résolution de l'image équirectangulaire (2:1). 2048×1024 ≈ 150–300 Ko.
  resolution: 2048,
  // Latence de publication GIBS : « aujourd'hui » charge J-latencyDays. L'imagerie VIIRS/MODIS
  // est une fauchée ORBITALE : la tuile de J-1 est souvent INCOMPLÈTE (dernière orbite non finie
  // → bande no-data → « calvitie » au pôle une fois mappée sur la sphère). J-2 est complète.
  latencyDays: 2,
  // Extraction shader : seuils de luminance (min RGB) et de saturation max pour ne
  // garder que les nuages (blanc désaturé lumineux) et rejeter le sol coloré. Deux
  // seuils bas : sur l'océan (fond sombre) on capte même les nuages fins ; sur la
  // terre (sable clair ≈ nuage) on n'accepte que les nuages francs (lumLowLand plus
  // haut). La distinction eau/terre vient du canal g de la spec map surface.
  cloudLuminanceLow: 0.32,
  cloudLuminanceLowLand: 0.55,
  cloudLuminanceHigh: 0.62,
  cloudSaturationMax: 0.3,
  // Relèvement du seuil de saturation SUR L'OCÉAN : l'eau/banquise froide (Arctique) est bleutée
  // → sans ce boost le filtre de désaturation effaçait les nuages polaires (« disque bleu vide »
  // au nord). Sur mer, pas de sol coloré à rejeter → on tolère plus de saturation. 0 = ancien
  // comportement (seuil identique terre/mer).
  cloudSatOceanBoost: 0.45,
  // Un pixel True Color sombre reste une observation valide, notamment sur l ocean.
  // Seuls les pixels presque noirs sont consideres sans observation optique. La fenêtre
  // (Low→High) définit la LARGEUR du fondu entre la True Color et les masques MODIS : trop
  // étroite (0.01→0.08), la jonction se fait sur une bande mince → « déchirure » circulaire
  // visible au Sud. Élargie (0.02→0.22), le recouvrement s'étale sur plus de latitudes →
  // continuité douce entre les deux sources de nuages, sans ligne de coupure.
  cloudOpticalAvailabilityLow: 0.02,
  cloudOpticalAvailabilityHigh: 0.12,
  // Rayon (en texels) de lissage autour des frontières True Color/no-data. Les produits
  // orbitaux changent parfois de couverture sur une ligne nette ; une petite moyenne spatiale
  // évite de voir la jonction avec le masque MODIS sans flouter la texture nuageuse.
  cloudOpticalBlendRadiusTexels: 8,
  // Rayon (en texels) de la bande verticale sur laquelle la COUVERTURE MODIS (alpha binaire :
  // 1 sur la fauchée, 0 hors) est moyennée en une rampe douce. Plus il est grand, plus la
  // jonction entre les nuages MODIS (Sud) et la True Color est ÉTALÉE (fondu progressif au lieu
  // d'une ligne = « déchirure »). Valeur modérée : un rayon trop grand ÉTALE les bandes de
  // fauchée orbitale MODIS (blocs géométriques) au lieu de les fondre — le vrai problème du
  // Sud est un TROU de données (fauchée), pas une jonction. 12 = jonction douce sans étaler.
  cloudCoverageBlendRadiusTexels: 12,
  // Force du remplissage satellite nocturne dans les pixels True Color sans lumière.
  // Force de la fraction nuageuse MODIS diurne lorsqu'un pixel satellite est valide.
  cloudDayStrength: 0.95,
  cloudNightFallbackStrength: 0.95,
  // Remplissage de secours uniquement dans la bande polaire sans donnée NASA, depuis la carte statique complète.
  // Désactivé par défaut pour distinguer les données NASA du vieux fond nuageux statique.
  cloudStaticPolarFallbackStrength: 0,
  // Ne charge ni n'affiche l'ancienne carte statique pendant que NASA est la source principale.
  // À réactiver explicitement seulement pour un mode hors-ligne ou une démonstration.
  cloudStaticTextureFallbackEnabled: false,
  // Faible auto-éclairage des nuages confirmés dans la nuit polaire : l'alpha reste celui de la donnée.
  // Adoucissement des bords : le seuil de désaturation est étalé sur cette largeur pour
  // rendre les lisières de nuages plus vaporeuses (moins de découpe nette). 0 = bord dur.
  edgeSoftness: 0.15,
  // Opacité globale de la couche nuages réelle (0..1).
  opacity: 0.72,
  // Étape B — seuil d'octets sous lequel une tuile GIBS est jugée VIDE (→ fallback MODIS).
  // Mesuré : tuile vide 2–8 Ko, réelle 80–180 Ko. 20 Ko sépare largement les deux.
  minTileBytes: 20_000,
};

/** Grille commune des modèles Open-Meteo : forecast plus fin, archive ERA5 plus grossière. */
export const METEO_MODEL_GRID_SETTINGS = {
  gridStep: 4,
  archiveGridStep: 8,
  maxLat: 90,
};

// Couche nuages MODÉLISÉE (famille B) : couverture nuageuse Open-Meteo (cloud_cover, %) sur
// grille mondiale → texture équirectangulaire (alphaMap) plaquée sur la couche nuages. Contrai-
// rement au satellite (REALTIME_CLOUDS_SETTINGS), la donnée est GLOBALE SANS TROU et offre le
// passé (réanalyse) + le futur (prévision). Couche COMMUTABLE : l'utilisateur choisit satellite
// ou modèle (une seule active sur le mesh nuages). Voir core/meteoGrid.ts + ui/cloudModelLayer.ts.
export const CLOUD_MODEL_SETTINGS = {
  ...METEO_MODEL_GRID_SETTINGS,
  // Disponible dans le panneau, mais invisible par défaut : le satellite reste le rendu principal.
  enabled: true,
  // Visibilité initiale indépendante de la disponibilité de la couche.
  initial: false,
  // La fenêtre temporelle (past/forecast days, archive vs forecast) est calculée par
  // core/meteoTimeTravel.ts selon la date de simulation — plus de fenêtre fixe ici.
  // Gamma appliqué à la couverture (0..1) : < 1 renforce les nuages fins pour qu'ils restent
  // visibles depuis l'espace (sinon seuls les fronts denses ressortent).
  gamma: 0.7,
  // Opacité globale de la couche nuages modélisée (0..1).
  opacity: 0.85,
};

// Couches TEMPÉRATURE et PLUIE MODÉLISÉES (famille B, Open-Meteo grille). Comme la couche nuages
// modèle : globales sans trou, passé (ERA5) + présent + futur (prévision), colorées via palette
// (core/meteoPalette.ts). Commutables avec leurs équivalents satellite/GIBS (THERMAL/PRECIP).
// Grilles calquées sur CLOUD_MODEL_SETTINGS (forecast fine, archive grossière). Voir
// ui/meteoModelLayer.ts + ui/thermalModelLayer.ts + ui/precipModelLayer.ts.
export const THERMAL_MODEL_SETTINGS = {
  ...METEO_MODEL_GRID_SETTINGS,
  enabled: true,
  variable: 'temperature_2m',
  // Assez opaque pour lire la palette, assez bas pour laisser transparaître le relief sous la teinte.
  opacity: 0.72,
};
export const PRESSURE_MODEL_SETTINGS = {
  ...METEO_MODEL_GRID_SETTINGS,
  enabled: true,
  variable: 'pressure_msl',
  opacity: 0.55,
};
export const HUMIDITY_MODEL_SETTINGS = {
  ...METEO_MODEL_GRID_SETTINGS,
  enabled: true,
  variable: 'relative_humidity_2m',
  opacity: 0.6,
};
export const PRECIP_MODEL_SETTINGS = {
  ...METEO_MODEL_GRID_SETTINGS,
  // Disponible sur mobile et desktop, mais non activée par défaut sur mobile ;
  // le palier low la désactive.
  enabled: BOOT_QUALITY_TIER !== 'low',
  variable: 'precipitation',
  opacity: 0.85,
  // Sous ce taux (mm/h), le pixel est transparent (il ne « pleut » pas) ; rampe douce au-dessus.
  transparentBelow: 0.1,
  alphaRamp: 0.5,
};

// Couche PLUIE mondiale (NASA IMERG, taux de précipitation toutes les 30 min).
// Superposée aux nuages, remappée en nuages d'orage réalistes (createPrecipMaterial).
// On affiche la frame RÉELLE de l'instant de simulation : la pluie change au rythme réel
// des données (nouvelle image toutes les 30 min), jamais en time-lapse accéléré. Elle
// « bouge » quand le temps de simulation avance (lecture accélérée) ou en time-travel.
export const PRECIP_SETTINGS = {
  // Couche satellite lourde : disponible sur mobile et desktop, mais non activée
  // par défaut sur mobile ; le palier low la désactive.
  enabled: BOOT_QUALITY_TIER !== 'low',
  layer: 'IMERG_Precipitation_Rate_30min',
  resolution: 1024,
  // Latence de publication IMERG (heures) : « maintenant » vise now - latencyHours. Mesuré
  // sur GIBS (2026-08) : les frames < ~6 h reviennent VIDES (donnée pas encore publiée). On
  // prend 12 h de marge — la frontière dérive dans la journée selon la run (Early/Late) et
  // 12 h reste « quasi temps réel » à l'échelle d'une visualisation.
  latencyHours: 12,
  minDate: '2000-06-01',
  // Opacité globale de la couche pluie.
  opacity: 0.85,
  // Étape B — fallback : nb de pas de 30 min à reculer pour combler un trou de latence/donnée
  // avant de basculer sur l'IMERG quotidien. 6 pas = 3 h de marge.
  stepBack: 6,
  // Seuil d'octets sous lequel une tuile IMERG est jugée vide (→ candidat suivant).
  minTileBytes: 15_000,
  // --- Remap intensité → dégradé bleu (voir PRECIP_REMAP_GLSL). Réglages fins du rendu ---
  // L'intensité est décodée depuis la TEINTE de la palette IMERG : rouge (0°) = intense,
  // cyan (hueRainMaxDeg) = très faible. Abaisser hueRainMaxDeg resserre l'échelle vers le vert.
  hueRainMaxDeg: 210,
  // Bornes de teinte (deg) de la branche NEIGE (bleu→violet saturé), séparée de la pluie.
  hueSnowLoDeg: 210,
  hueSnowHiDeg: 225,
  // Saturation minimale pour qu'un bleu compte comme neige (évite de capter un bleu délavé).
  snowSatMin: 0.25,
  // Répartition du dégradé bleu sur l'intensité (0..1) : la pluie faible reste sous rampMid,
  // seuls les vrais cœurs intenses (> rampDeep) atteignent le bleu ultra-foncé.
  rampMid: 0.55,
  rampDeep: 0.7,
  // Densité (opacité locale) : plancher pour la pluie faible (rester visible sans noyer la
  // surface) → 1 pour les cœurs. Adoucissement des bords de cellule (anti-scintillement).
  densityFloor: 0.5,
  edgeSoftness: 0.12,
};

// Couche TEMPÉRATURE de surface (MERRA-2, température de l'air 2 m, MENSUELLE). Overlay coloré
// (palette arc-en-ciel violet froid → rouge chaud) sur TERRE + MER. Réanalyse modèle → couverture
// GLOBALE TOTALE, champ lisse SANS trous ni bandes (contrairement aux couches satellite
// quotidiennes AIRS/MODIS, criblées de swath gaps). Archive depuis 1980. Mensuelle : la date est
// snappée au 1er du mois. Chargée dès le boot mais MASQUÉE : le panneau météo la révèle.
export const THERMAL_SETTINGS = {
  enabled: true,
  layer: 'MERRA2_2m_Air_Temperature_Monthly',
  // Résolution de l'image équirectangulaire (2:1). MERRA-2 est basse résolution native (~0.5°) ;
  // 2048 suffit largement (le champ est lisse), inutile de sur-échantillonner.
  resolution: 2048,
  // Latence de publication (mois) : point de départ optimiste ; le FALLBACK (stepBackMonths)
  // recule ensuite jusqu'au dernier mois réellement publié si celui-ci est vide. MERRA-2
  // mensuel sort avec ~2–3 mois de retard → 1 + recul couvre le cas.
  latencyMonths: 1,
  minDate: '1980-01-01',
  // Étape B — nb de mois à reculer pour trouver un mois publié (fallback thermal).
  stepBackMonths: 4,
  // Seuil d'octets sous lequel une tuile MERRA-2 est jugée vide (→ mois précédent).
  minTileBytes: 20_000,
  // Opacité globale de l'overlay thermique (0..1). Assez pour lire les couleurs, assez bas
  // pour laisser transparaître le relief/la surface Terre sous la teinte (pas un aplat).
  opacity: 0.62,
  // Visible au démarrage ? Non : révélée par le toggle du panneau météo.
  visibleByDefault: false,
};

// Couche VENT : particules advectées par le champ de vent réel (Open-Meteo GFS).
// Voir core/windField.ts, components/celestial/WindParticles.ts, ui/windLayer.ts.
// DÉSACTIVÉE pour l'instant (rendu peu lisible en particules CPU) : le code est conservé
// pour servir de base à l'estimation temps réel du « Chemin B » (données vent exploitées
// pour reconstruire un état atmosphérique, pas seulement affichées).
export const WIND_SETTINGS = {
  // Rendu particulaire en prototype ; les données restent conservées pour la simulation future
  // ou le remplissage de données manquantes.
  enabled: false,
  // Pas de la grille de vent (degrés). 10° = 612 points en une requête.
  gridStep: 10,
  // Latitude absolue max couverte par la grille (et donc par les particules) : au-delà,
  // le vent est extrapolé/clampé → paquets figés aux pôles. On garde grille ET
  // ensemencement des particules dans cette bande pour éviter l'entassement polaire.
  maxLat: 80,
  // Nombre de particules (advection CPU).
  particleCount: 3500,
  // Vitesse d'advection : degrés de déplacement par (km/h · s). Réglé pour un flux lisible.
  speedScale: 0.02,
  // Dérive minimale (km/h équivalents) ajoutée au champ : empêche les particules en vent
  // calme de stagner et de former des amas statiques scintillants.
  minDriftKmh: 6,
  // Durée de vie moyenne d'une particule (s) avant ré-ensemencement (traînées).
  lifeSeconds: 4,
  // Opacité globale : filet lumineux DISCRET qui s'ajoute à la surface (additif).
  opacity: 0.35,
  // Taille de base d'un point (unités monde ; rayon Terre ≈ 1). Petit = flux fin.
  size: 0.01,
  // Vitesse (km/h) qui sature l'échelle de couleur (cyan calme → jaune tempête).
  speedMax: 90,
  // Décalage de longitude (rad) pour aligner les particules sur la texture équirectangulaire.
  // SphereGeometry Three.js met u=0 (bord gauche de la texture) à theta=0 ; une texture
  // Blue Marble standard est centrée sur Greenwich (lon 0 → u=0.5), soit un demi-tour de
  // décalage → π. (Si le flux paraît tourné de 90°, ajuster par ±π/2 selon la texture.)
  lonOffset: Math.PI,
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
