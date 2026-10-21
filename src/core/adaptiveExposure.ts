/**
 * EXPOSITION ADAPTATIVE AU CORPS SUIVI (lot 65, 2026-10-21) : la même chose qu'un appareil photo
 * qui pose pour son sujet.
 *
 * Le constat, MESURÉ sur le vrai GPU : au réglage par défaut, la Lune s'affichait à une valeur
 * médiane de 57 sur 255 et Mercure à 61, contre 103 pour Mars et 139 pour Encelade. Le rapport
 * entre corps est juste (`core/displayAlbedo.ts` l'impose depuis l'albédo publié) ; c'est
 * l'ÉCHELLE absolue qui rendait un sujet sombre aussi sombre qu'il l'est, sans l'adaptation de
 * l'œil ni d'un appareil, qui font paraître la Lune blanche dans un ciel noir. La Lune a un
 * albédo géométrique de 0,12, celui d'un asphalte usé.
 *
 * La règle : quand le corps suivi est plus sombre que l'albédo de référence, l'exposition monte
 * dans le rapport, bornée. Un corps plus clair n'est JAMAIS assombri, et rien ne change sans
 * corps suivi : la vue d'ensemble garde l'exposition de l'utilisateur. Le même facteur vaut
 * pour toute la scène, donc les rapports entre corps d'un même champ sont conservés.
 */

/** Albédo géométrique à partir duquel l'exposition ne bouge plus (Mars, 0,25, est déjà clair). */
export const ADAPTATION_REFERENCE_ALBEDO = 0.3;

/** Plus grand facteur : au-delà, l'image devient plate sans que le sujet gagne en lisibilité. */
export const MAX_ADAPTATION = 2.5;

/** Constante de temps de la transition, en secondes : une visée change, l'œil s'adapte. */
export const ADAPTATION_TIME_CONSTANT_S = 0.6;

/**
 * Facteur d'exposition pour un corps d'albédo publié donné. `undefined` ou non positif : 1,
 * c'est-à-dire un corps hors de la règle d'albédo (atmosphère, étoile), qui garde sa luminosité.
 */
export function adaptiveExposureFor(albedo: number | undefined): number {
  if (albedo === undefined || !(albedo > 0)) return 1;
  return Math.min(
    MAX_ADAPTATION,
    Math.max(1, ADAPTATION_REFERENCE_ALBEDO / albedo)
  );
}

/**
 * Un pas de la transition vers la cible, exponentiel et indépendant de la cadence d'images :
 * 63 % du chemin en une constante de temps, que l'on tourne à 30 ou à 144 images par seconde.
 */
export function stepAdaptation(
  current: number,
  target: number,
  deltaSeconds: number
): number {
  if (!(deltaSeconds > 0)) return current;
  const k = 1 - Math.exp(-deltaSeconds / ADAPTATION_TIME_CONSTANT_S);
  return current + (target - current) * k;
}
