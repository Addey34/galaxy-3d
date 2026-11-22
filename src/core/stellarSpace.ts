/**
 * L'ESPACE STELLAIRE : où sont VRAIMENT les étoiles voisines autour du Soleil, en parsecs. Pur, sans
 * DOM ni Three.js.
 *
 * C'est un espace À PART de la scène solaire : aucune de ses unités ne passe par `ScaleService`
 * (1 UA = 35 unités de scène en Exploration). **1 unité de l'espace stellaire = 1 parsec**, et rien
 * d'autre : aucun facteur d'affichage, aucune compression de distance. Le Soleil est à l'origine.
 *
 * RÉFÉRENTIEL. Les positions publiées sont équatoriales ICRS/J2000 (ascension droite, déclinaison,
 * distance). Elles sont tournées dans le repère GALACTIQUE (IAU 1958, matrice d'Hipparcos déjà
 * utilisée par `core/galactic.ts`, mesurée contre le fond de ciel) : x vers le centre galactique,
 * y dans le sens de la rotation de la Galaxie, z vers le pôle galactique nord. Le plan galactique est
 * donc horizontal, ce qui rend lisible un volume où le Soleil est dans le disque. Pour Three.js
 * (Y vers le haut, repère direct) : X = x, Y = z, Z = −y.
 *
 * MOUVEMENT. Chaque étoile a un mouvement RECTILIGNE UNIFORME : position J2000 + vitesse × durée,
 * la vitesse venant du mouvement propre (mas/an, déjà multiplié par cos δ pour l'ascension droite),
 * de la distance et de la vitesse radiale publiées. Sans vitesse radiale publiée (HYG seul), la
 * composante le long de la ligne de visée est NULLE, ce que la fiche dit. La distance est prise
 * telle quelle à J2000 (Gaia la date de 2016 : 16 ans de vitesse radiale, au plus 0,0004 pc).
 *
 * LA FENÊTRE DE TEMPS EST BORNÉE à ±`STELLAR_MOTION_LIMIT_YEARS` autour de J2000 : sur 10 000 ans,
 * Barnard (la plus rapide, ~142 km/s) parcourt environ 1,5 pc, soit un tiers du volume. Au-delà, le
 * potentiel galactique, les orbites des doubles et surtout l'incertitude sur les vitesses radiales
 * manquantes dominent ; ce n'est plus une prévision mais un tracé.
 */
import { EQUATORIAL_TO_GALACTIC } from './galactic';
import { LIGHT_YEARS_PER_PARSEC } from './exoplanets';
import type { NeighbourRow } from './neighbours';

/** 1 unité de l'espace stellaire en parsecs : le seul facteur d'échelle, et il vaut 1. */
export const PARSECS_PER_UNIT = 1;
/** Durée maximale de part et d'autre de J2000 pour laquelle la position est présentée (ans). */
export const STELLAR_MOTION_LIMIT_YEARS = 10_000;

const RAD = Math.PI / 180;
/** 1 mas en radians. */
const MAS_TO_RAD = RAD / 3_600_000;
/** 1 km/s en parsecs par an : 31 557 600 s / 3,0856775814913673e13 km. */
const KMS_TO_PC_PER_YEAR = 31_557_600 / 3.085677581491367e13;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const YEAR_MS = 365.25 * 86_400_000;

export type Vec3 = [number, number, number];

/** Années depuis J2000,0 (365,25 jours) : la même définition que `core/starCatalogue`. */
export const yearsFromJ2000 = (date: Date): number =>
  (date.getTime() - J2000_MS) / YEAR_MS;

/** Ramène une durée à la fenêtre où le mouvement rectiligne est présenté. */
export function clampMotionYears(years: number): number {
  return Math.max(
    -STELLAR_MOTION_LIMIT_YEARS,
    Math.min(STELLAR_MOTION_LIMIT_YEARS, years)
  );
}

/** Équatorial J2000 (x, y, z) → galactique (x, y, z). */
export function equatorialToGalactic(v: Readonly<Vec3>): Vec3 {
  const m = EQUATORIAL_TO_GALACTIC;
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

/** Galactique (x, y, z) → repère de Three.js (Y vers le haut, direct) : X = x, Y = z, Z = −y. */
export function galacticToScene(v: Readonly<Vec3>): Vec3 {
  return [v[0], v[2], -v[1]];
}

/**
 * Position équatoriale (parsecs) de l'étoile `years` ans après J2000. `years` est borné à la fenêtre
 * de `STELLAR_MOTION_LIMIT_YEARS`.
 */
export function equatorialPosition(row: NeighbourRow, years: number): Vec3 {
  const t = clampMotionYears(years);
  const ra = row[3] * RAD;
  const dec = row[4] * RAD;
  const d = row[5] * PARSECS_PER_UNIT;
  const cosDec = Math.cos(dec);
  const sinDec = Math.sin(dec);
  const cosRa = Math.cos(ra);
  const sinRa = Math.sin(ra);
  // Base locale : radial, vers l'est (ascension droite croissante), vers le nord.
  const er: Vec3 = [cosDec * cosRa, cosDec * sinRa, sinDec];
  const ea: Vec3 = [-sinRa, cosRa, 0];
  const ed: Vec3 = [-sinDec * cosRa, -sinDec * sinRa, cosDec];
  // Vitesses en parsecs par an : mouvement propre (rad/an) × distance (pc), vitesse radiale en km/s.
  const va = row[8] * MAS_TO_RAD * d;
  const vd = row[9] * MAS_TO_RAD * d;
  const vr = (row[10] ?? 0) * KMS_TO_PC_PER_YEAR;
  return [
    d * er[0] + t * (va * ea[0] + vd * ed[0] + vr * er[0]),
    d * er[1] + t * (va * ea[1] + vd * ed[1] + vr * er[1]),
    d * er[2] + t * (va * ea[2] + vd * ed[2] + vr * er[2]),
  ];
}

/** Position GALACTIQUE (parsecs) de l'étoile `years` ans après J2000. */
export function galacticPosition(row: NeighbourRow, years: number): Vec3 {
  return equatorialToGalactic(equatorialPosition(row, years));
}

/** Position dans le repère de la scène stellaire (parsecs, Y vers le pôle galactique nord). */
export function stellarScenePosition(row: NeighbourRow, years: number): Vec3 {
  return galacticToScene(galacticPosition(row, years));
}

/** Distance au Soleil (parsecs) d'un point de l'espace stellaire : le Soleil est à l'origine. */
export function distanceFromSunPc(p: Readonly<Vec3>): number {
  return Math.hypot(p[0], p[1], p[2]);
}

/** Distance entre deux points de l'espace stellaire, en parsecs. */
export function separationPc(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export const parsecsToLightYears = (pc: number): number =>
  pc * LIGHT_YEARS_PER_PARSEC;

/** Rayons (parsecs) des cercles d'échelle dans le plan galactique : un par parsec jusqu'au plus lointain. */
export function scaleRingsPc(farthestPc: number): number[] {
  const n = Math.max(1, Math.ceil(farthestPc - 1e-9));
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** Direction (unitaire, repère de la scène stellaire) du centre galactique : l'axe +X par définition. */
export const GALACTIC_CENTRE_DIRECTION: Readonly<Vec3> = [1, 0, 0];

/** Vitesse spatiale totale (km/s) d'une étoile : tangentielle 4,74047·μ·d et radiale (0 si non publiée). */
export function spaceSpeedKms(row: NeighbourRow): {
  tangential: number;
  radial: number | null;
} {
  const mu = Math.hypot(row[8], row[9]) / 1000;
  return { tangential: 4.74047 * mu * row[5], radial: row[10] };
}
