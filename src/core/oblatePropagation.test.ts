import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { propagateOblate, type Oblateness } from './oblatePropagation';
import { gravitationalParameter, propagateTwoBody } from './twoBodyPropagation';

const KM = 1 / 1.495_978_707e8;
const DAY = 86_400;
/** Jupiter, ordres de grandeur seulement : ces tests portent sur la PHYSIQUE, pas sur la donnée. */
const MU = gravitationalParameter(1.898e27);
const R = 71_492 * KM;
const POLE = { x: 0, y: 0, z: 1 };

describe('propagateOblate', () => {
  it('rend la conique quand J2 est nul', () => {
    const ob: Oblateness = { j2: 0, radiusAU: R, pole: POLE };
    const position = new THREE.Vector3(400_000 * KM, 0, 50_000 * KM);
    const velocity = new THREE.Vector3(0, 20 * KM * DAY, 3 * KM * DAY);
    for (const dt of [0.1, -0.7, 3]) {
      const oblate = propagateOblate(position, velocity, dt, MU, ob)!;
      const conic = propagateTwoBody(position, velocity, dt, MU)!;
      expect(oblate.distanceTo(conic) / KM).toBeLessThan(0.5);
    }
  });

  it('revient à son point de départ après un aller-retour au ras de la planète', () => {
    const ob: Oblateness = { j2: 0.0147, radiusAU: R, pole: POLE };
    // Un périapse à 1,05 rayon, comme les périjoves de Juno.
    const position = new THREE.Vector3(1.05 * R, 0, 0.02 * R);
    const velocity = new THREE.Vector3(0, 58 * KM * DAY, 10 * KM * DAY);
    const step = 1e-6;
    const there = propagateOblate(position, velocity, 0.25, MU, ob)!;
    const v = propagateOblate(position, velocity, 0.25 + step, MU, ob)!
      .sub(propagateOblate(position, velocity, 0.25 - step, MU, ob)!)
      .divideScalar(2 * step);
    const back = propagateOblate(there, v, -0.25, MU, ob)!;
    expect(back.distanceTo(position) / KM).toBeLessThan(0.1);
  });

  /**
   * Témoin INDÉPENDANT : la régression secondaire des nœuds d'une orbite circulaire inclinée,
   * dΩ/dt = −(3/2) n J2 (R/a)² cos i, la loi analytique du premier ordre. Une accélération J2
   * de signe ou de facteur faux la manque d'un facteur entier.
   */
  it('fait régresser les nœuds au rythme de la loi analytique', () => {
    const j2 = 0.0147;
    const ob: Oblateness = { j2, radiusAU: R, pole: POLE };
    const a = 3 * R;
    const inc = (40 * Math.PI) / 180;
    const vCirc = Math.sqrt(MU / a);
    const position = new THREE.Vector3(a, 0, 0);
    const velocity = new THREE.Vector3(
      0,
      vCirc * Math.cos(inc),
      vCirc * Math.sin(inc)
    );
    const n = Math.sqrt(MU / (a * a * a));
    const period = (2 * Math.PI) / n;
    const span = 20 * period;
    // Moment cinétique en fin d'arc, par différence centrée.
    const step = period * 1e-5;
    const p = propagateOblate(position, velocity, span, MU, ob)!;
    const v = propagateOblate(position, velocity, span + step, MU, ob)!
      .sub(propagateOblate(position, velocity, span - step, MU, ob)!)
      .divideScalar(2 * step);
    const h = new THREE.Vector3().crossVectors(p, v);
    const node = Math.atan2(h.x, -h.y); // longitude du nœud ascendant
    const expected = -1.5 * n * j2 * (R / a) ** 2 * Math.cos(inc) * span;
    expect(node / expected).toBeGreaterThan(0.95);
    expect(node / expected).toBeLessThan(1.05);
  });

  it('refuse un μ nul plutôt que d’inventer une position', () => {
    const ob: Oblateness = { j2: 0.0147, radiusAU: R, pole: POLE };
    expect(
      propagateOblate(
        new THREE.Vector3(R * 2, 0, 0),
        new THREE.Vector3(),
        1,
        0,
        ob
      )
    ).toBeNull();
  });
});
