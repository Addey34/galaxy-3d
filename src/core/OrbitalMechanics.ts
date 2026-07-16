/**
 * Moteur de mouvement : positionne et oriente chaque corps à chaque frame, dans les
 * deux modes d'affichage.
 *
 *   - Éducatif ('educ') : orbites circulaires inclinées (éléments J2000 : distance,
 *     inclinaison, nœud ascendant), parcourues à la vraie vitesse angulaire moyenne.
 *   - Exploration ('explo') : positions de Kepler réelles fournies par EphemerisService.
 *
 * Gère aussi la synchronisation avec l'horloge (`syncAnglesFromEphemeris` ré-ancre les
 * angles éducatifs, l'orientation des axes et la rotation de la Terre sur l'heure UTC),
 * le voyage temporel et le calcul des points des lignes d'orbite.
 */
import * as THREE from 'three';
import type { Body } from 'astronomy-engine';
import type { CelestialBodyConfig, CelestialConfig } from '../types';
import type { CelestialBodies } from '../components/systems/SceneSystem';
import type { SimulationClock } from './SimulationClock';
import type { EphemerisService } from './EphemerisService';
import type { OrbitalElementsService } from './OrbitalElementsService';
import { ScaleService, SQRT_K } from './ScaleService';
import { angleInOrbitalPlane, orbitalPositionEduc } from './orbitalGeometry';
import { forEachBody } from '../config/catalog';

/** Corps sans mouvement orbital propre (skybox étoilée, étoile centrale à l'origine). */
function hasOrbit(cfg: CelestialBodyConfig): boolean {
  return cfg.kind !== 'skybox' && cfg.kind !== 'star';
}

const ZERO = new THREE.Vector3(0, 0, 0);

/** Nombre de points échantillonnés le long de chaque ligne d'orbite.
 *  Source unique partagée avec SceneSystem (taille des buffers de géométrie). */
export const ORBIT_SAMPLE_COUNT = 256;

export class OrbitalMechanics {
  private readonly scale = new ScaleService();
  private readonly _exploPos = new THREE.Vector3();
  private readonly _orbitAngles = new Map<string, number>();
  /** Nom d'un satellite parentRelative → enum astronomy-engine de son parent. */
  private readonly _parentAstroBody = new Map<string, Body>();
  private _prevPaused = false;
  private _simDeltaSeconds = 0;

  /** Appelé quand les lignes d'orbite doivent être recalculées (changement de mode ou de date). */
  onOrbitsChanged: (() => void) | null = null;

  constructor(
    private readonly clock: SimulationClock,
    private readonly ephemeris: EphemerisService,
    private readonly elements: OrbitalElementsService,
    private readonly config: CelestialConfig,
    private bodies: CelestialBodies
  ) {
    // Résout le parent de chaque satellite parentRelative une fois : sa position est
    // exprimée relativement au parent (helio(corps) − helio(parent)), plus de référentiel
    // terrestre codé en dur.
    forEachBody(config, ({ name, config: cfg, parentName }) => {
      if (cfg.frame !== 'parentRelative' || parentName === null) return;
      const parentAstro = config.bodies[parentName]?.astroBody;
      if (parentAstro !== undefined) this._parentAstroBody.set(name, parentAstro);
    });
  }

  // ============================================================================
  // UPDATE
  // ============================================================================

  update(simDelta: number, _realDelta: number = simDelta): void {
    const prevMs   = this.clock.date.getTime();
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

    const date = this.clock.date;
    const mode = this.scale.mode;

    forEachBody(this.config, ({ name, config: cfg }) => {
      if (hasOrbit(cfg)) this._updateBody(name, cfg, date, mode);
    });
  }

  /**
   * Position en UA d'un corps selon sa source, dans le repère scène.
   *   - `astroBody` défini → éphéméride astronomy-engine (planètes, Lune, Soleil…).
   *   - sinon `orbitalElements` défini → propagation képlérienne (astéroïdes, comètes…).
   *   - sinon null (corps sans position calculable).
   */
  private _positionAU(name: string, cfg: CelestialBodyConfig, date: Date): THREE.Vector3 | null {
    if (cfg.astroBody !== undefined) {
      if (cfg.frame === 'parentRelative') {
        const parentBody = this._parentAstroBody.get(name);
        // Parent sans éphéméride → pas de position relative calculable.
        if (parentBody === undefined) return null;
        return this.ephemeris.getParentRelativeAU(cfg.astroBody, parentBody, date);
      }
      return this.ephemeris.getHeliocentricAU(cfg.astroBody, date);
    }
    if (cfg.orbitalElements) {
      return this.elements.getHeliocentricAU(cfg.orbitalElements, date);
    }
    return null;
  }

  private _updateBody(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    mode: 'educ' | 'explo'
  ): void {
    const body = this.bodies[name];
    if (!body) return;

    if (mode === 'educ') {
      // Mode Éducatif — orbite circulaire avec inclinaison réelle (éléments orbitaux J2000).
      const periodDays = cfg.realData?.orbitPeriodDays;
      if (!periodDays) return;
      const angularVelocity = (Math.PI * 2) / (periodDays * 86_400);
      const angle = (this._orbitAngles.get(name) ?? 0) + angularVelocity * this._simDeltaSeconds;
      this._orbitAngles.set(name, angle);
      const distanceAU = cfg.realData?.distanceAU;
      const r = distanceAU !== undefined ? Math.sqrt(distanceAU) * SQRT_K : (cfg.orbitalRadius ?? 0);
      body.group.position.copy(orbitalPositionEduc(
        r,
        angle,
        cfg.realData?.orbitalInclination ?? 0,
        cfg.realData?.ascendingNode ?? 0,
      ));
    } else {
      // Mode Explo — positions Kepler réelles depuis astronomy-engine.
      // Échelle linéaire (AU × SQRT_K), sans compression √. Pour les corps
      // parentRelative (Lune), la position géocentrique est déjà hors du mesh du parent.
      const posAU = this._positionAU(name, cfg, date);
      this._exploPos.copy(posAU ? this.scale.auVectorToScene(posAU) : ZERO);
      body.group.position.copy(this._exploPos);
    }
  }

  // ============================================================================
  // API PUBLIQUE
  // ============================================================================

  /** Bascule l'échelle. Déclenche un recalcul des lignes d'orbite. */
  setMode(mode: 'educ' | 'explo'): void {
    if (this.scale.mode === mode) return;
    this.scale.mode = mode;
    this.onOrbitsChanged?.();
  }

  /**
   * Synchronise les angles orbitaux du mode éducatif sur les positions réelles
   * d'astronomy-engine à la date donnée.
   *
   * Transformation inverse (cf. angleInOrbitalPlane dans orbitalGeometry.ts) : projette la
   * position scène sur les axes e1/e2 du plan orbital définis par Ω et i.
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

      if (!cfg.realData?.distanceAU) return;
      const pos = this._positionAU(name, cfg, date);
      if (!pos) return;
      this._orbitAngles.set(name, angleInOrbitalPlane(
        pos,
        cfg.realData.orbitalInclination ?? 0,
        cfg.realData.ascendingNode ?? 0,
      ));
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
    const earthPos = earthCfg ? this._positionAU('earth', earthCfg, date) : null;
    if (earthPos && earthBody) {
      const θSun = Math.atan2(-earthPos.z, -earthPos.x);
      const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
      earthBody.setInitialSurfaceRotation(-θSun - (12 - utcH) * Math.PI / 12);
    }
  }

  computeOrbitPoints(
    name: string,
    cfg: CelestialBodyConfig,
    date: Date,
    nPoints = ORBIT_SAMPLE_COUNT
  ): Float32Array | null {
    const distanceAU = cfg.realData?.distanceAU;

    // Mode Éducatif : orbite circulaire inclinée (éléments J2000 — même formule que _updateBody).
    if (this.scale.mode === 'educ') {
      if (distanceAU === undefined) return null;
      const r    = Math.sqrt(distanceAU) * SQRT_K;
      const inc  = cfg.realData?.orbitalInclination ?? 0;
      const node = cfg.realData?.ascendingNode ?? 0;
      const arr  = new Float32Array((nPoints + 1) * 3);
      for (let i = 0; i <= nPoints; i++) {
        const p = orbitalPositionEduc(r, (i / nPoints) * Math.PI * 2, inc, node);
        arr[i * 3]     = p.x;
        arr[i * 3 + 1] = p.y;
        arr[i * 3 + 2] = p.z;
      }
      return arr;
    }

    // Mode Explo : ellipse Kepler réelle. Période depuis realData, ou dérivée du demi-grand
    // axe pour les corps à éléments orbitaux (3ᵉ loi de Kepler : T = 365.256 · a^1.5 jours).
    const period =
      cfg.realData?.orbitPeriodDays ??
      (cfg.orbitalElements
        ? 365.256 * Math.pow(cfg.orbitalElements.semiMajorAxisAU, 1.5)
        : undefined);
    if (!period) return null;

    const arr = new Float32Array((nPoints + 1) * 3);

    for (let i = 0; i <= nPoints; i++) {
      const t = new Date(date.getTime() + (i / nPoints) * period * 86_400_000);

      // Explo : échelle linéaire (AU × SQRT_K), sans compression √. Les corps parentRelative
      // (Lune) suivent leur position géocentrique — déjà hors du mesh du parent.
      const pos = this._positionAU(name, cfg, t);
      if (!pos) return null;
      const s = this.scale.auVectorToScene(pos);

      arr[i * 3]     = s.x;
      arr[i * 3 + 1] = s.y;
      arr[i * 3 + 2] = s.z;
    }

    return arr;
  }

  /**
   * À appeler après tout saut temporel. Re-synchronise IMPÉRATIVEMENT :
   *   - les angles orbitaux éducatifs (sinon les planètes restent figées au scrubbing) ;
   *   - la rotation de surface de la Terre sur l'heure UTC (sinon le jour/nuit ne suit pas).
   * `recomputeOrbitLines` : recalcule les ellipses (jour+ seulement — inutile pour h/m/s,
   *   la forme d'orbite ne change pas visiblement en quelques heures).
   */
  private _afterTimeTravel(recomputeOrbitLines: boolean): void {
    this.syncAnglesFromEphemeris(this.clock.date);
    if (recomputeOrbitLines) this.onOrbitsChanged?.();
  }

  // Time travel — les changements de jour+ recompilent aussi les lignes d'orbite (inclinaison varie)
  addTimeOffset(days: number): void {
    this.clock.addDays(days);
    this._afterTimeTravel(true);
  }

  // Glissement heure par heure : re-sync angles + rotation, mais pas les lignes d'orbite
  addTimeOffsetHours(hours: number): void { this.clock.addHours(hours); this._afterTimeTravel(false); }

  setSimulationSpeed(scale: number): void { this.clock.setTimeScale(scale); }

  resetTimeOffset(): void {
    this.clock.resetOffset();
    this.syncAnglesFromEphemeris(this.clock.date);
    this.onOrbitsChanged?.();
  }

  get scaleMode(): 'educ' | 'explo' { return this.scale.mode; }
  get simulationDate(): Date { return this.clock.date; }
  get offsetDays(): number { return this.clock.offsetDays; }
  get simulationTimeScale(): number { return this.clock.timeScale; }
  get simDeltaSeconds(): number { return this._simDeltaSeconds; }
}
