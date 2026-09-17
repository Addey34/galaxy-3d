/**
 * Propagation d'orbites képlériennes — fonctions pures, sans état, testées unitairement
 * (cf. kepler.test.ts). Positionne un corps à partir de ses éléments orbitaux classiques,
 * là où astronomy-engine ne fournit pas d'éphéméride (astéroïdes, comètes, géocroiseurs,
 * planètes naines, lunes mineures).
 *
 * Repère : héliocentrique écliptique J2000 (le repère des éléments JPL Small-Body Database
 * et du Minor Planet Center). Le mapping vers Three.js est délégué à `frames.eclipticToScene`.
 *
 * Modèle : conique fixe (deux corps) — ellipse (e < 1) ou hyperbole (e > 1, objets
 * interstellaires). Suffisant à l'échelle de la visualisation ; les perturbations planétaires
 * ne sont pas modélisées — rafraîchir les éléments (nouvelle époque) pour la précision long
 * terme, comme le font les catalogues. La parabole exacte (e = 1) n'a pas de demi-grand axe
 * fini et n'est pas prise en charge.
 */

/**
 * Éléments orbitaux képlériens classiques. Angles en radians, distances en UA.
 * Convention JPL/MPC (héliocentrique écliptique J2000).
 */
export interface OrbitalElements {
  /**
   * Demi-grand axe (UA). > 0 pour une ellipse ; < 0 pour une hyperbole, convention JPL
   * (a = q / (1 − e), celle que renvoie Horizons dans son champ `A`).
   */
  semiMajorAxisAU: number;
  /** Excentricité (0 = cercle, < 1 = ellipse, > 1 = hyperbole). */
  eccentricity: number;
  /** Inclinaison sur l'écliptique (rad). */
  inclinationRad: number;
  /** Longitude du nœud ascendant Ω (rad). */
  ascendingNodeRad: number;
  /** Argument du périhélie ω (rad). */
  argPerihelionRad: number;
  /**
   * Anomalie moyenne à l'époque M₀ (rad). Pour une hyperbole elle n'est PAS périodique et ne
   * se réduit jamais modulo 2π : Horizons donne 818° pour 3I/ATLAS à son époque, et c'est
   * bien 818° qu'il faut propager.
   */
  meanAnomalyAtEpochRad: number;
  /** Époque de référence des éléments (date à laquelle M = M₀). */
  epoch: Date;
  /**
   * Période de révolution (jours). À renseigner dès que le corps central N'EST PAS le
   * Soleil — typiquement une lune autour de sa planète.
   *
   * Sans elle, le mouvement moyen est déduit de la troisième loi de Kepler avec la constante
   * de Gauss, donc avec le μ du SOLEIL. Pour un satellite, cela revient à le faire tourner
   * comme s'il orbitait le Soleil à quelques dizaines de milliers de kilomètres : l'erreur
   * est le rapport √(M☉/M_parent), soit de 32× (Amalthée) à 11 661× (Charon) trop rapide —
   * mesuré sur le catalogue, pas estimé. La géométrie de l'orbite restait juste, seule sa
   * CADENCE était fausse : le corps parcourait la bonne ellipse des milliers de fois trop
   * vite, ce qui, échantillonné pour tracer la ligne d'orbite, produisait un repliement
   * complet (la ligne ne décrivait plus l'orbite du tout).
   *
   * On passe la période plutôt qu'un μ : elle est déjà dans le catalogue
   * (`realData.orbitPeriodDays`), publiée et vérifiable corps par corps, là où un μ
   * demanderait une table de masses à tenir à jour en plus.
   */
  periodDays?: number;
  /**
   * Éléments rapportés au BARYCENTRE du Système solaire plutôt qu'au Soleil. La position
   * rendue par `keplerianPositionEcliptic` est alors barycentrique ; `OrbitalElementsService`
   * y ajoute la position du barycentre vue du Soleil.
   *
   * Pourquoi. Au-delà de Neptune, l'osculateur héliocentrique contient le mouvement réflexe
   * du Soleil autour du barycentre (~0,01 UA, période de Jupiter) : une vitesse parasite de
   * ~13 m/s sur ~4 km/s, qui fausse le demi-grand axe donc la période. Mesuré contre
   * Horizons sur 1900-2100 : Éris 2,5e7 km d'erreur moyenne en héliocentrique, 1,1e4 km en
   * barycentrique ; Sedna 2,6e7 contre 1,3e4. Pour Cérès et Vesta c'est l'inverse (le Soleil
   * domine, héliocentrique meilleur d'un facteur 10 à 100) : le choix est donc une donnée
   * par corps, mesurée, jamais une règle de distance.
   *
   * Le corps central est alors le Soleil PLUS les planètes : μ = k²·(1 + Σ m_planètes / m☉).
   */
  barycentric?: boolean;
}

/** Constante gravitationnelle de Gauss (rad/jour) — mouvement moyen n = k / a^1.5. */
const GAUSS_K = 0.017_202_098_95;

/**
 * Σ GM des planètes (systèmes, Lune incluse dans le barycentre Terre-Lune, Pluton compris) /
 * GM du Soleil, valeurs DE440 (km³/s²) : 178 078 630 / 132 712 440 041. Sans ce facteur,
 * une orbite barycentrique propagée au μ solaire dérive de 0,067 % par période : mesuré sur
 * Éris, 2,6e6 km de moyenne sur 1900-2100 au lieu de 1,1e4.
 */
export const PLANETS_TO_SUN_MASS_RATIO = 1.341_839e-3;

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
 * @param eccentricity excentricité e (0 ≤ e < 1) — une valeur ≥ 1 n'a pas de sens pour cette
 *   forme elliptique : Newton-Raphson diverge ou converge vers un résultat faux sans le
 *   signaler. On avertit en dev et on clampe pour rester stable plutôt que de renvoyer une
 *   position silencieusement erronée. Une hyperbole passe par `solveHyperbolicKepler`
 *   (`keplerianPositionEcliptic` aiguille selon e).
 */
export function solveKepler(meanAnomaly: number, eccentricity: number): number {
  if (eccentricity >= 1 || eccentricity < 0) {
    if (import.meta.env?.DEV) {
      console.warn(
        `[kepler] eccentricity ${eccentricity} is outside the elliptical range [0, 1) — clamping. ` +
          'Use solveHyperbolicKepler for e > 1; parabolic orbits (e = 1) are not supported.'
      );
    }
    eccentricity = Math.min(Math.max(eccentricity, 0), 0.999);
  }
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
 * Résout l'équation de Kepler HYPERBOLIQUE `M = e·sinh(F) − F` pour l'anomalie hyperbolique
 * F (rad), par Newton-Raphson.
 *
 * Deux différences avec la forme elliptique, et chacune est un piège si on la recopie :
 *   - M n'est pas un angle. Une trajectoire ouverte ne repasse jamais au même point, donc on
 *     ne la réduit surtout pas modulo 2π (3I/ATLAS : M = 818° à son époque Horizons) ;
 *   - F croît comme ln(M) : la graine M + e·sin(M) de l'ellipse n'a plus de sens. On part de
 *     F₀ = signe(M)·ln(2|M|/e + 1,8) (Danby 1988), qui suit ce logarithme aux grands |M| et
 *     vaut 0 en M = 0.
 *
 * Convergence garantie : f(F) = e·sinh F − F − M est convexe pour F > 0 (f'' = e·sinh F) et
 * impaire en (F, M), donc Newton converge de manière monotone après au plus un dépassement.
 *
 * @param meanAnomaly  anomalie moyenne hyperbolique M (rad), non bornée
 * @param eccentricity excentricité e > 1 — sinon RangeError : il n'existe aucune valeur
 *   « proche » à renvoyer, et une position fausse silencieuse est le pire résultat possible.
 */
export function solveHyperbolicKepler(
  meanAnomaly: number,
  eccentricity: number
): number {
  if (!(eccentricity > 1)) {
    throw new RangeError(
      `[kepler] hyperbolic solver needs e > 1, got ${eccentricity}`
    );
  }
  const m = meanAnomaly;
  let f = Math.sign(m) * Math.log((2 * Math.abs(m)) / eccentricity + 1.8);
  for (let i = 0; i < 50; i++) {
    const residual = eccentricity * Math.sinh(f) - f - m;
    const slope = eccentricity * Math.cosh(f) - 1;
    const delta = residual / slope;
    f -= delta;
    if (Math.abs(delta) <= 1e-12 * Math.max(1, Math.abs(f))) break;
  }
  return f;
}

/**
 * Mouvement moyen (rad/jour) : période explicite, sinon 3ᵉ loi de Kepler autour du Soleil,
 * ou du Soleil augmenté des planètes pour des éléments barycentriques.
 */
function meanMotion(el: OrbitalElements): number {
  if (el.periodDays && el.periodDays > 0) return (2 * Math.PI) / el.periodDays;
  const a = Math.abs(el.semiMajorAxisAU);
  const k = el.barycentric
    ? GAUSS_K * Math.sqrt(1 + PLANETS_TO_SUN_MASS_RATIO)
    : GAUSS_K;
  return k / Math.sqrt(a * a * a);
}

/** Anomalie moyenne à une date (rad), non réduite. */
function meanAnomalyAt(el: OrbitalElements, date: Date): number {
  return (
    el.meanAnomalyAtEpochRad + meanMotion(el) * daysBetween(date, el.epoch)
  );
}

/**
 * Position dans le plan orbital (repère périfocal : X vers le périhélie, Y à 90° dans le sens
 * du mouvement) pour une anomalie hyperbolique F. |a| porte la géométrie, quel que soit le
 * signe de la convention : r = |a|·(e·cosh F − 1), qui vaut bien q = |a|·(e − 1) en F = 0.
 */
function hyperbolicPerifocal(
  el: OrbitalElements,
  f: number
): { xOrb: number; yOrb: number } {
  const a = Math.abs(el.semiMajorAxisAU);
  const e = el.eccentricity;
  return {
    xOrb: a * (e - Math.cosh(f)),
    yOrb: a * Math.sqrt(e * e - 1) * Math.sinh(f),
  };
}

/**
 * Position héliocentrique écliptique J2000 (UA) d'un corps à une date donnée, à partir de
 * ses éléments orbitaux. Retourne un triplet `{ x, y, z }` (x vers l'équinoxe vernal,
 * z vers le pôle nord écliptique) — passer à `frames.eclipticToScene` pour le repère Three.js.
 * Aiguille sur la forme hyperbolique dès que e > 1.
 */
export function keplerianPositionEcliptic(
  el: OrbitalElements,
  date: Date
): { x: number; y: number; z: number } {
  const a = el.semiMajorAxisAU;
  const e = el.eccentricity;

  // Anomalie moyenne à la date. La période explicite prime : la loi de Gauss suppose le
  // Soleil au foyer (cf. `periodDays`).
  const M = meanAnomalyAt(el, date);

  if (e > 1) {
    const { xOrb, yOrb } = hyperbolicPerifocal(el, solveHyperbolicKepler(M, e));
    return perifocalToEcliptic(el, xOrb, yOrb);
  }

  const E = solveKepler(M, e);

  // Position dans le plan orbital (périfocal) : X vers le périhélie, Y à 90° dans le sens direct.
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const xOrb = a * (cosE - e);
  const yOrb = a * Math.sqrt(1 - e * e) * sinE;
  return perifocalToEcliptic(el, xOrb, yOrb);
}

/**
 * Date du passage au périhélie d'une trajectoire hyperbolique (M = 0). Dérivée des éléments
 * plutôt que stockée à côté : une seule source, donc pas deux valeurs qui pourraient diverger.
 */
export function hyperbolicPerihelionDate(el: OrbitalElements): Date {
  const days = -el.meanAnomalyAtEpochRad / meanMotion(el);
  return new Date(el.epoch.getTime() + days * MS_PER_DAY);
}

/**
 * Points d'une trajectoire hyperbolique entre deux dates, pour tracer sa ligne.
 *
 * Une trajectoire ouverte n'a pas de période : il n'y a pas de « tour complet » à tracer, et
 * la ligne doit être bornée par une fenêtre. Dans cette fenêtre, les points sont répartis
 * uniformément en ANOMALIE HYPERBOLIQUE F, pas dans le temps. C'est le même défaut que celui
 * de Halley (cf. `OrbitPathBuilder.orbitSampleDate`), en pire. Mesuré sur ±20 ans, 512 points :
 * en temps uniforme, 1I/ʻOumuamua franchit 178,5° entre deux points consécutifs et la ligne ne
 * descend jamais sous 2,17 × q — tout le virage du périhélie tient dans UNE corde droite (3I :
 * 45°, 2I : 21°). En F uniforme : 3,7° au pire, et 1,0003 × q. La longueur d'arc
 * |d(pos)/dF| = |a|·√(e²·cosh²F − 1) ne varie plus que comme la distance elle-même.
 *
 * `count` ≥ 2 points, extrémités incluses. Aucun point n'est projeté hors de la fenêtre.
 */
export function sampleHyperbolicTrajectory(
  el: OrbitalElements,
  from: Date,
  to: Date,
  count: number
): { x: number; y: number; z: number }[] {
  const e = el.eccentricity;
  const fFrom = solveHyperbolicKepler(meanAnomalyAt(el, from), e);
  const fTo = solveHyperbolicKepler(meanAnomalyAt(el, to), e);
  const points: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const f = fFrom + ((fTo - fFrom) * i) / (count - 1);
    const { xOrb, yOrb } = hyperbolicPerifocal(el, f);
    points.push(perifocalToEcliptic(el, xOrb, yOrb));
  }
  return points;
}

/** Rotation périfocal → écliptique : R_z(Ω) · R_x(i) · R_z(ω). */
function perifocalToEcliptic(
  el: OrbitalElements,
  xOrb: number,
  yOrb: number
): { x: number; y: number; z: number } {
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
