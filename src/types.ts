/**
 * Interfaces TypeScript partagées par toute l'application : configuration des corps
 * célestes, de leurs textures et de leurs anneaux, données astronomiques réelles, et le
 * contrat `IUpdatable` des objets mis à jour à chaque frame.
 */
import type * as THREE from 'three';
import type { Body } from 'astronomy-engine';
import type { OrbitalElements } from './core/kepler';

export type { OrbitalElements };

/** Résolutions de texture disponibles (du plus léger au plus détaillé). */
export type TextureQuality = '1k' | '2k' | '4k' | '8k';

/**
 * Catégorie d'un corps — remplace les tests par nom (`name === 'sun'`…).
 * Les petits corps (`asteroid` / `comet` / `dwarf`) sont positionnés par éléments orbitaux
 * (cf. `orbitalElements`) et rendus sans texture : leur taille physique réelle les rend
 * invisibles à l'œil nu, conformément à l'invariant du mode Exploration.
 */
export type BodyKind =
  | 'star'
  | 'planet'
  | 'moon'
  | 'skybox'
  | 'asteroid'
  | 'comet'
  | 'dwarf';

/** Catégories de petits corps — positionnés par éléments orbitaux, hors barre de navigation. */
export const SMALL_BODY_KINDS: ReadonlySet<BodyKind> = new Set<BodyKind>([
  'asteroid',
  'comet',
  'dwarf',
]);

/** Référentiel de position d'un corps. */
export type OrbitFrame = 'heliocentric' | 'parentRelative';

/** Distance de visite caméra par mode d'affichage (unités scène). */
export interface CameraDistance {
  educ:  number;
  explo: number;
}

export interface TextureConfig {
  surface?: string;
  normalMap?: string;
  bump?: string;
  spec?: string;
  specularMap?: string;
  clouds?: string;
  atmosphere?: string;
  lights?: string;
}

export interface TextureResolutions {
  surface?: TextureQuality[];
  normalMap?: TextureQuality[];
  bump?: TextureQuality[];
  spec?: TextureQuality[];
  specularMap?: TextureQuality[];
  clouds?: TextureQuality[];
  atmosphere?: TextureQuality[];
  lights?: TextureQuality[];
}

export interface RingConfig {
  bodyName: string;
  innerRadius: number;
  outerRadius: number;
  textureResolutions: TextureQuality[];
  textures: string;
}

export interface CelestialBodyConfig {
  /** Catégorie — pilote le traitement (rendu, orbite, hiérarchie de scène). */
  kind: BodyKind;
  radius: number;
  rotationSpeed: number;
  orbitalRadius: number;
  orbitalColor: number;
  textureResolutions: TextureResolutions;
  textures: TextureConfig;
  ring?: RingConfig;
  satellites?: Record<string, CelestialBodyConfig>;
  /** Données astronomiques réelles — utilisées par OrbitalMechanics en mode Explo. */
  realData?: RealData;
  /** Enum astronomy-engine pour les positions réelles. Absent = pas d'éphéméride (étoile fixe, skybox). */
  astroBody?: Body;
  /**
   * Éléments orbitaux képlériens — source de position alternative à `astroBody`, pour les
   * corps absents d'astronomy-engine (astéroïdes, comètes, géocroiseurs, planètes naines).
   * Utilisés seulement si `astroBody` est absent. Propagés par `OrbitalElementsService`.
   */
  orbitalElements?: OrbitalElements;
  /** Référentiel de position : héliocentrique (planètes) ou relatif au parent (lunes).
   *  Défaut heliocentric. */
  frame?: OrbitFrame;
  /** Distance de visite caméra par mode. Absent = fallback générique. */
  cameraDistance?: CameraDistance;
  /** Rang de préchargement des textures (croissant, 0 = en premier). Absent = non prioritaire. */
  loadPriority?: number;
}

export interface CelestialConfig {
  bodies: Record<string, CelestialBodyConfig>;
}

/** Données astronomiques réelles d'un corps. */
export interface RealData {
  /** Rayon physique en km — utilisé pour la vraie échelle en mode Explo. */
  radiusKm?:        number;
  /** Distance en UA depuis le Soleil (ou la Terre pour la Lune) — référence documentaire. */
  distanceAU?:      number;
  /** Période orbitale en jours — utilisée pour calculer les points d'orbite 3D. */
  orbitPeriodDays?: number;
  /** Inclinaison orbitale en radians (angle du plan orbital par rapport à l'écliptique). */
  orbitalInclination?: number;
  /** Longitude du nœud ascendant en radians (rotation du plan orbital autour du pôle écliptique). */
  ascendingNode?: number;
  /** Obliquité en radians — inclinaison de l'axe par rapport au **plan orbital** du corps.
   *  L'orientation précise de l'axe (obliquité + azimut dans le repère écliptique) est
   *  dérivée du modèle IAU via EphemerisService.getNorthPoleDirection ; ce champ sert
   *  au fallback initial et au test rétrograde :
   *  > 90° = rotation rétrograde (Vénus ≈ 177°, Uranus ≈ 98°). */
  axialTilt?: number;
}

/**
 * Contrat partagé entre AnimationSystem et tous les objets mis à jour chaque frame.
 *
 * - `group` est optionnel : AnimationSystem l'utilise pour le frustum culling
 *   centralisé ; les objets sans rendu 3D peuvent implémenter IUpdatable sans group.
 * - `visible` est passé par AnimationSystem plutôt que calculé dans chaque objet
 *   pour éviter de recalculer le frustum N fois par frame (une seule passe centralisée).
 * - `updateLODTextures` est optionnel : tous les objets n'ont pas de textures LOD
 *   (ex. la skybox des étoiles utilise toujours la même résolution).
 */
export interface IUpdatable {
  group?: THREE.Group;
  update(delta: number, sunWorldPosition: THREE.Vector3 | null, visible: boolean, cameraPosition?: THREE.Vector3): void;
  updateLODTextures?(camera: THREE.Camera, maxDistance: number, threshold: number): Promise<void>;
}
