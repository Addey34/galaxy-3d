/**
 * LA TRAJECTOIRE D'UNE SONDE, en instants à échantillonner (2026-10-11).
 *
 * Deux tracés, parce qu'une sonde change de repère au cours de sa mission (cf.
 * `satellitePhases.ts`) :
 *   - EN ROUTE, hors de toute phase `satelliteOf` : son chemin héliocentrique sur toute la
 *     couverture de son fichier, découpé en tronçons aux phases. Un tronçon garde des instants
 *     répartis sur sa durée, plus des instants serrés dans chaque SEGMENT qui le touche (un
 *     survol tourne en quelques heures, et une corde entre deux points à trente jours d'écart
 *     traverserait la planète) ;
 *   - EN ORBITE, quand la date de la scène tombe dans une phase : la révolution en cours,
 *     relative au corps comme la ligne d'orbite d'une lune, sur une période osculatrice centrée
 *     sur la date et bornée à la phase.
 *
 * Rien ici ne lit une position : ce module dit QUELS instants, le tracé lit le service.
 */
import type { SatellitePhase } from './satellitePhases';

/** Un intervalle de temps, en millisecondes UTC, bornes incluses. */
export interface TimeInterval {
  fromMs: number;
  toMs: number;
}

const MS_PER_DAY = 86_400_000;

/** Instants répartis sur l'ensemble des tronçons en route, au prorata de leur durée. */
export const CRUISE_POINTS = 1500;
/** Instants ajoutés dans chaque segment qui touche un tronçon (survol, bord d'une phase). */
export const SEGMENT_POINTS = 64;
/** Instants d'une révolution tracée. */
export const REVOLUTION_POINTS = 240;
/**
 * Demi-largeur de la fenêtre tracée quand l'orbite osculatrice n'est pas fermée (une sonde en
 * vol stationnaire près d'un astéroïde, que l'énergie à deux corps ne lie pas toujours).
 */
export const UNBOUND_HALF_WINDOW_DAYS = 3;

/** La couverture privée des phases : les tronçons où la sonde est héliocentrique. */
export function cruiseIntervals(
  coverage: TimeInterval,
  phases: readonly SatellitePhase[]
): TimeInterval[] {
  const out: TimeInterval[] = [];
  let from = coverage.fromMs;
  for (const phase of [...phases].sort((a, b) => a.fromMs - b.fromMs)) {
    if (phase.toMs < from || phase.fromMs > coverage.toMs) continue;
    if (phase.fromMs > from) out.push({ fromMs: from, toMs: phase.fromMs });
    from = Math.max(from, phase.toMs);
  }
  if (from < coverage.toMs) out.push({ fromMs: from, toMs: coverage.toMs });
  return out;
}

/**
 * Les instants d'un tronçon : `count` répartis régulièrement, bornes comprises, plus
 * `SEGMENT_POINTS` dans la partie de chaque segment qui le recouvre. Triés, sans doublon.
 */
export function intervalTimes(
  interval: TimeInterval,
  count: number,
  segments: readonly TimeInterval[]
): number[] {
  const times = new Set<number>();
  const spread = (from: number, to: number, n: number) => {
    if (n < 2 || to <= from) {
      times.add(from);
      return;
    }
    for (let i = 0; i < n; i++) times.add(from + ((to - from) * i) / (n - 1));
  };
  spread(interval.fromMs, interval.toMs, Math.max(2, count));
  for (const segment of segments) {
    const from = Math.max(segment.fromMs, interval.fromMs);
    const to = Math.min(segment.toMs, interval.toMs);
    if (to > from) spread(from, to, SEGMENT_POINTS);
  }
  return [...times].sort((a, b) => a - b);
}

/** Les instants de chaque tronçon en route, `CRUISE_POINTS` au total hors segments. */
export function cruiseTimes(
  intervals: readonly TimeInterval[],
  segments: readonly TimeInterval[],
  points: number = CRUISE_POINTS
): number[][] {
  const total = intervals.reduce((n, i) => n + (i.toMs - i.fromMs), 0);
  if (total <= 0) return [];
  return intervals.map((interval) =>
    intervalTimes(
      interval,
      Math.round((points * (interval.toMs - interval.fromMs)) / total),
      segments
    )
  );
}

/** Un vecteur, sans dépendre de three.js : ce module ne lit aucune position. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Les instants de la révolution en cours : une période osculatrice centrée sur `nowMs`, tirée
 * de l'état RELATIF au corps (position UA, vitesse UA/jour), bornée à la phase.
 *
 * Répartis en ANOMALIE EXCENTRIQUE, pas en temps. Juno tourne sur une ellipse d'excentricité
 * 0,98 en 53 jours et passe son périjove en quelques heures : 240 instants réguliers en temps
 * tombaient à 5 h l'un de l'autre et coupaient le périjove d'une corde (vu le 2026-10-11). En
 * anomalie excentrique ils se serrent au périapse et s'écartent à l'apoapse, là où la sonde
 * avance lentement. Une orbite circulaire rend des instants réguliers.
 *
 * Une orbite osculatrice ouverte (énergie positive) se trace sur ±`UNBOUND_HALF_WINDOW_DAYS`,
 * à instants réguliers.
 */
export function revolutionTimes(
  position: Vec3,
  velocity: Vec3,
  mu: number,
  nowMs: number,
  phase: TimeInterval,
  count: number = REVOLUTION_POINTS
): number[] {
  const r = Math.sqrt(dot(position, position));
  const v2 = dot(velocity, velocity);
  const energy = v2 / 2 - mu / r;
  const inPhase = (t: number) => t >= phase.fromMs && t <= phase.toMs;
  if (!(energy < 0)) {
    const half = UNBOUND_HALF_WINDOW_DAYS * MS_PER_DAY;
    return windowTimes(
      {
        fromMs: Math.max(phase.fromMs, nowMs - half),
        toMs: Math.min(phase.toMs, nowMs + half),
      },
      count
    );
  }
  const a = -mu / (2 * energy);
  const hx = position.y * velocity.z - position.z * velocity.y;
  const hy = position.z * velocity.x - position.x * velocity.z;
  const hz = position.x * velocity.y - position.y * velocity.x;
  const h2 = hx * hx + hy * hy + hz * hz;
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu)));
  const n = Math.sqrt(mu / (a * a * a)); // rad/jour
  // Anomalie excentrique de l'instant présent ; sur un cercle elle n'a pas de sens, et 0 suffit.
  const e0 =
    e < 1e-9
      ? 0
      : Math.atan2(dot(position, velocity) / Math.sqrt(mu * a), 1 - r / a);
  const m0 = e0 - e * Math.sin(e0);
  const times: number[] = [];
  for (let k = 0; k < count; k++) {
    const ea = e0 - Math.PI + (2 * Math.PI * k) / (count - 1);
    const t = nowMs + ((ea - e * Math.sin(ea) - m0) / n) * MS_PER_DAY;
    if (inPhase(t)) times.push(t);
  }
  return times;
}

/** `count` instants réguliers sur une fenêtre, bornes comprises. */
export function windowTimes(window: TimeInterval, count: number): number[] {
  return intervalTimes(window, count, []);
}

/** Premier index dont l'instant dépasse `nowMs` : ce qui le précède est déjà parcouru. */
export function pastCount(times: readonly number[], nowMs: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= nowMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
