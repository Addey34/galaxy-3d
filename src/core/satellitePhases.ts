/**
 * PHASES OÙ UNE SONDE EST LE SATELLITE D'UN CORPS DU CATALOGUE.
 *
 * Le catalogue DÉCLARE le repère d'une lune (`frame: 'parentRelative'`), et c'est ce qui la
 * fait écarter de sa planète en Éducatif. Une sonde, elle, change de repère au cours de sa
 * mission : Juno est héliocentrique jusqu'à son insertion en orbite autour de Jupiter
 * (5 juillet 2016), puis satellite de Jupiter. Sans cette déclaration, la compression
 * héliocentrique √r la posait au centre de la sphère agrandie de sa planète (mesuré au
 * 2026-09-22 : Juno, JWST et BepiColombo dans Jupiter, la Terre et Mercure).
 *
 * Les phases ne sont PAS saisies : elles sont DÉRIVÉES des fichiers Horizons livrés, par
 * `deriveSatellitePhases`, puis écrites dans la fiche de la sonde (`satelliteOf`) et
 * confrontées à cette dérivation par un test. Critère : l'énergie à deux corps de la sonde
 * relativement au corps est négative ET la sonde est dans sa sphère de Hill. Pris jour par
 * jour, ce critère clignote (mesuré : le halo de JWST autour de L2 franchit la frontière deux
 * fois par an ; OSIRIS-REx, en vol stationnaire à quelques kilomètres de Bennu, n'y est
 * « liée » que par intermittence) : la phase va donc du PREMIER au DERNIER jour lié, et un
 * corps n'en reçoit une que si la sonde y a été liée au moins `SATELLITE_MIN_BOUND_DAYS`
 * jours au total. Ce seuil écarte un passage (Voyager 1 paraît liée deux jours à Jupiter
 * près du périjove, artefact de différence finie sur une vitesse qui varie vite), jamais une
 * mise en orbite (Juno : 12 ans, OSIRIS-REx : 17 mois).
 *
 * Un corps trop léger pour qu'une énergie à deux corps signifie quelque chose (Bennu : une
 * vitesse d'échappement de quatre centimètres par seconde à cinq kilomètres, sous le bruit
 * d'une différence finie) compte aussi les jours passés dans sa sphère de Hill, mais SEULEMENT
 * quand la règle des lunes pose toute cette sphère sur la surface agrandie
 * (`surfaceClampAU` ≥ rayon de Hill) : y entrer déplace alors l'objet d'au plus un rayon
 * Éducatif, sans l'écart décrit plus bas. Aucune planète ne remplit cette condition (Terre :
 * surface jusqu'à 153 000 km pour 1,5 million de km de sphère de Hill) ; Bennu et Ryugu, oui.
 *
 * Un survol reste donc héliocentrique, et peut traverser la sphère agrandie d'une planète
 * pendant quelques semaines : c'est la conséquence des tailles Éducatif, pas un repère faux.
 * L'étendre à un survol ferait jaillir l'objet à des dizaines d'unités de sa planète dès qu'il
 * entre dans la sphère de Hill (35 × 3,43 × √0,355 ≈ 49 unités pour Jupiter, soit l'orbite de
 * Saturne à l'écran), puis l'y ramener : pire que le défaut.
 */
import type * as THREE from 'three';
import { MU_SUN_AU3_PER_DAY2 } from './twoBodyPropagation';

/** Durée liée cumulée en deçà de laquelle un corps ne devient pas le repère d'une sonde. */
export const SATELLITE_MIN_BOUND_DAYS = 30;

/** Une phase : la sonde est le satellite de `body` de `fromMs` à `toMs` inclus. */
export interface SatellitePhase {
  body: string;
  fromMs: number;
  toMs: number;
}

/** Corps dont la phase couvre `date`, sinon `null`. Les phases ne se chevauchent pas. */
export function activeSatelliteBody(
  phases: readonly SatellitePhase[],
  date: Date
): string | null {
  const ms = date.getTime();
  for (const phase of phases)
    if (ms >= phase.fromMs && ms <= phase.toMs) return phase.body;
  return null;
}

/** Rayon de Hill (UA) d'un corps de paramètre `mu` à `distanceAU` du Soleil. */
export function hillRadiusAU(distanceAU: number, mu: number): number {
  return distanceAU * Math.cbrt(mu / (3 * MU_SUN_AU3_PER_DAY2));
}

/** Ce que la dérivation doit savoir d'un corps candidat. */
export interface PhaseCandidate {
  name: string;
  /** Paramètre gravitationnel, UA³/jour². */
  mu: number;
  /** Position héliocentrique (UA) à une date, `null` hors couverture. */
  position: (date: Date) => THREE.Vector3 | null;
  /**
   * Distance (UA) sous laquelle la règle des lunes pose un satellite sur la surface agrandie
   * du corps (`educationalSurfaceClampAU`). Cf. l'en-tête pour son usage.
   */
  surfaceClampAU: number;
}

const DAY_MS = 86_400_000;
/** Demi-pas de la différence centrée qui donne la vitesse relative (jours). */
const VELOCITY_HALF_STEP_DAYS = 0.25;

/**
 * Phases d'une sonde, jour par jour sur `[fromMs, toMs]`, pour chaque candidat. Cf. l'en-tête
 * du module pour le critère ; les bornes rendues sont des minuits UTC.
 */
export function deriveSatellitePhases(
  probe: (date: Date) => THREE.Vector3 | null,
  candidates: readonly PhaseCandidate[],
  fromMs: number,
  toMs: number
): SatellitePhase[] {
  const h = VELOCITY_HALF_STEP_DAYS * DAY_MS;
  const phases: SatellitePhase[] = [];
  const start = Math.ceil(fromMs / DAY_MS) * DAY_MS;
  for (const candidate of candidates) {
    let first: number | null = null;
    let last = 0;
    let boundDays = 0;
    for (let t = start; t <= toMs; t += DAY_MS) {
      const p = probe(new Date(t));
      const b = candidate.position(new Date(t));
      if (!p || !b) continue;
      const d = p.distanceTo(b);
      const hill = hillRadiusAU(b.length(), candidate.mu);
      if (!(d > 0) || d >= hill) continue;
      if (hill <= candidate.surfaceClampAU) {
        first ??= t;
        last = t;
        boundDays++;
        continue;
      }
      const pm = probe(new Date(t - h));
      const pp = probe(new Date(t + h));
      const bm = candidate.position(new Date(t - h));
      const bp = candidate.position(new Date(t + h));
      if (!pm || !pp || !bm || !bp) continue;
      const v = pp
        .sub(pm)
        .sub(bp.sub(bm))
        .divideScalar(2 * VELOCITY_HALF_STEP_DAYS);
      if (v.lengthSq() / 2 - candidate.mu / d >= 0) continue;
      first ??= t;
      last = t;
      boundDays++;
    }
    if (first !== null && boundDays >= SATELLITE_MIN_BOUND_DAYS)
      phases.push({ body: candidate.name, fromMs: first, toMs: last });
  }
  return phases.sort((a, b) => a.fromMs - b.fromMs);
}
