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
import type { CelestialBodyConfig, CelestialConfig } from '../types';
import type { CelestialBodies } from '../components/systems/SceneSystem';
import type { SimulationClock } from './SimulationClock';
import type { EphemerisService } from './EphemerisService';
import { ScaleService, SQRT_K } from './ScaleService';

/** Nombre de points échantillonnés le long de chaque ligne d'orbite. */
const ORBIT_SAMPLE_COUNT = 256;

export class OrbitalMechanics {
  private readonly scale = new ScaleService();
  private readonly _exploPos = new THREE.Vector3();
  private readonly _orbitAngles = new Map<string, number>();
  private _prevPaused = false;
  private _simDeltaSeconds = 0;

  /** Appelé quand les lignes d'orbite doivent être recalculées (changement de mode ou de date). */
  onOrbitsChanged: (() => void) | null = null;

  constructor(
    private readonly clock: SimulationClock,
    private readonly ephemeris: EphemerisService,
    private readonly config: CelestialConfig,
    private bodies: CelestialBodies
  ) {}

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

    for (const [name, cfg] of Object.entries(this.config.bodies)) {
      if (name === 'stars' || name === 'sun') continue;
      this._updateBody(name, cfg, date, mode);
    }
    for (const cfg of Object.values(this.config.bodies)) {
      if (!cfg.satellites) continue;
      for (const [satName, satCfg] of Object.entries(cfg.satellites)) {
        this._updateBody(satName, satCfg, date, mode);
      }
    }
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
      // Transformation : plan orbital → écliptique via inclinaison i et nœud ascendant Ω.
      const periodDays = cfg.realData?.orbitPeriodDays;
      if (!periodDays) return;
      const angularVelocity = (Math.PI * 2) / (periodDays * 86_400);
      const angle = (this._orbitAngles.get(name) ?? 0) + angularVelocity * this._simDeltaSeconds;
      this._orbitAngles.set(name, angle);
      const distanceAU = cfg.realData?.distanceAU;
      const r = distanceAU !== undefined ? Math.sqrt(distanceAU) * SQRT_K : (cfg.orbitalRadius ?? 0);
      const i = cfg.realData?.orbitalInclination ?? 0;
      const Ω = cfg.realData?.ascendingNode ?? 0;
      const cosΩ = Math.cos(Ω), sinΩ = Math.sin(Ω), cosI = Math.cos(i), sinI = Math.sin(i);
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      // Z négatif : repère Three droitier (+Y nord), orbite prograde (cf. _toScene).
      body.group.position.set(
        r * (cosΩ * cosA - sinΩ * sinA * cosI),
        r * sinA * sinI,
        -r * (sinΩ * cosA + cosΩ * sinA * cosI)
      );
    } else {
      // Mode Explo — positions Kepler réelles depuis astronomy-engine
      this._computeExploPos(name, date);
      body.group.position.copy(this._exploPos);
    }
  }

  private _computeExploPos(name: string, date: Date): void {
    if (name === 'moon') {
      const moonGeoAU = this.ephemeris.getMoonGeocentricAU(date);
      // En mode Explo, la Terre a son vrai rayon (0.0015u) → la Lune à 0.0899u
      // est bien en dehors du mesh. On utilise l'échelle linéaire (AU × SQRT_K)
      // comme les autres planètes, sans compression √ (réservée au mode Éducatif).
      this._exploPos.copy(this.scale.auVectorToScene(moonGeoAU));
    } else {
      const helioAU = this.ephemeris.getHeliocentricAU(name, date);
      if (helioAU) {
        this._exploPos.copy(this.scale.auVectorToScene(helioAU)); // AU × SQRT_K
      } else {
        this._exploPos.set(0, 0, 0);
      }
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
   * Transformation inverse : projette la position Three.js (plan XZ = écliptique,
   * +Y nord, repère droitier — cf. _toScene) sur les axes e1/e2 du plan orbital
   * définis par Ω (nœud ascendant) et i (inclinaison).
   *   e1 = (cosΩ, 0, -sinΩ)              — direction du nœud ascendant
   *   e2 = (-sinΩ·cosI, sinI, -cosΩ·cosI) — direction perpendiculaire dans le plan orbital
   *   angle = atan2(pos·e2, pos·e1)
   */
  syncAnglesFromEphemeris(date: Date): void {
    const syncBody = (name: string, cfg: CelestialBodyConfig): void => {
      const body = this.bodies[name];

      // Oriente l'axe de rotation sur le vrai pôle IAU (obliquité + azimut réels).
      // Pour un corps rétrograde (obliquité > 90°), le moment cinétique de spin pointe à
      // l'opposé du pôle nord IAU : on passe -pôle pour que +rotationSpeed reste correct.
      if (body) {
        const north = this.ephemeris.getNorthPoleDirection(name, date);
        if (north) {
          const retrograde = (cfg.realData?.axialTilt ?? 0) > Math.PI / 2;
          body.setAxisDirection(retrograde ? north.multiplyScalar(-1) : north);
        }
      }

      if (!cfg.realData?.distanceAU) return;
      const Ω   = cfg.realData.ascendingNode ?? 0;
      const inc = cfg.realData.orbitalInclination ?? 0;
      const pos = name === 'moon'
        ? this.ephemeris.getMoonGeocentricAU(date)
        : this.ephemeris.getHeliocentricAU(name, date);
      if (!pos) return;
      const cosΩ = Math.cos(Ω), sinΩ = Math.sin(Ω);
      const cosI = Math.cos(inc), sinI = Math.sin(inc);
      const dotE1 = pos.x * cosΩ - pos.z * sinΩ;
      const dotE2 = -pos.x * sinΩ * cosI + pos.y * sinI - pos.z * cosΩ * cosI;
      this._orbitAngles.set(name, Math.atan2(dotE2, dotE1));
    };

    for (const [name, cfg] of Object.entries(this.config.bodies)) {
      if (name === 'stars' || name === 'sun') continue;
      syncBody(name, cfg);
      if (cfg.satellites) {
        for (const [satName, satCfg] of Object.entries(cfg.satellites)) {
          syncBody(satName, satCfg);
        }
      }
    }

    // Aligne la rotation de surface de la Terre sur l'heure UTC réelle.
    //   θSun       = azimut du Soleil vu de la Terre, dans le plan écliptique XZ.
    //   subSolarLon = longitude géographique face au Soleil = (12 - utcH)·π/12
    //                 (0° à 12h UTC = midi à Greenwich ; -90° à 18h ; +180° à 0h).
    // On veut que le méridien subSolarLon pointe vers le Soleil (azimut θSun). Avec la
    // convention de la SphereGeometry (azimut d'un méridien = -longitude - rotation.y) :
    //   rotation.y = -θSun - subSolarLon
    const earthPos = this.ephemeris.getHeliocentricAU('earth', date);
    const earthBody = this.bodies['earth'];
    if (earthPos && earthBody) {
      const θSun = Math.atan2(-earthPos.z, -earthPos.x);
      const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
      earthBody.setInitialSurfaceRotation(-θSun - (12 - utcH) * Math.PI / 12);
    }
  }

  computeOrbitPoints(
    bodyName: string,
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
      const cosΩ = Math.cos(node), sinΩ = Math.sin(node);
      const cosI = Math.cos(inc),  sinI = Math.sin(inc);
      const arr  = new Float32Array((nPoints + 1) * 3);
      for (let i = 0; i <= nPoints; i++) {
        const a    = (i / nPoints) * Math.PI * 2;
        const cosA = Math.cos(a), sinA = Math.sin(a);
        arr[i * 3]     = r * (cosΩ * cosA - sinΩ * sinA * cosI);
        arr[i * 3 + 1] = r * sinA * sinI;
        arr[i * 3 + 2] = -r * (sinΩ * cosA + cosΩ * sinA * cosI);
      }
      return arr;
    }

    // Mode Explo : ellipse Kepler réelle depuis astronomy-engine.
    const period = cfg.realData?.orbitPeriodDays;
    if (!period) return null;

    const arr = new Float32Array((nPoints + 1) * 3);

    for (let i = 0; i <= nPoints; i++) {
      const t = new Date(date.getTime() + (i / nPoints) * period * 86_400_000);

      let s: THREE.Vector3;
      if (bodyName === 'moon') {
        // Explo : échelle linéaire pour la Lune (même que les planètes)
        // Le mesh Terre est à 0.0015u → Lune à 0.0899u est en dehors. Pas de compression √.
        s = this.scale.auVectorToScene(this.ephemeris.getMoonGeocentricAU(t));
      } else {
        const pos = this.ephemeris.getHeliocentricAU(bodyName, t);
        if (!pos) return null;
        s = this.scale.auVectorToScene(pos);  // AU × SQRT_K (linéaire)
      }

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

  addTimeOffsetMonths(months: number): void {
    this.clock.addMonths(months);
    this._afterTimeTravel(true);
  }

  addTimeOffsetYears(years: number): void {
    this.clock.addYears(years);
    this._afterTimeTravel(true);
  }

  // Glissements heure/min/sec : re-sync angles + rotation, mais pas les lignes d'orbite
  addTimeOffsetHours(hours: number): void     { this.clock.addHours(hours);     this._afterTimeTravel(false); }
  addTimeOffsetMinutes(minutes: number): void { this.clock.addMinutes(minutes); this._afterTimeTravel(false); }
  addTimeOffsetSeconds(seconds: number): void { this.clock.addSeconds(seconds); this._afterTimeTravel(false); }

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
