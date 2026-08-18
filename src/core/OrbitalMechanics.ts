/**
 * Moteur de mouvement : positionne et oriente chaque corps à chaque frame, dans les
 * deux modes d'affichage.
 *
 *   - Éducatif ('educ') : MÊME mouvement que l'Explo — on lit la vraie position
 *     astronomy-engine, on en extrait l'angle dans le plan orbital (Ω, i J2000) et on
 *     la pose sur un cercle de rayon compressé √(distanceAU)×K. Éduc et Explo sont donc
 *     le même mouvement aligné sur l'horloge/éphéméride, seule l'échelle radiale diffère.
 *   - Exploration ('explo') : positions de Kepler réelles fournies par EphemerisService,
 *     échelle linéaire (AU × K).
 *
 * Gère aussi la synchronisation avec l'horloge (`syncAnglesFromEphemeris` oriente les axes
 * de rotation et cale la rotation de la Terre sur l'heure UTC), le voyage temporel et les
 * points des orbites éducatives.
 */
import * as THREE from 'three';
import { Body, Equator, Observer, SiderealTime } from 'astronomy-engine';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import type { CelestialBodies } from '@/components/systems/SceneSystem';
import type { SimulationClock } from './SimulationClock';
import type { EphemerisService } from './EphemerisService';
import type { OrbitalElementsService } from './OrbitalElementsService';
import type { PreciseEphemerisProvider } from './PreciseEphemerisProvider';
import { KM_PER_AU, ScaleService, SQRT_K } from './ScaleService';
import { computeLightAttenuation } from './eclipse';
import { forEachBody } from '@/config/catalog';

/** Corps sans mouvement orbital propre (skybox étoilée, étoile centrale à l'origine). */
function hasOrbit(cfg: CelestialBodyConfig): boolean {
  return cfg.kind !== 'skybox' && cfg.kind !== 'star';
}

const ZERO = new THREE.Vector3(0, 0, 0);

export const ORBIT_SAMPLE_COUNT = 512;
export const EXPLO_ORBIT_SAMPLE_COUNT = 4096;
const MS_PER_DAY = 86_400_000;

/** Marge visuelle minimale entre un parent et ses satellites en mode éducatif. */
export const EDUCATIVE_PARENT_GAP = 0.12;

/**
 * Les éléments orbitaux relatifs servent aussi de borne de cohérence pour une source précise.
 * Une éphéméride enfant-parent valide ne peut pas s'éloigner durablement de son orbite publiée.
 * Cette vérification protège notamment les anciens fichiers Horizons générés avec le Soleil
 * comme centre, puis interprétés à tort comme des vecteurs parent-relative.
 */
const RELATIVE_EPHEMERIS_TOLERANCE = 2;
const HELIOCENTRIC_DISTANCE_MIN_FACTOR = 0.5;
const HELIOCENTRIC_DISTANCE_MAX_FACTOR = 2;

function isPlausibleRelativePosition(
  position: THREE.Vector3,
  cfg: CelestialBodyConfig
): boolean {
  const elements = cfg.relativeOrbitalElements;
  if (!elements) return true;
  const maxDistanceAU = elements.semiMajorAxisAU * (1 + elements.eccentricity);
  return position.length() <= maxDistanceAU * RELATIVE_EPHEMERIS_TOLERANCE;
}

/**
 * Vérifie qu'une position précise reste à la distance attendue du Soleil. Les fichiers
 * Horizons optionnels peuvent être absents, obsolètes ou avoir été générés avec un mauvais
 * centre ; dans ce cas, Astronomy Engine/Kepler fournit une trajectoire cohérente plutôt
 * qu'une orbite visuelle épaissie par des points provenant de plusieurs rayons.
 */
function isPlausibleHeliocentricPosition(
  position: THREE.Vector3,
  cfg: CelestialBodyConfig
): boolean {
  const expectedDistanceAU = cfg.realData?.distanceAU;
  if (!expectedDistanceAU || expectedDistanceAU <= 0) return true;
  const distanceAU = position.length();
  return (
    distanceAU >= expectedDistanceAU * HELIOCENTRIC_DISTANCE_MIN_FACTOR &&
    distanceAU <= expectedDistanceAU * HELIOCENTRIC_DISTANCE_MAX_FACTOR
  );
}

/**
 * Échelle commune des orbites parentRelative d'un même parent.
 * Elle évite que les corps satellites soient cachés par le parent tout en
 * conservant leur ordre de distance réel.
 */
export function educationalParentOrbitScale(
  parent: CelestialBodyConfig | undefined
): number {
  if (!parent?.satellites) return 1;

  let scale = 1;
  for (const satellite of Object.values(parent.satellites)) {
    if (satellite.frame !== 'parentRelative') continue;
    const distanceAU = satellite.realData?.distanceAU;
    if (!distanceAU || distanceAU <= 0) continue;
    const rawRadius = Math.sqrt(distanceAU) * SQRT_K;
    const requiredRadius =
      parent.radius + satellite.radius + EDUCATIVE_PARENT_GAP;
    scale = Math.max(scale, requiredRadius / rawRadius);
  }
  return scale;
}

/** Durée (secondes) de la transition animée des positions et tailles Éduc↔Explo. */
const MORPH_DURATION_S = 1.2;

/** Cubic InOut — même courbe que les vols caméra (TWEEN.Easing.Cubic.InOut). */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const EARTH_OBSERVER = new Observer(0, 0, 0);
const HOURS_TO_RADIANS = Math.PI / 12;

/**
 * Greenwich subsolar longitude, positive east, from apparent sidereal time.
 *
 * GAST is the right ascension crossing Greenwich. The solar meridian is where
 * the Sun's apparent right ascension equals local apparent sidereal time.
 */
export function computeGreenwichSubsolarLongitude(date: Date): number {
  const gastHours = SiderealTime(date);
  const sunRightAscensionHours = Equator(
    Body.Sun,
    date,
    EARTH_OBSERVER,
    true,
    true
  ).ra;
  const rawHours = sunRightAscensionHours - gastHours;
  const wrappedHours = ((((rawHours + 12) % 24) + 24) % 24) - 12;
  return wrappedHours * HOURS_TO_RADIANS;
}

export class OrbitalMechanics {
  private readonly scale = new ScaleService();
  private readonly _exploPos = new THREE.Vector3();
  private readonly _educPos = new THREE.Vector3();
  /** Nom d'un satellite parentRelative → enum astronomy-engine de son parent. */
  private readonly _parentAstroBody = new Map<string, Body>();
  private readonly _parentName = new Map<string, string>();
  private _prevPaused = false;
  private _simDeltaSeconds = 0;

  /** Notifie l'application pour recalculer les lignes éducatives après un saut/date ou mode. */
  onOrbitsChanged: (() => void) | null = null;

  // ── Transition animée Éduc↔Explo ──
  // `_morph` : 0 = Éducatif (√ compressé), 1 = Explo (linéaire vrai). Au repos il vaut le mode
  // courant ; pendant une transition il glisse de `_morphFrom` vers `_morphTo` sur MORPH_DURATION_S.
  private _morph = 0;
  private _morphActive = false;
  private _morphFrom = 0;
  private _morphTo = 0;
  private _morphElapsed = 0;

  /** Émis chaque frame pendant la transition avec le facteur de morph courant (0→1) : la couche
   *  app l'utilise pour interpoler la taille visuelle de chaque corps (cf. `setScaleMorph`). */
  onScaleMorph: ((p: number) => void) | null = null;
  /** Masque les lignes pendant une transition vers/depuis l'Exploration. */
  onMorphPhase: ((active: boolean) => void) | null = null;

  constructor(
    private readonly clock: SimulationClock,
    private readonly ephemeris: EphemerisService,
    private readonly elements: OrbitalElementsService,
    private readonly horizons: PreciseEphemerisProvider,
    private readonly config: CelestialConfig,
    private bodies: CelestialBodies
  ) {
    // Résout le parent de chaque satellite parentRelative une fois : sa position est
    // exprimée relativement au parent (helio(corps) − helio(parent)), plus de référentiel
    // terrestre codé en dur.
    forEachBody(config, ({ name, config: cfg, parentName }) => {
      if (cfg.frame !== 'parentRelative' || parentName === null) return;
      this._parentName.set(name, parentName);
      const parent = config.bodies[parentName];
      // Réfère le satellite au corps de POSITION du parent (positionBody ?? astroBody) : pour
      // la Lune, le parent Terre pointe sur l'EMB, gardant la Lune à sa vraie position.
      const parentAstro = parent?.positionBody ?? parent?.astroBody;
      if (parentAstro !== undefined)
        this._parentAstroBody.set(name, parentAstro);
    });
  }

  // ============================================================================
  // UPDATE
  // ============================================================================

  update(simDelta: number, realDelta: number = simDelta): void {
    const prevMs = this.clock.date.getTime();
    const isPaused = simDelta === 0;

    if (!isPaused) {
      // Au premier frame après une reprise, on réancre l'horloge sur l'instant présent
      // pour que la date simulée reparte d'où elle était (sans saut en avant).
      if (this._prevPaused) this.clock.setTimeScale(this.clock.timeScale);
      this.clock.syncToRealTime();
    }
    this._prevPaused = isPaused;

    // Delta toujours ≥ 0 : l'horloge n'avance que vers l'avant (timeScale ≥ 1) et les
    // sauts temporels sont déjà appliqués avant l'échantillon de prevMs ci-dessus.
    // _simDeltaSeconds est une magnitude ; le sens de rotation est porté par l'orientation
    // de l'axe (les corps rétrogrades ont leur axe retourné, cf. setAxisDirection).
    this._simDeltaSeconds = isPaused
      ? 0
      : Math.abs(this.clock.date.getTime() - prevMs) / 1_000;

    // Le morph avance sur le temps réel (realDelta) : il doit se dérouler même en pause.
    this._advanceMorph(realDelta);

    const date = this.clock.date;

    forEachBody(this.config, ({ name, config: cfg }) => {
      if (hasOrbit(cfg)) this._updateBody(name, cfg, date);
    });
  }

  /** Fait progresser la transition animée et notifie la couche app (taille visuelle). */
  private _advanceMorph(realDelta: number): void {
    if (!this._morphActive) return;
    this._morphElapsed += realDelta;
    const raw = Math.min(this._morphElapsed / MORPH_DURATION_S, 1);
    const eased = easeInOutCubic(raw);
    this._morph = this._morphFrom + (this._morphTo - this._morphFrom) * eased;
    this.onScaleMorph?.(this._morph);

    if (raw >= 1) {
      // Fin de transition : on cale exactement positions et tailles sur le mode cible.
      this._morphActive = false;
      this._morph = this._morphTo;
      this.onScaleMorph?.(this._morph);
      this.onMorphPhase?.(false);
      this.onOrbitsChanged?.();
    }
  }

  /**
   * Position en UA d'un corps selon sa source, dans le repère scène.
   *   - `astroBody` défini → éphéméride astronomy-engine (planètes, Lune, Soleil…).
   *   - sinon `orbitalElements` défini → propagation képlérienne (astéroïdes, comètes…).
   *   - sinon null (corps sans position calculable).
   */
  private _positionAU(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date
  ): THREE.Vector3 | null {
    // Un corps imbriqué doit rester dans le repère local de son parent. Cette branche doit
    // précéder toute lecture héliocentrique : un fichier SPK peut aussi exposer la position
    // lune→Soleil, mais l'utiliser ici sous le groupe Terre/Jupiter appliquerait le parent
    // deux fois et fausserait distance, position et ligne d'orbite dans les deux modes.
    if (cfg.frame === 'parentRelative') {
      const parentName = this._parentName?.get(name);
      const preciseRelative = parentName
        ? this.horizons.getParentRelativeAU(name, parentName, date)
        : null;
      if (
        preciseRelative &&
        isPlausibleRelativePosition(preciseRelative, cfg)
      ) {
        return preciseRelative;
      }
    } else {
      // Les vecteurs numériques Horizons/SPK sont prioritaires lorsqu'ils couvrent ce corps
      // et cette date. Les deux modes consomment ensuite exactement la même position source.
      const precisePosition = this.horizons.getHeliocentricAU(name, date);
      if (
        precisePosition &&
        isPlausibleHeliocentricPosition(precisePosition, cfg)
      ) {
        return precisePosition;
      }
    }

    if (cfg.relativeEphemeris?.kind === 'jupiterMoon') {
      // astronomy-engine fournit directement les vecteurs relatifs aux lunes joviennes.
      return this.ephemeris.getJupiterMoonRelativeAU(
        cfg.relativeEphemeris.moon,
        date
      );
    }

    if (cfg.astroBody !== undefined) {
      if (cfg.frame === 'parentRelative') {
        const parentBody = this._parentAstroBody.get(name);
        // Parent sans éphéméride → pas de position relative calculable.
        if (parentBody === undefined) return null;
        return this.ephemeris.getParentRelativeAU(
          cfg.astroBody,
          parentBody,
          date
        );
      }
      return this.ephemeris.getHeliocentricAU(
        cfg.positionBody ?? cfg.astroBody,
        date
      );
    }
    if (cfg.relativeOrbitalElements) {
      return this.elements.getHeliocentricAU(cfg.relativeOrbitalElements, date);
    }
    if (cfg.orbitalElements) {
      return this.elements.getHeliocentricAU(cfg.orbitalElements, date);
    }
    return null;
  }

  /**
   * Position Éducatif (mode compressé) dans `out`. La vraie position astronomy-engine,
   * Horizons ou képlérienne est conservée en direction et sa distance radiale est compressée
   * par √(distanceAU)×SQRT_K. Éduc et Explo restent ainsi synchronisés sur l'horloge et
   * l'excentricité réelle — seule l'échelle radiale change. Renvoie false si la position n'est
   * pas calculable.
   */
  private _computeEducPos(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    out: THREE.Vector3
  ): boolean {
    const posAU = this._positionAU(name, cfg, date);
    if (!posAU) return false;
    const distanceAU = posAU.length();
    if (distanceAU < 1e-12) {
      out.set(0, 0, 0);
      return true;
    }
    out
      .copy(posAU)
      .normalize()
      .multiplyScalar(
        Math.sqrt(distanceAU) *
          SQRT_K *
          educationalParentOrbitScale(
            this._parentName?.has(name)
              ? this.config.bodies[this._parentName.get(name)!]
              : undefined
          )
      );
    return true;
  }

  /**
   * Position Explo (vraie échelle) dans `out` : position Kepler réelle depuis astronomy-engine,
   * échelle linéaire (AU × SQRT_K) sans compression √. Pour les corps parentRelative (Lune), la
   * position géocentrique est déjà hors du mesh du parent.
   */
  private _computeExploPos(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    out: THREE.Vector3
  ): void {
    const posAU = this._positionAU(name, cfg, date);
    out.copy(posAU ? this.scale.auVectorToScene(posAU) : ZERO);
  }

  private _updateBody(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date
  ): void {
    const body = this.bodies[name];
    if (!body) return;

    // Pendant la transition animée : on interpole la position Éduc ↔ Explo par `_morph`.
    // Le lerp gère d'un coup le changement d'échelle radiale ET le morphing cercle→ellipse.
    if (this._morphActive) {
      const hasEduc = this._computeEducPos(name, cfg, date, this._educPos);
      this._computeExploPos(name, cfg, date, this._exploPos);
      if (hasEduc) {
        body.group.position.lerpVectors(
          this._educPos,
          this._exploPos,
          this._morph
        );
      } else {
        body.group.position.copy(this._exploPos);
      }
      return;
    }

    if (this.scale.mode === 'educ') {
      if (this._computeEducPos(name, cfg, date, this._educPos))
        body.group.position.copy(this._educPos);
    } else {
      this._computeExploPos(name, cfg, date, this._exploPos);
      body.group.position.copy(this._exploPos);
    }
  }

  // ============================================================================
  // API PUBLIQUE
  // ============================================================================

  /**
   * Bascule l'échelle Éduc↔Explo.
   *   - `animated = false` (défaut) : bascule instantanée des positions et tailles.
   *   - animated = true : lance la transition — les positions et tailles
   *     glissent de l'échelle courante vers l'échelle cible sur MORPH_DURATION_S.
   * Un appel animé en cours de morph repart de l'état courant (interruptible sans saut).
   */
  setMode(mode: 'educ' | 'explo', animated = false): void {
    if (this.scale.mode === mode && !this._morphActive) return;

    const targetMorph = mode === 'explo' ? 1 : 0;
    // Le mode d'échelle « au repos » passe immédiatement à la cible. Les positions par frame
    // suivent `_morph` tant que la transition animée est active.
    this.scale.mode = mode;

    if (!animated) {
      this._morphActive = false;
      this._morph = targetMorph;
      this.onScaleMorph?.(targetMorph);
      this.onOrbitsChanged?.();
      return;
    }

    this._morphFrom = this._morph;
    this._morphTo = targetMorph;
    this._morphElapsed = 0;
    this._morphActive = true;
    this.onMorphPhase?.(true);
  }

  /**
   * Cale sur l'heure/date donnée ce qui ne se déduit pas de la position orbitale :
   * l'orientation de l'axe de rotation de chaque corps (pôle IAU réel) et la rotation de
   * surface de la Terre sur l'heure UTC. Les angles orbitaux, eux, sont désormais lus
   * directement de l'éphéméride à chaque frame (cf. _updateBody), donc plus rien à ré-ancrer ici.
   */
  syncAnglesFromEphemeris(date: Date): void {
    const syncBody = (name: string, cfg: CelestialBodyConfig): void => {
      const body = this.bodies[name];

      // Oriente l'axe de rotation sur le vrai pôle IAU (obliquité + azimut réels).
      // Pour un corps rétrograde (obliquité > 90°), le moment cinétique de spin pointe à
      // l'opposé du pôle nord IAU : on passe -pôle pour que +rotationSpeed reste correct.
      const rotationBody = cfg.rotationBody ?? cfg.astroBody;
      if (body && rotationBody !== undefined) {
        const north = this.ephemeris.getNorthPoleDirection(rotationBody, date);
        const retrograde = (cfg.realData?.axialTilt ?? 0) > Math.PI / 2;
        body.setAxisDirection(retrograde ? north.multiplyScalar(-1) : north);
      }
    };

    forEachBody(this.config, ({ name, config: cfg }) => {
      if (hasOrbit(cfg)) syncBody(name, cfg);
    });

    // Aligne la rotation de surface de la Terre sur le Soleil apparent.
    //   θSun       = azimut du Soleil vu de la Terre, dans le plan écliptique XZ.
    //   subSolarLon = RA apparente du Soleil - GAST, ramenée dans [-12 h, +12 h].
    // Cette longitude Greenwich exacte remplace l'ancienne approximation UTC linéaire.
    // Avec la convention de SphereGeometry (azimut méridien = -longitude - rotation.y) :
    //   rotation.y = -θSun - subSolarLon
    const earthCfg = this.config.bodies['earth'];
    const earthBody = this.bodies['earth'];
    const earthPos = earthCfg
      ? this._positionAU('earth', earthCfg, date)
      : null;
    if (earthPos && earthBody) {
      const thetaSun = Math.atan2(-earthPos.z, -earthPos.x);
      const subSolarLon = computeGreenwichSubsolarLongitude(date);
      // SphereGeometry convention: the visible geographic meridian has azimuth
      // -longitude - rotation.y in the scene.
      earthBody.setInitialSurfaceRotation(-thetaSun - subSolarLon);
    }
  }

  /** Calcule la trajectoire orbitale adaptée au mode courant. */
  computeOrbitPoints(
    _name: string,
    cfg: CelestialBodyConfig,
    _date: Date,
    nPoints = this.scale.mode === 'explo'
      ? EXPLO_ORBIT_SAMPLE_COUNT
      : ORBIT_SAMPLE_COUNT
  ): Float32Array | null {
    if (this.scale.mode === 'explo') {
      const periodDays = cfg.realData?.orbitPeriodDays;
      if (!periodDays || periodDays <= 0) return null;

      const points = new Float32Array((nPoints + 1) * 3);
      const first = this._positionAU(_name, cfg, _date);
      if (!first) return null;

      // Center the sampled period on the current date. The seam is then opposite
      // the currently displayed body instead of moving through it as time advances.
      for (let i = 0; i < nPoints; i++) {
        const phase = i / nPoints - 0.5;
        const sampleDate = new Date(
          _date.getTime() + phase * periodDays * MS_PER_DAY
        );
        const point = this._positionAU(_name, cfg, sampleDate);
        if (!point) return null;
        const i3 = i * 3;
        points[i3] = point.x * SQRT_K;
        points[i3 + 1] = point.y * SQRT_K;
        points[i3 + 2] = point.z * SQRT_K;
      }

      // Ferme exactement la courbe : les perturbations peuvent empêcher
      // la position à date + période de rejoindre le premier échantillon.
      points.set(points.subarray(0, 3), nPoints * 3);
      return points;
    }
    const periodDays = cfg.realData?.orbitPeriodDays;
    if (!periodDays || periodDays <= 0) return null;
    const points = new Float32Array((nPoints + 1) * 3);
    for (let i = 0; i < nPoints; i++) {
      const phase = i / nPoints - 0.5;
      const sampleDate = new Date(
        _date.getTime() + phase * periodDays * MS_PER_DAY
      );
      const pointAU = this._positionAU(_name, cfg, sampleDate);
      if (!pointAU) return null;
      const parentName = this._parentName?.get(_name);
      const parentScale = educationalParentOrbitScale(
        parentName ? this.config.bodies[parentName] : undefined
      );
      const scaledRadius = Math.sqrt(pointAU.length()) * SQRT_K * parentScale;
      const point = pointAU.normalize().multiplyScalar(scaledRadius);
      const i3 = i * 3;
      points[i3] = point.x;
      points[i3 + 1] = point.y;
      points[i3 + 2] = point.z;
    }
    points.set(points.subarray(0, 3), nPoints * 3);
    return points;
  }

  /**
   * À appeler après tout saut temporel. Re-synchronise IMPÉRATIVEMENT :
   *   - les angles orbitaux éducatifs (sinon les planètes restent figées au scrubbing) ;
   *   - la rotation de surface de la Terre sur l'heure UTC (sinon le jour/nuit ne suit pas).
   */
  private _afterTimeTravel(): void {
    this.syncAnglesFromEphemeris(this.clock.date);
    this.onOrbitsChanged?.();
  }

  addTimeOffset(days: number): void {
    this.clock.addDays(days);
    this._afterTimeTravel();
  }

  addTimeOffsetHours(hours: number): void {
    this.clock.addHours(hours);
    this._afterTimeTravel();
  }

  setSimulationSpeed(scale: number): void {
    this.clock.setTimeScale(scale);
  }

  resetTimeOffset(): void {
    this.clock.resetOffset();
    this.syncAnglesFromEphemeris(this.clock.date);
    this.onOrbitsChanged?.();
  }

  /**
   * Atténuation d'éclipse Terre-Lune-Soleil calculée sur la **vraie** géométrie
   * (positions et rayons réels en AU via l'éphéméride), indépendamment de
   * l'échelle d'affichage compressée du mode educ. Sert à rendre visible
   * l'éclipse solaire (Lune devant le Soleil, ombre sur la Terre) et l'éclipse
   * lunaire (Lune dans l'ombre de la Terre) même en educ, où les positions de la
   * scène sont sur des cercles √-compressés inexploitables pour l'occultation.
   * Limité à ce seul triplet : les orbites educ sont trop plates/rapprochées pour
   * un calcul d'éclipse fiable sur les autres corps (fausses éclipses partout).
   */
  getEarthMoonEclipse(): { earth: number; moon: number } {
    const date = this.clock.date;
    const sunPos = new THREE.Vector3(0, 0, 0); // Soleil à l'origine héliocentrique.
    const earthPos = this.ephemeris.getHeliocentricAU(Body.Earth, date);
    const moonPos = this.ephemeris.getHeliocentricAU(Body.Moon, date);

    const sunRadiusAU = 696_000 / KM_PER_AU;
    const earthRadiusAU = 6_371 / KM_PER_AU;
    const moonRadiusAU = 1_737 / KM_PER_AU;

    // Éclipse solaire vue de la Terre : la Lune occulte le Soleil.
    const earth = computeLightAttenuation(earthPos, sunPos, sunRadiusAU, [
      { position: moonPos, radius: moonRadiusAU },
    ]);
    // Éclipse lunaire : la Lune entre dans l'ombre projetée par la Terre.
    const moon = computeLightAttenuation(moonPos, sunPos, sunRadiusAU, [
      { position: earthPos, radius: earthRadiusAU },
    ]);
    return { earth, moon };
  }

  get scaleMode(): 'educ' | 'explo' {
    return this.scale.mode;
  }
  get simulationDate(): Date {
    return this.clock.date;
  }
  get offsetDays(): number {
    return this.clock.offsetDays;
  }
  get simulationTimeScale(): number {
    return this.clock.timeScale;
  }
  get simDeltaSeconds(): number {
    return this._simDeltaSeconds;
  }
}
