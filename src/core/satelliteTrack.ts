/**
 * LE SUIVI D'UN SATELLITE (GAL-SATELLITE-TRACKING-001) : les règles pures de ce que la caméra suit et de
 * ce que la couche trace. Rien ici ne touche au DOM ni à Three.js : la propagation reste celle de SGP4
 * (`satellite.js`, dans `ui/satelliteLayer`), ce module décide seulement QUAND et SUR QUELS INSTANTS.
 *
 * Honnêteté, dite sur la fiche : la trace est l'orbite que SGP4 CALCULE à partir des éléments moyens de
 * CelesTrak, sur UNE période à partir de la date de la scène. Ce n'est pas une trajectoire mesurée, et
 * AUCUN passé n'est tracé : une orbite passée ne serait que le même calcul rejoué en arrière, et
 * rien dans le fichier ne la garantit.
 */
import { withinValidity } from './satellites';

/** Points de la trace sur une période : assez pour qu'une ellipse de 90 minutes reste lisse à l'écran. */
export const PATH_SAMPLES = 120;

/**
 * La trace est recalculée quand la date de la scène s'éloigne de plus de cette part de période de celle où
 * elle a été calculée. À vitesse réelle : toutes les ~60 s pour une période de 93 minutes ; à vitesse
 * accélérée : à chaque image, ce qui reste un seul objet et 120 propagations.
 */
export const PATH_REFRESH_FRACTION = 1 / 90;

export interface PathPlan {
  /** Les instants (ms UTC) à propager, du plus proche au plus lointain, tous DANS la validité des éléments. */
  times: number[];
  /** La fenêtre de validité coupe la trace avant la fin de la période. */
  truncated: boolean;
}

/**
 * Les instants de la trace : de `nowMs` à `nowMs + periodMs`, `PATH_SAMPLES` points, en ne gardant que ceux
 * dont les éléments valent encore. Hors validité à `nowMs` même : aucun point (jamais une position périmée).
 */
export function pathSampleTimes(
  nowMs: number,
  periodMs: number,
  epochMillis: number
): PathPlan {
  if (!(periodMs > 0) || !withinValidity(epochMillis, nowMs))
    return { times: [], truncated: false };
  const times: number[] = [];
  let truncated = false;
  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const at = nowMs + (i / PATH_SAMPLES) * periodMs;
    if (!withinValidity(epochMillis, at)) {
      truncated = true;
      break;
    }
    times.push(at);
  }
  return { times, truncated };
}

/** La trace calculée à `computedAtMs` ne dit plus assez la position : la date a trop bougé (ou reculé). */
export function pathIsStale(
  computedAtMs: number | null,
  nowMs: number,
  periodMs: number
): boolean {
  if (computedAtMs === null) return true;
  return Math.abs(nowMs - computedAtMs) > periodMs * PATH_REFRESH_FRACTION;
}

export type FollowVerdict =
  /** Le suivi continue : l'ancre est replacée à la position SGP4 de la date. */
  | 'continue'
  /** Les éléments ne valent plus à la date de la scène : le suivi s'arrête, aucune position périmée n'est gardée. */
  | 'stop-outside'
  /** SGP4 n'a plus de solution (orbite décrue) : même arrêt. */
  | 'stop-no-solution'
  /** Le visiteur a choisi un autre corps (palette, vue d'ensemble, visite) : le suivi n'a plus rien à faire. */
  | 'stop-retargeted'
  /** L'objet a disparu du fichier. */
  | 'stop-missing';

export interface FollowState {
  /** L'objet existe dans le fichier. */
  present: boolean;
  /** Les éléments valent à la date de la scène. */
  valid: boolean;
  /** SGP4 a rendu une position. */
  solved: boolean;
  /** Le nom de la cible de la caméra à cet instant. */
  cameraTarget: string | null;
  /** Le nom de l'ancre de suivi. */
  anchor: string;
}

/** La décision, à chaque image, de continuer ou non à suivre. Ordre : ce que le VISITEUR a fait passe avant ce que le calcul dit. */
export function followVerdict(state: FollowState): FollowVerdict {
  if (state.cameraTarget !== state.anchor) return 'stop-retargeted';
  if (!state.present) return 'stop-missing';
  if (!state.valid) return 'stop-outside';
  if (!state.solved) return 'stop-no-solution';
  return 'continue';
}
