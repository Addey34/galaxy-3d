import type { ModelQuality } from '@/core/modelLod';
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
 * (cf. `orbitalElements`). Ceux qui disposent d'une texture ont un mesh ; les autres restent
 * des marqueurs, conformément à l'invariant de vraie taille du mode Exploration.
 */
export type BodyKind =
  | 'star'
  | 'planet'
  | 'moon'
  | 'skybox'
  | 'asteroid'
  | 'comet'
  | 'dwarf'
  /**
   * Objets de la COUCHE INSTRUMENT : sondes et objets interstellaires. Ils ne vivent pas dans
   * `CELESTIAL_CONFIG` (cf. `config/navigable.ts`) — aucun mesh, aucune orbite fermée, aucune
   * page — mais portent une catégorie pour que l'interface les groupe et les nomme sans tester
   * leur nom, comme pour tous les autres corps.
   */
  | 'spacecraft'
  | 'interstellar';

/** Catégories portées par la couche instrument, jamais par le catalogue de la scène. */
export const INSTRUMENT_KINDS: ReadonlySet<BodyKind> = new Set<BodyKind>([
  'spacecraft',
  'interstellar',
]);

/** Catégories de petits corps — positionnés par éléments orbitaux, hors barre de navigation. */
export const SMALL_BODY_KINDS: ReadonlySet<BodyKind> = new Set<BodyKind>([
  'asteroid',
  'comet',
  'dwarf',
]);

/** Référentiel de position d'un corps. */
export type OrbitFrame = 'heliocentric' | 'parentRelative';

/** Corps jovien supporté par le modèle d'éphémérides astronomy-engine. */
export type JupiterMoonKey = 'io' | 'europa' | 'ganymede' | 'callisto';

/** Source d'une position relative fournie par une éphéméride spécialisée. */
export type RelativeEphemerisSource =
  | { kind: 'jupiterMoon'; moon: JupiterMoonKey }
  | { kind: 'horizonsParentRelative' };

/** Distance de visite caméra par mode d'affichage (unités scène). */
export interface CameraDistance {
  educ: number;
  explo: number;
}

export interface TextureConfig {
  surface?: string;
  normalMap?: string;
  bump?: string;
  /** Carte de hauteur pour le displacement vertex réel (relief géométrique). */
  displacement?: string;
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
  displacement?: TextureQuality[];
  spec?: TextureQuality[];
  specularMap?: TextureQuality[];
  clouds?: TextureQuality[];
  atmosphere?: TextureQuality[];
  lights?: TextureQuality[];
}

/**
 * Modèle de forme 3D d'un corps irrégulier (astéroïde, noyau cométaire).
 *
 * Une sphère texturée ne dit rien de vrai d'un corps de quelques centaines de mètres : ce qui
 * distingue Bennu, c'est sa forme de toupie, pas sa couleur. Le maillage vient d'un modèle de
 * forme scientifique décimé par `scripts/decimate-shape-model.mjs`.
 *
 * Deux conventions que le fichier DOIT respecter, tenues par `config/shapeModels.test.ts` :
 *   - **le pôle sur +Y** (la scène fait tourner chaque corps autour de son Y local ; les
 *     produits PDS portent le pôle sur Z — `decimate-shape-model.mjs --z-up` le déplace) ;
 *   - **un volume qui retrouve le rayon moyen du catalogue** : le modèle est mis à l'échelle par
 *     son rayon ÉQUIVALENT-VOLUME et centré sur son centre de masse (`core/modelFit.ts`).
 *
 * **La sphère reste construite** même quand un modèle est déclaré : elle est simplement masquée
 * quand le maillage arrive. Le repli n'est donc pas un cas particulier à écrire, c'est l'état
 * par défaut — réseau coupé, fichier absent, glTF illisible, appareil qui abandonne : le corps
 * reste visible et rond, jamais absent.
 */
export interface ModelConfig {
  /**
   * Niveaux de détail livrés, du plus fin au plus léger. Les chemins en DÉRIVENT
   * (`catalog.modelPath`, `/assets/models/{corps}/{corps}_shape_{niveau}.glb`) : aucun chemin
   * n'est écrit à la main, comme pour les textures. Un niveau n'est livré que si la source
   * scientifique contient assez de détail pour lui (Ida : pas de 4k).
   */
  resolutions: readonly ModelQuality[];
  /**
   * Crédit à afficher. Obligatoire : un maillage tiers sans provenance ne doit pas entrer dans
   * le dépôt (le registre `src/registry/products/` tient la même règle pour les textures).
   */
  credit: LocalizedText;
  /**
   * Rayon MAXIMAL du maillage rapporté à son rayon équivalent-volume (celui du catalogue),
   * mesuré sur le fichier livré et tenu par `shapeModels.test.ts`. Sert à la caméra : elle
   * s'arrête à `rayon × extentRatio × facteur`, sinon approcher un corps irrégulier « à 1,15
   * rayon » met l'objectif DEDANS — Éros et Ida dépassent le double de leur rayon moyen, et
   * l'écran devient noir sans la moindre erreur.
   */
  extentRatio: number;
  /**
   * Albédo géométrique PUBLIÉ (bande V), avec sa référence dans `albedoSource`. Il fixe la
   * luminosité moyenne cuite dans le modèle par `scripts/bake-shape-colour.mjs`, à la convention
   * d'affichage mesurée sur la texture lunaire — `shapeModels.test.ts` le vérifie sur chaque
   * niveau livré.
   */
  albedo: number;
  albedoSource: string;
  /**
   * Carte de mission d'où viennent les CONTRASTES et la couleur, ou `null` si aucune carte
   * globale n'existe : le corps reçoit alors une couleur uniforme à son albédo, sans rien inventer.
   */
  colourSource: LocalizedText | null;
}

export interface RingConfig {
  bodyName: string;
  innerRadius: number;
  outerRadius: number;
  textureResolutions: TextureQuality[];
  /** Chemin de base ; dérivé de la clé du corps si absent (`{body}/{body}_ring`). */
  textures?: string;
}

/** Chaîne localisée (contenu catalogue). L'anglais sert de repli. */
export interface LocalizedText {
  en: string;
  fr: string;
}

export interface CelestialBodyConfig {
  /** Catégorie — pilote le traitement (rendu, orbite, hiérarchie de scène). */
  kind: BodyKind;
  /**
   * Nom d'affichage localisé. Absent → nom capitalisé depuis la clé du catalogue (correct en
   * anglais pour tous les corps actuels). Renseigner par langue seulement là où le nom diffère
   * de la clé capitalisée (français : Terre, Soleil, Vénus…).
   */
  displayName?: { en?: string; fr?: string };
  radius: number;
  rotationSpeed: number;
  orbitalColor: number;
  textureResolutions: TextureResolutions;
  /**
   * Chemins de texture par couche. Normalement **dérivé** de la clé du corps +
   * `textureResolutions` (voir `catalog.deriveTextures`, peuplé au chargement) ; ne l'écrire
   * à la main que pour un override rare. Optionnel dans la définition brute du catalogue,
   * toujours peuplé après initialisation (`bodies.ts` appelle `deriveTextures`).
   */
  textures?: TextureConfig;
  /** Couleur de secours pour représenter un corps sans texture locale. */
  fallbackColor?: number;
  /** Modèle de forme 3D — remplace la sphère quand il charge. Voir `ModelConfig`. */
  model?: ModelConfig;
  /** Teinte du halo atmosphérique (Fresnel). Défaut : bleu ciel. */
  atmosphereColor?: number;
  ring?: RingConfig;
  satellites?: Record<string, CelestialBodyConfig>;
  /** Données astronomiques réelles — utilisées par OrbitalMechanics en mode Explo. */
  realData?: RealData;
  /** Enum astronomy-engine pour les positions réelles. Absent = pas d'éphéméride (étoile fixe, skybox). */
  astroBody?: Body;
  /** Corps dont le pôle de rotation sert de repère aux satellites synchrones. */
  rotationBody?: Body;
  /**
   * Corps astronomy-engine utilisé pour la POSITION héliocentrique, si différent d'`astroBody`.
   * Cas Terre : `Body.EMB` (barycentre Terre-Lune) → supprime le ballant lunaire réel
   * (~4700 km, période ~27 j) qui, à vraie échelle et à vitesse max, se voit comme une
   * oscillation. `astroBody` reste `Body.Earth` pour l'axe de rotation / le jour-nuit.
   * Sert aussi de référence parent pour les satellites `parentRelative`. Défaut : `astroBody`.
   */
  positionBody?: Body;
  /**
   * Source d'éphéméride relative spécialisée, par exemple les lunes joviennes.
   * Le corps doit vivre dans un parent avec frame parentRelative.
   */
  relativeEphemeris?: RelativeEphemerisSource;
  /**
   * Keplerian orbital elements expressed in the parent body's reference frame. Used for
   * regular satellites without a dedicated astronomy-engine ephemeris.
   */
  relativeOrbitalElements?: OrbitalElements;
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
  radiusKm?: number;
  /** Distance en UA depuis le Soleil (ou la Terre pour la Lune) — référence documentaire. */
  distanceAU?: number;
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

  // ── Champs documentaires (fiche d'info, `ui/bodyInfo`) — non utilisés par la simulation. ──
  /** Masse en kg. */
  massKg?: number;
  /** Gravité de surface en m/s². */
  gravity?: number;
  /** Température moyenne de surface en °C (sommet des nuages pour les géantes gazeuses). */
  meanTempC?: number;
  /** Nombre de satellites naturels connus. */
  moonCount?: number;
  // ── Objets de la couche instrument (`config/navigable.ts`) ────────────────────────────────
  // Ces champs ne décrivent AUCUN corps du catalogue : une planète n'a pas de date de
  // lancement, et l'excentricité d'une orbite fermée n'est pas une grandeur que Galaxy publie.
  // Ils vivent ici parce qu'une sonde et un objet interstellaire portent le même
  // `CelestialBodyConfig` que le reste (voir `config/navigable.ts`), et `core/bodyFacts.ts`
  // déclare lesquels s'appliquent à quel `kind`.
  /** Date de lancement d'une sonde, `AAAA-MM-JJ`. */
  launchDate?: string;
  /** Première observation retenue par la solution d'orbite, `AAAA-MM-JJ`. */
  firstObservation?: string;
  /** Excentricité de l'orbite — publiée pour les seuls interstellaires, où elle dépasse 1. */
  eccentricity?: number;
  /** Distance de périhélie en UA. */
  perihelionAU?: number;
  /** Lanceur d'une sonde, nom propre recopié tel que la source l'écrit. */
  launchVehicle?: string;
  /** Site de lancement d'une sonde, nom propre recopié tel que la source l'écrit. */
  launchSite?: string;
  /** Magnitude absolue H d'un interstellaire (pas M1, la magnitude totale d'une comète). */
  absoluteMagnitude?: number;

  /** Courte description grand public, localisée (FR/EN). Affichée par `ui/bodyInfo`. */
  description?: LocalizedText;
  /** Lien « En savoir plus » par langue (article Wikipédia dédié). Affiché par `ui/bodyInfo`. */
  wiki?: LocalizedText;

  /**
   * PROVENANCE de chaque fait affiché : source primaire, méthode, date de validité. La valeur
   * reste dans son champ historique (`radiusKm`…), que la simulation lit ; la provenance vit à
   * côté, champ par champ, pour que la migration se fasse corps par corps sans rien casser.
   *
   * Un fait affiché SANS provenance n'est pas affiché comme un fait : `core/bodyFacts.ts` le
   * rend « pas encore sourcé », et `config/factProvenance.test.ts` refuse le catalogue qui en
   * contient un. Détail et exemples dans `config/factSources.ts`.
   */
  sources?: Partial<Record<FactField, FactProvenance>>;

  /**
   * Champs dont on n'AFFICHE pas de valeur, avec la raison, localisée.
   *
   * Un champ simplement absent est ambigu : l'utilisateur ne peut pas distinguer « la science
   * ne donne pas ce chiffre » de « le catalogue l'a oublié ». La fiche d'information affiche
   * donc ces champs avec une marque « n/a » et la raison en infobulle, plutôt que de faire
   * disparaître la ligne.
   *
   * Deux cas, distingués par `unsourced` :
   *   - absent : aucune valeur publiée unique n'existe (une plage, une limite supérieure) ;
   *   - `unsourced: true` : une valeur existe peut-être, mais Galaxy ne l'a pas encore rattachée
   *     à une source primaire. Le champ peut alors garder la valeur dont la SIMULATION a besoin
   *     (obliquité 0 d'une lune synchrone, rayon de rendu) : elle n'est simplement pas publiée.
   *
   * Ne PAS confondre avec une donnée non applicable : le Soleil n'a pas de période orbitale
   * parce qu'il est l'origine du repère, ce n'est pas une inconnue. Ce cas-là se déduit du
   * `kind` et ne se déclare pas ici.
   *
   * Renseigner une moyenne inventee pour combler une case serait pire que la case vide :
   * rien ne distinguerait alors une valeur mesuree d'une valeur fabriquee.
   */
  unknown?: Partial<Record<UnknownableField, UnknownReason>>;
}

/** Raison d'une valeur non affichée — voir `RealData.unknown`. */
export interface UnknownReason extends LocalizedText {
  /** Vrai : la valeur n'est pas encore rattachée à une source primaire (≠ non publiée). */
  unsourced?: boolean;
}

/**
 * Faits documentaires qu'affichent la fiche d'un corps et sa page publique. `rotationPeriod`
 * n'a pas de champ dans `RealData` : il se lit dans `rotationSpeed`, que la simulation utilise.
 *
 * Les sept derniers ne concernent QUE la couche instrument (sondes, interstellaires) ;
 * `core/bodyFacts.notApplicableFacts` dit lesquels s'appliquent à quel `kind`, de sorte
 * qu'aucune fiche ne montre une ligne vide pour un fait qui n'a pas de sens chez elle.
 */
export type FactField =
  | 'radiusKm'
  | 'massKg'
  | 'gravity'
  | 'meanTempC'
  | 'moonCount'
  | 'axialTilt'
  | 'distanceAU'
  | 'orbitPeriodDays'
  | 'rotationPeriod'
  | 'launchDate'
  | 'firstObservation'
  | 'eccentricity'
  | 'perihelionAU'
  | 'launchVehicle'
  | 'launchSite'
  | 'absoluteMagnitude';

/** Champs documentaires qui peuvent n'avoir aucune valeur affichée (cf. `RealData.unknown`). */
export type UnknownableField = FactField;

/**
 * Comment la valeur a été obtenue :
 *   - `measured` : la valeur est celle que la source publie, à l'arrondi près ;
 *   - `derived` : calculée à partir de valeurs publiées par la source (masse = GM/G, gravité
 *     = GM/R², rayon = diamètre/2, obliquité depuis le pôle publié…) ;
 *   - `illustrative` : valeur de présentation, jamais une mesure. Affichée comme telle.
 */
export type FactMethod = 'measured' | 'derived' | 'illustrative';

/** Provenance d'un fait affiché. */
export interface FactProvenance {
  /** Identifiant dans le registre `FACT_SOURCES` (`config/factSources.ts`). */
  source: string;
  method: FactMethod;
  /**
   * Date à laquelle la valeur est valable, `AAAA-MM` ou `AAAA-MM-JJ`. OBLIGATOIRE pour un fait
   * qui évolue (nombre de lunes connues) : « 115 lunes » n'est vrai qu'à une date.
   */
  asOf?: string;
  /** Incertitude à 1 σ publiée par la source, dans l'unité du champ (radians pour `axialTilt`). */
  uncertainty?: number;
  /** Ce que la source mesure exactement, quand le libellé affiché est plus large. */
  detail?: LocalizedText;
  /** Référence originale citée par une base de données (SBDB : « Park et al. 2025 »…). */
  citation?: string;
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
  update(
    delta: number,
    sunWorldPosition: THREE.Vector3 | null,
    visible: boolean,
    cameraPosition?: THREE.Vector3,
    moonWorldPosition?: THREE.Vector3 | null
  ): void;
  updateLODTextures?(
    camera: THREE.Camera,
    maxDistance: number,
    threshold: number
  ): Promise<void>;
}
