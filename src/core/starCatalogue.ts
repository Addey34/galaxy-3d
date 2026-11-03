/**
 * LES ÉTOILES DU CIEL RÉEL : position à une date, couleur, éclat. Pur, sans DOM ni Three.js.
 *
 * Le jeu (`public/assets/sky/stars.json`, `scripts/generate-star-catalogue.mjs`) donne, par
 * étoile, sa position J2000, sa distance, son mouvement propre et sa vitesse radiale. La position
 * à une autre date est un mouvement RECTILIGNE UNIFORME dans l'espace : position + vitesse × Δt,
 * puis on garde la direction. C'est exact pour un mouvement réellement rectiligne, et c'est une
 * approximation de plus en plus mauvaise avec le temps (potentiel galactique, étoiles doubles) :
 * Barnard dérive de 27,9° en 10 000 ans, mais ce n'est pas une prévision à cette échéance.
 * La MAGNITUDE reste celle d'aujourd'hui : l'éloignement ou le rapprochement change l'éclat d'une
 * étoile sur des millénaires, ce que ce modèle ne rend pas.
 */

/** Une étoile du jeu, dans l'ordre de `fields`. */
export type StarRow = readonly [
  raDeg: number,
  decDeg: number,
  mag: number,
  bv: number | null,
  distPc: number,
  pmRaMas: number,
  pmDecMas: number,
  rvKms: number,
  proper: string,
];

export interface StarCatalogueFile {
  source: {
    id: string;
    name: string;
    url: string;
    license: string;
    licenseUrl: string;
    rows: number;
    magnitudeLimit: number;
    retrieved: string;
  };
  fields: string[];
  count: number;
  stars: StarRow[];
}

const RAD = Math.PI / 180;
const MAS_TO_RAD = RAD / 3_600_000;
/** 1 km/s en parsecs par an : 31 557 600 s / 3,0856776e13 km. */
const KMS_TO_PC_PER_YEAR = 31_557_600 / 3.0856776e13;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const YEAR_MS = 365.25 * 86_400_000;

export const yearsSinceJ2000 = (date: Date): number =>
  (date.getTime() - J2000_MS) / YEAR_MS;

/**
 * Direction (vecteur unitaire équatorial J2000) d'une étoile `years` ans après J2000, écrite dans
 * `out` (3 nombres). La distance inconnue (100 000 pc) est traitée comme une distance : la
 * dérive angulaire reste le mouvement propre publié.
 */
export function starDirection(
  star: StarRow,
  years: number,
  out: Float64Array | number[]
): void {
  const a = star[0] * RAD;
  const d = star[1] * RAD;
  const dist = star[4];
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const sd = Math.sin(d);
  const cd = Math.cos(d);
  const vRa = dist * star[5] * MAS_TO_RAD; // pc/an, pmRa porte déjà cos δ
  const vDec = dist * star[6] * MAS_TO_RAD;
  const vRad = star[7] * KMS_TO_PC_PER_YEAR;
  const ux = cd * ca;
  const uy = cd * sa;
  const uz = sd;
  const px = ux * dist + years * (vRa * -sa + vDec * -sd * ca + vRad * ux);
  const py = uy * dist + years * (vRa * ca + vDec * -sd * sa + vRad * uy);
  const pz = uz * dist + years * (vDec * cd + vRad * uz);
  const n = Math.hypot(px, py, pz);
  out[0] = px / n;
  out[1] = py / n;
  out[2] = pz / n;
}

/**
 * Couleur d'une étoile d'après son indice B−V : température de Ballesteros (2012), puis le corps
 * noir en sRGB (ajustement de Tanner Helland). Sans indice, un blanc neutre.
 */
export function starColor(bv: number | null): [number, number, number] {
  if (bv === null) return [1, 1, 1];
  const b = Math.max(-0.4, Math.min(2, bv));
  const t = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  const k = t / 100;
  const r = k <= 66 ? 255 : 329.698727446 * (k - 60) ** -0.1332047592;
  const g =
    k <= 66
      ? 99.4708025861 * Math.log(k) - 161.1195681661
      : 288.1221695283 * (k - 60) ** -0.0755148492;
  const bl =
    k >= 66
      ? 255
      : k <= 19
        ? 0
        : 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  const c = (v: number) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(bl)];
}

/** Taille de point (px) et gain d'éclat d'une étoile de magnitude `mag`. */
export function starAppearance(mag: number): { size: number; gain: number } {
  const bright = 6.5 - mag; // 0 à la limite de l'œil nu
  return {
    size: Math.min(7, 1.7 + 0.5 * bright),
    gain: Math.min(1.7, 0.4 + 0.2 * bright),
  };
}
