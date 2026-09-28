/**
 * Modèle de rotation de l'UAI : d'un pôle PUBLIÉ à une obliquité.
 *
 * L'obliquité affichée d'un corps est l'angle entre son moment cinétique de rotation et la
 * normale de son orbite. Les fiches NSSDCA la publient pour les neuf corps qu'elles décrivent,
 * et pour eux seuls : aucune table d'agence ne publie l'obliquité d'un satellite. Ce qui EST
 * publié pour un satellite, c'est son pôle de rotation, dans le rapport du groupe de travail de
 * l'UAI sur les coordonnées cartographiques et les éléments de rotation, que NASA NAIF livre
 * sous forme lisible par une machine (`pck00011.tpc`). L'obliquité s'en DÉRIVE, exactement comme
 * elle se dérive déjà du pôle SBDB pour un astéroïde.
 *
 * Trois pièges, tous payés en écrivant ce module, et tous vérifiés par `iauPole.test.ts` qui
 * confronte les neuf planètes à l'obliquité que leur fiche NSSDCA publie :
 *
 *   1. le pôle n'est pas une constante. Le modèle est un polynôme du temps PLUS une somme de
 *      termes trigonométriques dont les arguments sont eux-mêmes des polynômes. Pour la Lune, le
 *      premier de ces termes vaut à lui seul 3,2° : l'ignorer ne donne pas un pôle approché, il
 *      donne un autre pôle ;
 *   2. les arguments de ces termes sont LINÉAIRES pour la plupart des systèmes et QUADRATIQUES
 *      pour celui de Mars. Les lire comme des couples quand ce sont des triplets déplaçait le
 *      pôle de Mars de 3° en déclinaison et donnait 22,98° d'obliquité là où la NSSDCA en publie
 *      25,19 ; Deimos, dans la foulée, passait de 0,002° à 3,5°. C'est pourquoi l'instantané
 *      livre chaque argument comme un TABLEAU de coefficients, et non comme une liste à plat ;
 *   3. le pôle nord de l'UAI n'est pas la direction du moment cinétique. Pour un corps en
 *      rotation rétrograde (Vénus, Uranus, Triton, les lunes d'Uranus), le corps tourne dans le
 *      sens horaire autour de ce pôle, et c'est son ANTIPODE qui porte le moment cinétique. Le
 *      signe se lit dans la vitesse du méridien d'origine (`W1`), jamais deviné : sans lui,
 *      Uranus rend 82,23° d'obliquité au lieu de 97,77, et Triton 179,5° au lieu de 0,5.
 *
 * Module PUR : ni DOM, ni Three.js, ni état. Seule la constante d'obliquité J2000 est importée,
 * pour que ce repère-ci soit le même que celui de toute la scène.
 */
import { OBLIQUITY_RAD } from './frames';

const DEG_TO_RAD = Math.PI / 180;

/** Vecteur unitaire, dans le repère où on l'a construit (équatorial ou écliptique). */
export type Vec3 = readonly [number, number, number];

/**
 * Un argument trigonométrique du modèle : ses coefficients, du degré 0 vers le haut, en degrés
 * puis degrés par siècle julien, puis degrés par siècle carré. Le tableau porte sa longueur,
 * donc son degré : c'est ce qui distingue le système de Mars des autres.
 */
export type NutationAngle = readonly number[];

/** Les arguments d'un système planétaire, dans l'ordre où le noyau les déclare. */
export type NutationAngles = readonly NutationAngle[];

/** Ce qu'un noyau PCK publie de la rotation d'un corps, tel quel. */
export interface IauRotationModel {
  /** α₀ et ses dérivées, en degrés et degrés par siècle julien. */
  readonly poleRaDeg: readonly number[];
  /** δ₀ et ses dérivées, en degrés et degrés par siècle julien. */
  readonly poleDecDeg: readonly number[];
  /** Amplitudes des sinus ajoutés à α₀, appariées aux arguments du système par leur rang. */
  readonly nutPrecRa?: readonly number[];
  /** Amplitudes des cosinus ajoutés à δ₀, appariées de la même façon. */
  readonly nutPrecDec?: readonly number[];
  /** W₁, vitesse du méridien d'origine en degrés par jour. Son SIGNE porte le sens de rotation. */
  readonly pmRateDegPerDay: number;
}

/** Époque J2000.0 en jour julien ; l'origine du temps de tous les polynômes ci-dessous. */
export const J2000_JD = 2451545;

/** Siècles juliens écoulés depuis J2000.0, la variable de tous les polynômes du modèle. */
export function centuriesFromJ2000(date: Date): number {
  const jd = date.getTime() / 86_400_000 + 2440587.5;
  return (jd - J2000_JD) / 36525;
}

/** Polynôme en `t`, coefficients du degré 0 vers le haut. */
export function polynomial(coefficients: readonly number[], t: number): number {
  let value = 0;
  for (let k = coefficients.length - 1; k >= 0; k--)
    value = value * t + coefficients[k];
  return value;
}

/**
 * Pôle nord de l'UAI à l'instant `t` (siècles juliens depuis J2000), en degrés.
 *
 * Une amplitude sans argument correspondant est une erreur de relevé, pas un terme nul : le
 * modèle a été lu de travers, et le pôle rendu serait faux sans que rien ne le dise.
 */
export function iauPoleDeg(
  model: IauRotationModel,
  angles: NutationAngles,
  t: number
): { raDeg: number; decDeg: number } {
  let ra = polynomial(model.poleRaDeg, t);
  let dec = polynomial(model.poleDecDeg, t);
  const theta = angles.map((angle) => polynomial(angle, t) * DEG_TO_RAD);
  const apply = (
    amplitudes: readonly number[] | undefined,
    trig: (x: number) => number,
    add: (value: number) => void
  ): void => {
    if (!amplitudes) return;
    if (amplitudes.length > theta.length)
      throw new Error(
        `modèle de rotation : ${amplitudes.length} amplitudes pour ${theta.length} arguments`
      );
    amplitudes.forEach((amplitude, k) => add(amplitude * trig(theta[k])));
  };
  apply(model.nutPrecRa, Math.sin, (v) => (ra += v));
  apply(model.nutPrecDec, Math.cos, (v) => (dec += v));
  return { raDeg: ra, decDeg: dec };
}

/** Direction unitaire d'une ascension droite et d'une déclinaison, dans leur propre repère. */
export function directionFromRaDec(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;
  return [
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  ];
}

/** Équatorial J2000 → écliptique J2000, la même obliquité que `frames.ts` (pure rotation). */
export function equatorialToEcliptic(v: Vec3): Vec3 {
  const cos = Math.cos(OBLIQUITY_RAD);
  const sin = Math.sin(OBLIQUITY_RAD);
  return [v[0], cos * v[1] + sin * v[2], -sin * v[1] + cos * v[2]];
}

/**
 * Direction du MOMENT CINÉTIQUE de rotation, en équatorial J2000 : le pôle de l'UAI pour un
 * corps prograde, son antipode pour un corps rétrograde (voir le piège 3 en tête de fichier).
 */
export function spinAngularMomentum(
  model: IauRotationModel,
  angles: NutationAngles,
  t: number
): Vec3 {
  const { raDeg, decDeg } = iauPoleDeg(model, angles, t);
  const pole = directionFromRaDec(raDeg, decDeg);
  return model.pmRateDegPerDay < 0 ? [-pole[0], -pole[1], -pole[2]] : pole;
}

/**
 * Normale d'une orbite décrite par son inclinaison et son nœud ascendant ÉCLIPTIQUES, orientée
 * par le moment cinétique : une inclinaison supérieure à 90° la fait pointer vers le sud, ce qui
 * est exactement ce qu'il faut pour un satellite rétrograde comme Triton.
 */
export function orbitNormalFromElements(
  inclinationRad: number,
  ascendingNodeRad: number
): Vec3 {
  const sin = Math.sin(inclinationRad);
  return [
    sin * Math.sin(ascendingNodeRad),
    -sin * Math.cos(ascendingNodeRad),
    Math.cos(inclinationRad),
  ];
}

/** Normale d'une orbite lue sur DEUX positions successives, sans passer par des éléments. */
export function orbitNormalFromPositions(a: Vec3, b: Vec3): Vec3 {
  const n: Vec3 = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const length = Math.hypot(n[0], n[1], n[2]);
  if (length === 0)
    throw new Error(
      'normale indéterminée : les deux positions sont colinéaires'
    );
  return [n[0] / length, n[1] / length, n[2] / length];
}

/** Angle entre deux directions unitaires, en radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}
