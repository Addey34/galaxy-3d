/**
 * LE CHANGEMENT D'ÉCHELLE entre le Système solaire (l'unité est l'unité astronomique) et le voisinage
 * solaire (l'unité est le parsec). Pur, sans DOM ni Three.js.
 *
 * CE QUE C'EST, ET CE QUE CE N'EST PAS. Le Soleil est l'origine des deux scènes. La vue stellaire
 * garde donc UN SEUL repère métrique (galactique, 1 unité = 1 parsec) et la transition y est un recul
 * de la caméra : sa distance au Soleil passe de quelques dizaines d'UA à quelques parsecs, selon une
 * progression GÉOMÉTRIQUE (même rapport de distances à chaque instant), parce que l'échelle couvre plus de quatre
 * ordres de grandeur. Chaque image montre un champ de vue mesurable (sa largeur en UA ou en années-
 * lumière). Ce n'est PAS un voyage : aucune vitesse n'y est associée, et la scène solaire n'est jamais
 * interpolée avec la scène stellaire (elles ne partagent ni unité ni contenu).
 */
import { LIGHT_YEARS_PER_PARSEC } from './exoplanets';
import type { Vec3 } from './stellarSpace';

/** Unités astronomiques dans un parsec : 648 000 / π (définition IAU 2015 B2, exacte). */
export const AU_PER_PARSEC = 648_000 / Math.PI;

/** Kilomètres dans une unité astronomique (IAU 2012 B2, exact : 149 597 870 700 m). */
export const KM_PER_AU = 149_597_870.7;

/** Distance de la caméra au Soleil au début de la transition : environ 70 UA. */
export const START_DISTANCE_AU = 70;

/** Durée de la transition (ms) : courte, elle explique l'échelle sans décorer. */
export const TRANSITION_MS = 2600;

/** Sous cette largeur de champ (pc), la lecture est en UA ; au-dessus, en années-lumière. */
export const FIELD_AU_LIMIT_PC = 0.05;

/** Cercles de repère de l'écliptique, en UA (une décade chacun). */
export const ECLIPTIC_RINGS_AU: readonly number[] = [
  1, 10, 100, 1_000, 10_000, 100_000,
];

export const auToParsecs = (au: number): number => au / AU_PER_PARSEC;
export const parsecsToAu = (pc: number): number => pc * AU_PER_PARSEC;

/** Largeur (pc) du champ de vue à la distance de la cible : 2 d tan(fov / 2) × aspect. */
export function fieldWidthPc(
  distancePc: number,
  fovDeg: number,
  aspect: number
): number {
  return 2 * distancePc * Math.tan((fovDeg * Math.PI) / 360) * aspect;
}

/** Progression 0..1 de la transition, bornée. */
export function transitionProgress(elapsedMs: number): number {
  return Math.min(1, Math.max(0, elapsedMs / TRANSITION_MS));
}

/** Adoucit le départ et l'arrivée (cubique) : la caméra ne démarre ni ne s'arrête brutalement. */
export function easeInOut(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/**
 * Distance de la caméra (pc) à la progression `p`. Interpolation géométrique entre `startPc` et
 * `endPc` : `start × (end / start)^ease(p)`. Les extrémités sont exactes.
 */
export function transitionDistancePc(
  p: number,
  startPc: number,
  endPc: number
): number {
  if (p <= 0) return startPc;
  if (p >= 1) return endPc;
  return startPc * Math.pow(endPc / startPc, easeInOut(p));
}

export type FieldReading =
  { unit: 'au'; au: number } | { unit: 'ly'; ly: number; pc: number };

/** Largeur du champ dans l'unité qui se lit : UA dans le Système solaire, années-lumière au-delà. */
export function readField(widthPc: number): FieldReading {
  return widthPc < FIELD_AU_LIMIT_PC
    ? { unit: 'au', au: parsecsToAu(widthPc) }
    : { unit: 'ly', ly: widthPc * LIGHT_YEARS_PER_PARSEC, pc: widthPc };
}

const OPENING_DIRECTION: Vec3 = (() => {
  const v: Vec3 = [0.72, 0.5, 0.62];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
})();

/** Élévation d'ouverture (au-dessus du plan galactique) : assez haute pour lire les cercles en ellipses. */
export const OPENING_ELEVATION_RAD = Math.asin(OPENING_DIRECTION[1]);

/**
 * Direction (unitaire, repère de la scène stellaire) de la caméra par rapport au Soleil à l'arrivée.
 * `gaze` est le regard de la caméra solaire (scène solaire, vers sa cible) : on en garde le CAP, c'est-
 * à-dire l'azimut autour de l'axe galactique, de sorte que l'on regarde du même côté du ciel qu'avant.
 * L'élévation reste celle d'ouverture (un regard rasant le plan galactique rendrait les cercles
 * illisibles) et le roulis n'est pas conservé : le haut de l'écran est le nord galactique. Sans regard
 * (ou regard le long de l'axe, cap indéfini) : la direction d'ouverture.
 */
export function homeDirection(gaze: Vec3 | null): Vec3 {
  if (!gaze) return OPENING_DIRECTION;
  // La caméra est à l'opposé du regard : elle regarde le Soleil.
  const x = -gaze[0];
  const z = -gaze[2];
  const horizontal = Math.hypot(x, z);
  if (!(horizontal >= 1e-6)) return OPENING_DIRECTION;
  const c = Math.cos(OPENING_ELEVATION_RAD);
  return [
    (x / horizontal) * c,
    Math.sin(OPENING_ELEVATION_RAD),
    (z / horizontal) * c,
  ];
}
