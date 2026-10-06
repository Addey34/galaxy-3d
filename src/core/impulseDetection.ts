import * as THREE from 'three';
import { propagateTwoBody } from './twoBodyPropagation';

/**
 * LES MANŒUVRES D'UNE SONDE, LUES DANS SA PROPRE TRAJECTOIRE (2026-10-06).
 *
 * Un segment de trajectoire en orbite (BepiColombo autour de Mercure) se livre en ancres
 * espacées et se reconstruit par propagation à deux corps. Une manœuvre casse ce modèle :
 * fondre l'ancre d'avant et celle d'après mélange deux orbites (mesuré : 3 118 km au pire au
 * pas de 12 h sur la descente de BepiColombo). Horizons ne liste pas les manœuvres d'une sonde
 * comme il nomme l'impact de DART dans son en-tête ; elles se LISENT en revanche dans un tirage
 * fin : sur un pas court, un état propagé à deux corps rejoint l'état suivant à quelques
 * dizaines de mètres, sauf à travers une poussée.
 *
 * Mesuré au pas de 10 min sur la phase de BepiColombo autour de Mercure (2026-10-13 au
 * 2027-04-09) : fond de 14 m en médiane et 104 m au plus (gravité du Soleil loin de Mercure,
 * aplatissement de Mercure près d'elle), seize épisodes de 6 562 à 10 487 m, durant 20 à
 * 40 min. Deux ordres de grandeur les séparent, et le seuil se place entre les deux.
 */

/** Un état d'Horizons : JD TDB, puis position (UA) et vitesse (UA/jour). */
export interface StateRow {
  jd: number;
  state: readonly number[];
}

/** Ce que la détection a trouvé, pour qu'un générateur le DISE plutôt que de le taire. */
export interface ImpulseDetection {
  /** Instant de chaque manœuvre (JD TDB) : le MILIEU de l'épisode, un saut ponctuel. */
  impulses: number[];
  /** Résidu médian et maximal hors manœuvre, en km : le fond qui fixe le seuil. */
  backgroundMedianKm: number;
  backgroundMaxKm: number;
  /** Résidu le plus faible parmi les épisodes retenus, en km. */
  weakestImpulseKm: number | null;
}

const KM_PER_AU = 149_597_870.7;

/**
 * Le résidu de chaque intervalle : distance entre l'état `i` propagé jusqu'à l'instant `i + 1`
 * sous la seule gravité `mu` (UA³/jour²), et l'état `i + 1` lui-même, en km.
 */
export function twoBodyResiduals(
  rows: readonly StateRow[],
  mu: number
): number[] {
  const r = new THREE.Vector3();
  const v = new THREE.Vector3();
  const out = new THREE.Vector3();
  const residuals: number[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const [x, y, z, vx, vy, vz] = rows[i].state;
    r.set(x, y, z);
    v.set(vx, vy, vz);
    const next = rows[i + 1].state;
    const p = propagateTwoBody(r, v, rows[i + 1].jd - rows[i].jd, mu, out);
    if (!p) throw new Error(`propagation impossible à l'état ${i}`);
    residuals.push(
      Math.hypot(p.x - next[0], p.y - next[1], p.z - next[2]) * KM_PER_AU
    );
  }
  return residuals;
}

/**
 * Les manœuvres : les épisodes d'intervalles CONSÉCUTIFS dont le résidu dépasse `thresholdKm`,
 * élargis d'un intervalle de chaque côté, chacun réduit à un instant.
 *
 * L'élargissement n'est pas une marge de confort : une poussée qui ne remplit qu'une partie
 * d'un intervalle laisse un résidu intermédiaire à ses BORDS (mesuré sur BepiColombo : jusqu'à
 * 940 m le 2027-02-16 à 14 h 29, juste avant un épisode de 10 km). Compté comme fond, il
 * approchait le seuil et rendait la détection arbitraire. L'instant est le barycentre des
 * milieux d'intervalles pondérés par leur résidu : il suit la poussée, bords compris.
 */
export function detectImpulses(
  rows: readonly StateRow[],
  mu: number,
  thresholdKm: number
): ImpulseDetection {
  const residuals = twoBodyResiduals(rows, mu);
  const inEpisode = new Array<boolean>(residuals.length).fill(false);
  const impulses: number[] = [];
  let weakest: number | null = null;
  for (let i = 0; i < residuals.length; i++) {
    if (residuals[i] <= thresholdKm) continue;
    let j = i;
    let peak = residuals[i];
    while (j + 1 < residuals.length && residuals[j + 1] > thresholdKm) {
      j++;
      peak = Math.max(peak, residuals[j]);
    }
    const from = Math.max(0, i - 1);
    const to = Math.min(residuals.length - 1, j + 1);
    let weight = 0;
    let moment = 0;
    for (let k = from; k <= to; k++) {
      inEpisode[k] = true;
      const middle = (rows[k].jd + rows[k + 1].jd) / 2;
      weight += residuals[k];
      moment += residuals[k] * middle;
    }
    impulses.push(moment / weight);
    weakest = weakest === null ? peak : Math.min(weakest, peak);
    i = j;
  }
  const background = residuals
    .filter((_, k) => !inEpisode[k])
    .sort((a, b) => a - b);
  return {
    impulses,
    backgroundMedianKm: background.length
      ? background[background.length >> 1]
      : 0,
    backgroundMaxKm: background.length ? background[background.length - 1] : 0,
    weakestImpulseKm: weakest,
  };
}

/**
 * Garde un état sur `every` : les ancres livrées. Refuse un instant de manœuvre posé sur une
 * ancre (il ne couperait aucun intervalle) ou deux manœuvres dans un même intervalle (le service
 * ne propage que d'un côté d'UN saut).
 */
export function decimateAroundImpulses(
  rows: readonly StateRow[],
  every: number,
  impulses: readonly number[]
): StateRow[] {
  if (!Number.isInteger(every) || every < 1)
    throw new Error(`décimation par ${every} : un entier positif est attendu`);
  const anchors = rows.filter((_, i) => i % every === 0);
  for (let k = 0; k + 1 < anchors.length; k++) {
    const inside = impulses.filter(
      (jd) => jd >= anchors[k].jd && jd <= anchors[k + 1].jd
    );
    if (inside.some((jd) => jd === anchors[k].jd || jd === anchors[k + 1].jd))
      throw new Error(`manœuvre posée sur une ancre (JD ${anchors[k].jd})`);
    if (inside.length > 1)
      throw new Error(
        `${inside.length} manœuvres entre les JD ${anchors[k].jd} et ${anchors[k + 1].jd} : une seule par intervalle`
      );
  }
  return anchors;
}
