/**
 * CONVERTISSEUR des petits corps : éléments publiés (degrés, UA) → entrée du catalogue.
 *
 * Séparé des données (`smallBodies.ts`) au lot 7 pour que le chargeur du registre
 * (`src/registry/load.ts`) puisse l'appeler sans cycle d'import : c'est l'une des dérivations
 * déclarées du chargeur, pas un morceau du catalogue. Fonction pure, testée.
 */
import type { Body } from 'astronomy-engine';
import type { CelestialBodyConfig, ModelConfig, TextureQuality } from '@/types';
import { exploCameraDistance } from '@/core/ScaleService';
import { DEG_TO_RAD as D2R } from '@/core/MathConstants';
import { PLANETS_TO_SUN_MASS_RATIO } from '@/core/kepler';
import { DETAIL, NOT_YET_SOURCED, derived } from './factSources';

/** Éléments orbitaux d'un petit corps, dans les unités publiées (degrés, UA). */
export interface SmallBodyElements {
  /** Clé unique dans le catalogue (minuscule, sans espace). */
  name: string;
  /** Nom d'affichage localisé — renseigner par langue seulement là où il diffère de la
   *  clé capitalisée (français : Cérès, Hygie, Éris). Absent → clé capitalisée. */
  displayName?: { en?: string; fr?: string };
  /** Demi-grand axe (UA). */
  a: number;
  /** Excentricité. */
  e: number;
  /** Inclinaison (deg). */
  iDeg: number;
  /** Longitude du nœud ascendant Ω (deg). */
  omDeg: number;
  /** Argument du périhélie ω (deg). */
  wDeg: number;
  /** Anomalie moyenne à l'époque M₀ (deg). */
  maDeg: number;
  /** Époque de référence des éléments (ISO). */
  epoch: string;
  /**
   * Éléments rapportés au barycentre du Système solaire (Horizons `CENTER=500@0`) — choisi
   * corps par corps sur mesure, cf. `OrbitalElements.barycentric`.
   */
  barycentric?: boolean;
  /** Rayon physique moyen (km). */
  radiusKm: number;
  /** Catégorie — défaut 'asteroid'. */
  kind?: 'asteroid' | 'comet' | 'dwarf';
  /** Couleur d'orbite/marqueur (0xRRGGBB) — défaut selon la catégorie. */
  color?: number;
  /** Résolutions d'une texture de surface locale. Absent = corps sans mesh. */
  surfaceResolutions?: TextureQuality[];
  /** Couleur de secours (0xRRGGBB) quand aucune texture de surface n'existe —
   *  requise par `catalogValidation` si `surfaceResolutions` est absent. */
  fallbackColor?: number;
  /** Modèle de forme 3D (corps irrégulier) — la sphère reste le repli. Voir `ModelConfig`. */
  model?: ModelConfig;
  /** Rayon visuel en mode Éducatif. Absent = 0,1 unité. */
  visualRadius?: number;
  /** Période de rotation sidérale (heures). */
  rotationHours?: number;
  /** Obliquité de l'axe de rotation (degrés). */
  axialTiltDeg?: number;
  /**
   * Corps astronomy-engine dont le pôle WGCCRE oriente l'axe de rotation. `axialTiltDeg`
   * ne donne qu'une obliquité sans azimut : le corps est alors penché dans une direction
   * arbitraire du plan écliptique. Quand le pôle est publié (`RotationAxis` couvre Pluton),
   * le renseigner ici donne l'orientation complète — et surtout la même que celle de ses
   * satellites verrouillés, qui l'empruntent par ce même champ.
   */
  rotationBody?: Body;

  // ── Champs documentaires (fiche d'info) — mêmes unités que `RealData`. ──
  /** Masse en kg. */
  massKg?: number;
  /** Gravité de surface en m/s². */
  gravity?: number;
  /** Température moyenne de surface en °C. */
  meanTempC?: number;
  /** Nombre de satellites naturels connus. */
  moonCount?: number;
  /** Courte description grand public, localisée (FR/EN). */
  description?: { en: string; fr: string };
  /** Champs sans valeur publiée unique, avec leur raison (cf. `RealData.unknown`). */
  unknown?: NonNullable<CelestialBodyConfig['realData']>['unknown'];
  /**
   * Provenance des faits affichés (cf. `RealData.sources`). Distance et période n'y figurent
   * pas : `smallBodyToConfig` les dérive des éléments Horizons ci-dessus et déclare cette
   * provenance lui-même.
   */
  sources?: NonNullable<CelestialBodyConfig['realData']>['sources'];
  /** Lien « En savoir plus » par langue (article Wikipédia dédié). */
  wiki?: { en: string; fr: string };
  satellites?: Record<string, CelestialBodyConfig>;
}

const DEFAULT_COLOR: Record<NonNullable<SmallBodyElements['kind']>, number> = {
  asteroid: 0xb3956c,
  comet: 0x6fe6e8,
  dwarf: 0xc391e6,
};

/**
 * Convertit une ligne d'éléments (degrés/UA) en entrée de catalogue : angles en radians,
 * période dérivée du demi-grand axe (3ᵉ loi de Kepler). Une texture de surface peut être
 * déclarée pour les corps disposant d'un asset local ; les autres restent sans mesh.
 * Fonction pure, testée.
 */
export function smallBodyToConfig(el: SmallBodyElements): CelestialBodyConfig {
  const kind = el.kind ?? 'asteroid';
  // Un corps barycentrique orbite le Soleil PLUS les planètes : même μ que la propagation.
  const periodDays =
    (365.256 * Math.pow(el.a, 1.5)) /
    (el.barycentric ? Math.sqrt(1 + PLANETS_TO_SUN_MASS_RATIO) : 1);
  const inclinationRad = el.iDeg * D2R;
  const ascendingNodeRad = el.omDeg * D2R;

  return {
    kind,
    ...(el.displayName ? { displayName: el.displayName } : {}),
    // Rayon de base nominal : évite une division par zéro dans setScaleMode et sert aussi
    // de garde-fou de cadrage pour les corps sans mesh.
    radius: el.visualRadius ?? 0.1,
    rotationSpeed: el.rotationHours
      ? (Math.PI * 2) / (el.rotationHours * 3_600)
      : 0,
    orbitalColor: el.color ?? DEFAULT_COLOR[kind],
    textureResolutions: el.surfaceResolutions
      ? { surface: el.surfaceResolutions }
      : {},
    // `textures` est dérivé au chargement du catalogue (voir bodies.ts / deriveTextures).
    ...(el.fallbackColor !== undefined
      ? { fallbackColor: el.fallbackColor }
      : {}),
    ...(el.model ? { model: el.model } : {}),
    ...(el.satellites ? { satellites: el.satellites } : {}),
    ...(el.rotationBody !== undefined ? { rotationBody: el.rotationBody } : {}),
    realData: {
      radiusKm: el.radiusKm,
      distanceAU: el.a,
      orbitPeriodDays: periodDays,
      orbitalInclination: inclinationRad,
      ascendingNode: ascendingNodeRad,
      axialTilt: (el.axialTiltDeg ?? 0) * D2R,
      // Distance et période sont DÉRIVÉES des éléments osculateurs Horizons de ce même objet :
      // la provenance se déclare ici, une fois, plutôt que corps par corps.
      sources: {
        distanceAU: derived('jpl-horizons', {
          detail: DETAIL.osculatingSemiMajorAxis,
        }),
        orbitPeriodDays: derived('jpl-horizons', {
          detail: DETAIL.keplerPeriod,
        }),
        ...el.sources,
      },
      // Sans obliquité déclarée, la scène tourne le corps autour d'un axe droit (0°) : une
      // commodité de rendu, jamais un fait à publier.
      ...(el.unknown || el.axialTiltDeg === undefined
        ? {
            unknown: {
              ...(el.axialTiltDeg === undefined
                ? { axialTilt: NOT_YET_SOURCED }
                : {}),
              ...el.unknown,
            },
          }
        : {}),
      // Champs documentaires optionnels — transmis tels quels à la fiche d'info.
      ...(el.massKg !== undefined ? { massKg: el.massKg } : {}),
      ...(el.gravity !== undefined ? { gravity: el.gravity } : {}),
      ...(el.meanTempC !== undefined ? { meanTempC: el.meanTempC } : {}),
      ...(el.moonCount !== undefined ? { moonCount: el.moonCount } : {}),
      ...(el.description ? { description: el.description } : {}),
      ...(el.wiki ? { wiki: el.wiki } : {}),
    },
    orbitalElements: {
      semiMajorAxisAU: el.a,
      eccentricity: el.e,
      inclinationRad,
      ascendingNodeRad,
      argPerihelionRad: el.wDeg * D2R,
      meanAnomalyAtEpochRad: el.maDeg * D2R,
      epoch: new Date(el.epoch),
      ...(el.barycentric ? { barycentric: true } : {}),
    },
    cameraDistance: { educ: 2, explo: exploCameraDistance(el.radiusKm) },
  };
}
