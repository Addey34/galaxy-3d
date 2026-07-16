/**
 * Propagation d'orbites képlériennes — fonctions pures, sans état, testées unitairement
 * (cf. kepler.test.ts). Positionne un corps à partir de ses éléments orbitaux classiques,
 * là où astronomy-engine ne fournit pas d'éphéméride (astéroïdes, comètes, géocroiseurs,
 * planètes naines, lunes mineures).
 *
 * Repère : héliocentrique écliptique J2000 (le repère des éléments JPL Small-Body Database
 * et du Minor Planet Center). Le mapping vers Three.js est délégué à `frames.eclipticToScene`.
 *
 * Modèle : orbite elliptique fixe (deux corps). Suffisant à l'échelle de la visualisation ;
 * les perturbations planétaires ne sont pas modélisées — rafraîchir les éléments (nouvelle
 * époque) pour la précision long terme, comme le font les catalogues.
 */

/**
 * Éléments orbitaux képlériens classiques. Angles en radians, distances en UA.
 * Convention JPL/MPC (héliocentrique écliptique J2000).
 */
export interface OrbitalElements {
  /** Demi-grand axe (UA). Doit être > 0 (orbites elliptiques uniquement). */
  semiMajorAxisAU: number;
  /** Excentricité (0 = cercle, < 1 = ellipse). */
  eccentricity: number;
  /** Inclinaison sur l'écliptique (rad). */
  inclinationRad: number;
  /** Longitude du nœud ascendant Ω (rad). */
  ascendingNodeRad: number;
  /** Argument du périhélie ω (rad). */
  argPerihelionRad: number;
  /** Anomalie moyenne à l'époque M₀ (rad). */
  meanAnomalyAtEpochRad: number;
  /** Époque de référence des éléments (date à laquelle M = M₀). */
  epoch: Date;
}

/** Constante gravitationnelle de Gauss (rad/jour) — mouvement moyen n = k / a^1.5. */
const GAUSS_K = 0.017_202_098_95;

/** Jours juliens depuis l'epoch Unix, pour une date JavaScript. */
const MS_PER_DAY = 86_400_000;

/** Écart en jours entre deux dates. */
function daysBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / MS_PER_DAY;
}

/**
 * Résout l'équation de Kepler `M = E − e·sin(E)` pour l'anomalie excentrique E (rad),
 * par itération de Newton-Raphson. Converge en quelques itérations pour e < 1.
 *
 * @param meanAnomaly  anomalie moyenne M (rad), quelconque (non normalisée requise)
 * @param eccentricity excentricité e (0 ≤ e < 1)
 */
export function solveKepler(meanAnomaly: number, eccentricity: number): number {
  // Normalise M dans [-π, π] pour une bonne graine et une convergence symétrique.
  const twoPi = Math.PI * 2;
  let m = meanAnomaly % twoPi;
  if (m > Math.PI) m -= twoPi;
  if (m < -Math.PI) m += twoPi;

  // Graine : E ≈ M + e·sin(M) (premier ordre), robuste jusqu'aux fortes excentricités.
  let e = m + eccentricity * Math.sin(m);
  for (let i = 0; i < 30; i++) {
    const f = e - eccentricity * Math.sin(e) - m;
    const fPrime = 1 - eccentricity * Math.cos(e);
    const delta = f / fPrime;
    e -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  return e;
}

/**
 * Position héliocentrique écliptique J2000 (UA) d'un corps à une date donnée, à partir de
 * ses éléments orbitaux. Retourne un triplet `{ x, y, z }` (x vers l'équinoxe vernal,
 * z vers le pôle nord écliptique) — passer à `frames.eclipticToScene` pour le repère Three.js.
 */
export function keplerianPositionEcliptic(
  el: OrbitalElements,
  date: Date
): { x: number; y: number; z: number } {
  const a = el.semiMajorAxisAU;
  const e = el.eccentricity;

  // Mouvement moyen (rad/jour) puis anomalie moyenne à la date.
  const n = GAUSS_K / Math.sqrt(a * a * a);
  const M = el.meanAnomalyAtEpochRad + n * daysBetween(date, el.epoch);

  const E = solveKepler(M, e);

  // Position dans le plan orbital (périfocal) : X vers le périhélie, Y à 90° dans le sens direct.
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const xOrb = a * (cosE - e);
  const yOrb = a * Math.sqrt(1 - e * e) * sinE;

  // Rotation périfocal → écliptique : R_z(Ω) · R_x(i) · R_z(ω).
  const cosO = Math.cos(el.ascendingNodeRad);
  const sinO = Math.sin(el.ascendingNodeRad);
  const cosI = Math.cos(el.inclinationRad);
  const sinI = Math.sin(el.inclinationRad);
  const cosW = Math.cos(el.argPerihelionRad);
  const sinW = Math.sin(el.argPerihelionRad);

  const x =
    (cosO * cosW - sinO * sinW * cosI) * xOrb +
    (-cosO * sinW - sinO * cosW * cosI) * yOrb;
  const y =
    (sinO * cosW + cosO * sinW * cosI) * xOrb +
    (-sinO * sinW + cosO * cosW * cosI) * yOrb;
  const z = sinW * sinI * xOrb + cosW * sinI * yOrb;

  return { x, y, z };
}
