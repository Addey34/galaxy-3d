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
import type { Body } from 'astronomy-engine';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import type { CelestialBodies } from '@/components/systems/SceneSystem';
import type { SimulationClock } from './SimulationClock';
import type { EphemerisService } from './EphemerisService';
import type { OrbitalElementsService } from './OrbitalElementsService';
import type { HorizonsEphemerisService } from './HorizonsEphemerisService';
import { ScaleService, SQRT_K } from './ScaleService';
import { angleInOrbitalPlane, orbitalPositionEduc } from './orbitalGeometry';
import { forEachBody } from '@/config/catalog';

/** Corps sans mouvement orbital propre (skybox étoilée, étoile centrale à l'origine). */
function hasOrbit(cfg: CelestialBodyConfig): boolean {
  return cfg.kind !== 'skybox' && cfg.kind !== 'star';
}

const ZERO = new THREE.Vector3(0, 0, 0);

export const ORBIT_SAMPLE_COUNT = 256;

/** Durée (secondes) de la transition animée Éduc↔Explo (le « dolly zoom »). */
const MORPH_DURATION_S = 1.2;

/** Cubic InOut — même courbe que les vols caméra (TWEEN.Easing.Cubic.InOut). */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class OrbitalMechanics {
  private readonly scale = new ScaleService();
  private readonly _exploPos = new THREE.Vector3();
  private readonly _educPos = new THREE.Vector3();
  /** Nom d'un satellite parentRelative → enum astronomy-engine de son parent. */
  private readonly _parentAstroBody = new Map<string, Body>();
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
    private readonly horizons: HorizonsEphemerisService,
    private readonly config: CelestialConfig,
    private bodies: CelestialBodies
  ) {
    // Résout le parent de chaque satellite parentRelative une fois : sa position est
    // exprimée relativement au parent (helio(corps) − helio(parent)), plus de référentiel
    // terrestre codé en dur.
    forEachBody(config, ({ name, config: cfg, parentName }) => {
      if (cfg.frame !== 'parentRelative' || parentName === null) return;
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
    // Les vecteurs numériques Horizons sont prioritaires lorsqu'ils couvrent ce corps et
    // cette date. Les deux modes consomment ensuite exactement cette même position source.
    const precisePosition = this.horizons.getHeliocentricAU(name, date);
    if (precisePosition) return precisePosition;

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
    if (cfg.orbitalElements) {
      return this.elements.getHeliocentricAU(cfg.orbitalElements, date);
    }
    return null;
  }

  /**
   * Position Éducatif (mode compressé) dans `out`. MÊME angle orbital que l'Explo : on lit la
   * vraie position astronomy-engine à la date, on en extrait l'angle dans le plan orbital
   * (projection inverse sur e1/e2, cf. angleInOrbitalPlane), puis on la pose sur un cercle
   * compressé de rayon √(distanceAU)×SQRT_K. Éduc et Explo restent ainsi synchronisés sur
   * l'horloge/éphéméride — seule l'échelle radiale change — et le corps reste sur sa ligne
   * d'orbite. Renvoie false si la position n'est pas calculable.
   */
  private _computeEducPos(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    out: THREE.Vector3
  ): boolean {
    const distanceAU = cfg.realData?.distanceAU;
    if (distanceAU == null) return false;
    const posAU = this._positionAU(name, cfg, date);
    if (!posAU) return false;
    const inc = cfg.realData?.orbitalInclination ?? 0;
    const node = cfg.realData?.ascendingNode ?? 0;
    const angle = angleInOrbitalPlane(posAU, inc, node);
    const r = Math.sqrt(distanceAU) * SQRT_K;
    out.copy(orbitalPositionEduc(r, angle, inc, node));
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
   *   - `animated = true` : lance la transition « dolly zoom » — les positions et tailles
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
      if (body && cfg.astroBody !== undefined) {
        const north = this.ephemeris.getNorthPoleDirection(cfg.astroBody, date);
        const retrograde = (cfg.realData?.axialTilt ?? 0) > Math.PI / 2;
        body.setAxisDirection(retrograde ? north.multiplyScalar(-1) : north);
      }
    };

    forEachBody(this.config, ({ name, config: cfg }) => {
      if (hasOrbit(cfg)) syncBody(name, cfg);
    });

    // Aligne la rotation de surface de la Terre sur l'heure UTC réelle.
    //   θSun       = azimut du Soleil vu de la Terre, dans le plan écliptique XZ.
    //   subSolarLon = longitude géographique face au Soleil = (12 - utcH)·π/12
    //                 (0° à 12h UTC = midi à Greenwich ; -90° à 18h ; +180° à 0h).
    // On veut que le méridien subSolarLon pointe vers le Soleil (azimut θSun). Avec la
    // convention de la SphereGeometry (azimut d'un méridien = -longitude - rotation.y) :
    //   rotation.y = -θSun - subSolarLon
    const earthCfg = this.config.bodies['earth'];
    const earthBody = this.bodies['earth'];
    const earthPos = earthCfg
      ? this._positionAU('earth', earthCfg, date)
      : null;
    if (earthPos && earthBody) {
      const θSun = Math.atan2(-earthPos.z, -earthPos.x);
      const utcH =
        date.getUTCHours() +
        date.getUTCMinutes() / 60 +
        date.getUTCSeconds() / 3600;
      earthBody.setInitialSurfaceRotation(-θSun - ((12 - utcH) * Math.PI) / 12);
    }
  }

  /** Calcule uniquement les lignes éducatives : cercle incliné et distance compressée. */
  computeOrbitPoints(
    _name: string,
    cfg: CelestialBodyConfig,
    _date: Date,
    nPoints = ORBIT_SAMPLE_COUNT
  ): Float32Array | null {
    if (this.scale.mode !== 'educ') return null;
    const distanceAU = cfg.realData?.distanceAU;
    if (distanceAU === undefined) return null;

    const radius = Math.sqrt(distanceAU) * SQRT_K;
    const inc = cfg.realData?.orbitalInclination ?? 0;
    const node = cfg.realData?.ascendingNode ?? 0;
    const points = new Float32Array((nPoints + 1) * 3);
    for (let i = 0; i <= nPoints; i++) {
      const point = orbitalPositionEduc(
        radius,
        (i / nPoints) * Math.PI * 2,
        inc,
        node
      );
      points[i * 3] = point.x;
      points[i * 3 + 1] = point.y;
      points[i * 3 + 2] = point.z;
    }
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
