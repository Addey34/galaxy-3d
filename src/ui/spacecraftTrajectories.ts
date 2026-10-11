/**
 * LES TRAJECTOIRES DES SONDES (2026-10-11), colonne « Orbite » du tableau Réglages.
 *
 * Chargé à la PREMIÈRE trajectoire allumée (`SpacecraftOverlay.setTrajectoryNames`), jamais au
 * démarrage : elles sont éteintes par défaut, comme celles des objets interstellaires.
 *
 * Deux tracés (cf. `core/spacecraftTrajectory.ts`) :
 *   - EN ROUTE : le chemin héliocentrique hors des phases `satelliteOf`, sur toute la couverture
 *     du fichier. Il ne dépend pas de la date : calculé une fois que ses octets sont arrivés.
 *     Chaque point est placé par `scaleToScene`, la règle même du marqueur hors d'une phase ;
 *   - EN ORBITE : la révolution en cours autour du corps, RELATIVE à lui. Chaque point est la
 *     position du corps À LA DATE DE LA SCÈNE plus le vecteur relatif à son instant, puis passe
 *     par le placeur du marqueur : la ligne passe donc par le marqueur, et se pose autour du
 *     corps comme la ligne d'orbite d'une lune, dans les deux modes et pendant le morph.
 *
 * Le chemin parcouru est tracé plus franchement que le chemin à venir.
 *
 * Les octets se demandent à l'allumage, tronçon par tronçon (`ensureCoverage` avec un
 * intervalle par sonde, que le service étend à ses segments), et la révolution se redemande
 * quand la date sort de ce qui est tenu.
 */
import * as THREE from 'three';
import { scaleToScene } from '@/core/overlayScale';
import { activeSatelliteBody } from '@/core/satellitePhases';
import { gravitationalParameter } from '@/core/twoBodyPropagation';
import type { InstrumentPlacer } from '@/core/instrumentPlacement';
import type {
  SceneWindowRequest,
  TrajectoryCoverage,
} from '@/core/HorizonsEphemerisService';
import {
  cruiseIntervals,
  cruiseTimes,
  pastCount,
  REVOLUTION_POINTS,
  revolutionTimes,
  type TimeInterval,
} from '@/core/spacecraftTrajectory';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import type { SpacecraftMission } from '@/config/spacecraft';

/** Ce que le tracé demande au service des éphémérides. */
export interface TrajectoryService {
  getHeliocentricAU(name: string, date: Date): THREE.Vector3 | null;
  trajectoryCoverage(name: string): TrajectoryCoverage | null;
  ensureCoverage(request: SceneWindowRequest): Promise<unknown>;
}

/** Un tronçon en route : ses instants, et ses points (UA, scène) une fois mesurés. */
interface Run {
  times: number[];
  au: Float32Array | null;
}

interface Cruise {
  runs: Run[];
  /** Vrai quand les octets demandés sont arrivés (ou que leur absence est actée). */
  arrived: boolean;
}

interface Revolution {
  body: string;
  window: TimeInterval;
  /** Instant de la scène pour lequel la révolution a été calculée. */
  nowMs: number;
  times: number[];
  /** Vecteurs relatifs au corps (UA), `null` tant que les octets manquent. */
  rel: Float32Array | null;
}

const PAST_ALPHA = 0.55;
const FUTURE_ALPHA = 0.22;
/** Marge (px) hors de laquelle un segment dont les deux bouts sont du même côté est ignoré. */
const OFFSCREEN_MARGIN_PX = 64;
/** Pas de la différence centrée qui donne la vitesse relative (vis-viva). */
const VELOCITY_STEP_MS = 60_000;

const catalogue = flattenBodies(CELESTIAL_CONFIG);
const inDepth = (p: THREE.Vector3): boolean => p.z >= -1 && p.z <= 1;

export class SpacecraftTrajectories {
  private names: ReadonlySet<string> = new Set();
  private readonly cruises = new Map<string, Cruise>();
  private readonly revolutions = new Map<string, Revolution>();
  /** Fenêtres de révolution déjà demandées, par sonde. */
  private readonly requested = new Map<string, TimeInterval>();
  private readonly byName: Map<string, SpacecraftMission>;
  private readonly _p = new THREE.Vector3();
  private readonly _a = new THREE.Vector3();

  constructor(
    private readonly service: TrajectoryService,
    missions: readonly SpacecraftMission[],
    /** Appelé quand des octets arrivent : la vue n'a pas bougé, la ligne si. */
    private readonly onArrival: () => void = () => {}
  ) {
    this.byName = new Map(missions.map((m) => [m.name, m]));
  }

  /** Sondes dont la trajectoire est tracée. Les autres noms sont ignorés. */
  setNames(names: ReadonlySet<string>): void {
    this.names = new Set([...names].filter((n) => this.byName.has(n)));
    for (const name of this.names) this._requestCruise(name);
  }

  get count(): number {
    return this.names.size;
  }

  private _requestCruise(name: string): void {
    if (this.cruises.has(name)) return;
    const mission = this.byName.get(name)!;
    const coverage = this.service.trajectoryCoverage(name);
    if (!coverage) return;
    const intervals = cruiseIntervals(coverage, mission.satelliteOf);
    const cruise: Cruise = {
      runs: cruiseTimes(intervals, coverage.segments).map((times) => ({
        times,
        au: null,
      })),
      arrived: false,
    };
    this.cruises.set(name, cruise);
    void (async () => {
      // Un tronçon à la fois : chaque demande remplace la scène du service, et une seule
      // fenêtre contiguë par fichier est tenue, que chaque demande ÉTEND.
      for (const interval of intervals)
        await this.service.ensureCoverage({
          date: new Date(interval.fromMs),
          spans: {
            [name]: {
              from: new Date(interval.fromMs),
              to: new Date(interval.toMs),
            },
          },
        });
      cruise.arrived = true;
      this.onArrival();
    })();
  }

  /** Mesure les points d'un tronçon ; un instant sans position coupe la ligne (NaN). */
  private _measureRun(name: string, run: Run): void {
    const au = new Float32Array(run.times.length * 3);
    run.times.forEach((t, i) => {
      const p = this.service.getHeliocentricAU(name, new Date(t));
      au[i * 3] = p ? p.x : NaN;
      au[i * 3 + 1] = p ? p.y : NaN;
      au[i * 3 + 2] = p ? p.z : NaN;
    });
    run.au = au;
  }

  /**
   * La révolution autour du corps dont la sonde est le satellite à `date`, ou `null` hors
   * phase. Recalculée quand la date a parcouru un intervalle d'échantillonnage.
   */
  private _revolution(
    mission: SpacecraftMission,
    date: Date
  ): Revolution | null {
    const body = activeSatelliteBody(mission.satelliteOf, date);
    if (!body) {
      this.revolutions.delete(mission.name);
      return null;
    }
    const nowMs = date.getTime();
    const held = this.revolutions.get(mission.name);
    if (
      held &&
      held.body === body &&
      held.rel !== null &&
      Math.abs(nowMs - held.nowMs) <
        (held.window.toMs - held.window.fromMs) / REVOLUTION_POINTS
    )
      return held;
    const phase = mission.satelliteOf.find(
      (p) => p.body === body && nowMs >= p.fromMs && nowMs <= p.toMs
    )!;
    const massKg = catalogue.get(body)?.realData?.massKg;
    const relAt = (ms: number): THREE.Vector3 | null => {
      const d = new Date(ms);
      const probe = this.service.getHeliocentricAU(mission.name, d);
      const parent = this.service.getHeliocentricAU(body, d);
      return probe && parent ? probe.sub(parent) : null;
    };
    const here = relAt(nowMs);
    const before = relAt(nowMs - VELOCITY_STEP_MS);
    const after = relAt(nowMs + VELOCITY_STEP_MS);
    if (!here || !before || !after || !massKg) {
      this._requestRevolution(mission.name, {
        fromMs: nowMs - VELOCITY_STEP_MS,
        toMs: nowMs + VELOCITY_STEP_MS,
      });
      return held ?? null;
    }
    const velocity = after
      .sub(before)
      .divideScalar((2 * VELOCITY_STEP_MS) / 86_400_000);
    const times = revolutionTimes(
      here,
      velocity,
      gravitationalParameter(massKg),
      nowMs,
      phase
    );
    if (times.length < 2) return null;
    const window = { fromMs: times[0]!, toMs: times.at(-1)! };
    const rel = new Float32Array(times.length * 3);
    let complete = true;
    times.forEach((t, i) => {
      const r = relAt(t);
      if (!r) complete = false;
      rel[i * 3] = r ? r.x : NaN;
      rel[i * 3 + 1] = r ? r.y : NaN;
      rel[i * 3 + 2] = r ? r.z : NaN;
    });
    if (!complete) this._requestRevolution(mission.name, window);
    const revolution: Revolution = { body, window, nowMs, times, rel };
    this.revolutions.set(mission.name, revolution);
    return revolution;
  }

  /** Demande une fenêtre de révolution, élargie d'autant de chaque côté, si elle n'est pas tenue. */
  private _requestRevolution(name: string, window: TimeInterval): void {
    const held = this.requested.get(name);
    if (held && held.fromMs <= window.fromMs && held.toMs >= window.toMs)
      return;
    const width = window.toMs - window.fromMs;
    const wanted = {
      fromMs: window.fromMs - width,
      toMs: window.toMs + width,
    };
    this.requested.set(name, wanted);
    void this.service
      .ensureCoverage({
        date: new Date((window.fromMs + window.toMs) / 2),
        spans: {
          [name]: { from: new Date(wanted.fromMs), to: new Date(wanted.toMs) },
        },
      })
      .then(() => {
        this.revolutions.delete(name);
        this.onArrival();
      });
  }

  /** Trace les trajectoires allumées ; rend combien l'ont été. */
  draw(
    ctx: CanvasRenderingContext2D,
    camera: THREE.PerspectiveCamera,
    date: Date,
    morph: number,
    place: InstrumentPlacer,
    w: number,
    h: number
  ): number {
    let drawn = 0;
    const nowMs = date.getTime();
    for (const name of this.names) {
      const mission = this.byName.get(name)!;
      const css = `#${mission.color.toString(16).padStart(6, '0')}`;
      let any = false;
      const cruise = this.cruises.get(name);
      if (cruise?.arrived)
        for (const run of cruise.runs) {
          if (!run.au) this._measureRun(name, run);
          const au = run.au!;
          const split = pastCount(run.times, nowMs);
          const toScene = (i: number, out: THREE.Vector3) =>
            Number.isNaN(au[i * 3]!)
              ? null
              : scaleToScene(
                  out,
                  au[i * 3]!,
                  au[i * 3 + 1]!,
                  au[i * 3 + 2]!,
                  morph
                );
          any =
            this._stroke(
              ctx,
              camera,
              toScene,
              0,
              split,
              css,
              PAST_ALPHA,
              w,
              h
            ) || any;
          any =
            this._stroke(
              ctx,
              camera,
              toScene,
              Math.max(0, split - 1),
              run.times.length,
              css,
              FUTURE_ALPHA,
              w,
              h
            ) || any;
        }
      const revolution = this._revolution(mission, date);
      const parent = revolution
        ? this.service.getHeliocentricAU(revolution.body, date)
        : null;
      if (revolution?.rel && parent) {
        const rel = revolution.rel;
        const toScene = (i: number, out: THREE.Vector3) => {
          if (Number.isNaN(rel[i * 3]!)) return null;
          this._a.set(
            parent.x + rel[i * 3]!,
            parent.y + rel[i * 3 + 1]!,
            parent.z + rel[i * 3 + 2]!
          );
          return place(out, name, this._a, date, morph);
        };
        const split = pastCount(revolution.times, nowMs);
        any =
          this._stroke(ctx, camera, toScene, 0, split, css, PAST_ALPHA, w, h) ||
          any;
        any =
          this._stroke(
            ctx,
            camera,
            toScene,
            Math.max(0, split - 1),
            revolution.times.length,
            css,
            FUTURE_ALPHA,
            w,
            h
          ) || any;
      }
      if (any) drawn++;
    }
    return drawn;
  }

  /**
   * Un trait plein entre les points `[from, to[`. Même tri que les trajectoires interstellaires
   * (`interstellarOverlay._drawPath`) : un segment dont les deux bouts sortent du même côté de
   * l'écran est sauté, et un point hors de la profondeur visible coupe la ligne, sans quoi il
   * retomberait de l'autre côté de l'écran. Rend vrai si au moins un point était placé.
   */
  private _stroke(
    ctx: CanvasRenderingContext2D,
    camera: THREE.PerspectiveCamera,
    toScene: (i: number, out: THREE.Vector3) => THREE.Vector3 | null,
    from: number,
    to: number,
    css: string,
    alpha: number,
    w: number,
    h: number
  ): boolean {
    if (to - from < 2) return false;
    const m = OFFSCREEN_MARGIN_PX;
    const outside = (x: number, y: number): number =>
      (x < -m ? 1 : 0) |
      (x > w + m ? 2 : 0) |
      (y < -m ? 4 : 0) |
      (y > h + m ? 8 : 0);
    ctx.save();
    ctx.strokeStyle = css;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let placed = false;
    let hasPrev = false;
    let penAt = false;
    let px = 0;
    let py = 0;
    for (let i = from; i < to; i++) {
      const p = toScene(i, this._p);
      if (!p) {
        hasPrev = false;
        penAt = false;
        continue;
      }
      placed = true;
      p.project(camera);
      if (!inDepth(p)) {
        hasPrev = false;
        penAt = false;
        continue;
      }
      const x = (p.x * 0.5 + 0.5) * w;
      const y = (-p.y * 0.5 + 0.5) * h;
      if (hasPrev && (outside(px, py) & outside(x, y)) === 0) {
        if (!penAt) ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        penAt = true;
      } else {
        penAt = false;
      }
      px = x;
      py = y;
      hasPrev = true;
    }
    ctx.stroke();
    ctx.restore();
    return placed;
  }
}
