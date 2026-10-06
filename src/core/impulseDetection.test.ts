import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { propagateTwoBody } from './twoBodyPropagation';
import {
  decimateAroundImpulses,
  detectImpulses,
  twoBodyResiduals,
  type StateRow,
} from './impulseDetection';

const KM_PER_AU = 149_597_870.7;
// Mercure, UA³/jour², ordre de grandeur suffisant pour une orbite synthétique.
const MU = (22_031.87 * 86_400 ** 2) / KM_PER_AU ** 3;
const STEP = 10 / 1440;

/** Avance un état de `dt` jours le long de sa conique ; vitesse par différence finie. */
function advance(r: THREE.Vector3, v: THREE.Vector3, dt: number) {
  const next = propagateTwoBody(r, v, dt, MU, new THREE.Vector3())!;
  const later = propagateTwoBody(r, v, dt + 1e-6, MU, new THREE.Vector3())!;
  return { r: next, v: later.sub(next).divideScalar(1e-6) };
}

/** Une orbite circulaire à 4 000 km, avec un Δv tangentiel AU MILIEU de l'intervalle `kickIn`. */
function orbit(
  count: number,
  kickIn: number | null,
  dvKmS = 10e-3
): StateRow[] {
  const r0 = 4_000 / KM_PER_AU;
  let r = new THREE.Vector3(r0, 0, 0);
  let v = new THREE.Vector3(0, Math.sqrt(MU / r0), 0);
  const rows: StateRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      jd: 2_461_326.5 + i * STEP,
      state: [r.x, r.y, r.z, v.x, v.y, v.z],
    });
    if (i === kickIn) {
      const half = advance(r, v, STEP / 2);
      half.v.multiplyScalar(1 + (dvKmS * 86_400) / KM_PER_AU / half.v.length());
      ({ r, v } = advance(half.r, half.v, STEP / 2));
    } else ({ r, v } = advance(r, v, STEP));
  }
  return rows;
}

describe('les manœuvres lues dans la trajectoire', () => {
  it('une orbite sans poussée laisse un résidu sous le mètre', () => {
    const residuals = twoBodyResiduals(orbit(50, null), MU);
    expect(Math.max(...residuals)).toBeLessThan(1e-3);
  });

  it('trouve UNE poussée, dans son intervalle', () => {
    const rows = orbit(50, 20);
    const found = detectImpulses(rows, MU, 1);
    expect(found.impulses).toHaveLength(1);
    // Une poussée ponctuelle ne laisse de résidu que dans SON intervalle : les voisins
    // élargis pèsent zéro, et l'instant reste au milieu.
    expect(found.impulses[0]).toBeCloseTo((rows[20].jd + rows[21].jd) / 2, 6);
    expect(found.weakestImpulseKm).toBeGreaterThan(1);
    expect(found.backgroundMaxKm).toBeLessThan(1e-3);
  });

  it('se tait sous le seuil (falsification : un seuil au-dessus de la poussée la perd)', () => {
    const rows = orbit(50, 20);
    expect(detectImpulses(rows, MU, 1e6).impulses).toHaveLength(0);
  });

  it('décime en ancres et refuse ce que le service ne sait pas propager', () => {
    const rows = orbit(49, null);
    expect(decimateAroundImpulses(rows, 12, [])).toHaveLength(5);
    expect(() => decimateAroundImpulses(rows, 12, [rows[12].jd])).toThrow(
      /ancre/
    );
    expect(() =>
      decimateAroundImpulses(rows, 12, [rows[13].jd, rows[14].jd])
    ).toThrow(/une seule/);
    expect(() => decimateAroundImpulses(rows, 1.5, [])).toThrow(/entier/);
  });
});
