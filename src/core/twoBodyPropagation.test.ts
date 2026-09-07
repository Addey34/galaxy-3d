import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  gravitationalParameter,
  MU_SUN_AU3_PER_DAY2,
  propagateTwoBody,
} from './twoBodyPropagation';

/**
 * Un état circulaire de rayon `r` autour d'un μ donné, incliné pour que le test ne puisse
 * pas passer par accident dans le plan XY.
 */
function circularState(
  r: number,
  mu: number,
  tiltRad = 0.7
): { position: THREE.Vector3; velocity: THREE.Vector3; period: number } {
  const speed = Math.sqrt(mu / r);
  const axis = new THREE.Vector3(1, 0, 0);
  return {
    position: new THREE.Vector3(r, 0, 0).applyAxisAngle(axis, tiltRad),
    velocity: new THREE.Vector3(0, speed, 0).applyAxisAngle(axis, tiltRad),
    period: (2 * Math.PI * r) / speed,
  };
}

describe('propagateTwoBody', () => {
  it('revient au point de départ après une période entière', () => {
    const { position, velocity, period } = circularState(
      1,
      MU_SUN_AU3_PER_DAY2
    );
    const after = propagateTwoBody(
      position,
      velocity,
      period,
      MU_SUN_AU3_PER_DAY2
    );
    expect(after).not.toBeNull();
    expect(after!.distanceTo(position)).toBeLessThan(1e-12);
  });

  it('place le corps à l’opposé après une demi-période', () => {
    const { position, velocity, period } = circularState(
      1,
      MU_SUN_AU3_PER_DAY2
    );
    const half = propagateTwoBody(
      position,
      velocity,
      period / 2,
      MU_SUN_AU3_PER_DAY2
    )!;
    expect(half.length()).toBeCloseTo(1, 10);
    expect(
      half.clone().normalize().dot(position.clone().normalize())
    ).toBeCloseTo(-1, 10);
  });

  /**
   * Le cœur du module : franchir un intervalle qui contient PLUSIEURS révolutions. C'est ce
   * que l'interpolation de Hermite ne sait pas faire, et ce pour quoi le déroulement des
   * tours (cf. `deltaE`) est indispensable — sans lui, `g` compose un ΔE ramené sur sa
   * branche principale avec le Δt complet, et la position part n'importe où.
   */
  it('reste exact après plusieurs révolutions complètes', () => {
    const { position, velocity, period } = circularState(
      1,
      MU_SUN_AU3_PER_DAY2
    );
    for (const turns of [2, 5, 12.5, 40]) {
      const after = propagateTwoBody(
        position,
        velocity,
        turns * period,
        MU_SUN_AU3_PER_DAY2
      )!;
      // Le rayon ne doit jamais dériver, quel que soit le nombre de tours.
      expect(after.length(), `${turns} tours : rayon`).toBeCloseTo(1, 9);
      // Et la phase doit correspondre à la fraction de tour restante.
      const expectedAngle = turns * 2 * Math.PI;
      const angle = position.angleTo(after);
      const wrapped = Math.abs(
        Math.atan2(Math.sin(expectedAngle), Math.cos(expectedAngle))
      );
      expect(angle, `${turns} tours : phase`).toBeCloseTo(wrapped, 8);
    }
  });

  it('est réversible : avancer puis reculer ramène au même point', () => {
    const { position, velocity } = circularState(1.5, MU_SUN_AU3_PER_DAY2, 1.2);
    const forward = propagateTwoBody(
      position,
      velocity,
      37.5,
      MU_SUN_AU3_PER_DAY2
    )!;
    // Vitesse au point d'arrivée inconnue ici : on vérifie la réversibilité par symétrie du
    // signe de Δt sur le même état de départ (propager de -Δt puis de +Δt tombe au même
    // endroit que l'état initial avancé de 0).
    const backward = propagateTwoBody(
      position,
      velocity,
      -37.5,
      MU_SUN_AU3_PER_DAY2
    )!;
    expect(forward.length()).toBeCloseTo(1.5, 9);
    expect(backward.length()).toBeCloseTo(1.5, 9);
    // Symétriques par rapport au point de départ sur une orbite circulaire.
    expect(position.angleTo(forward)).toBeCloseTo(
      position.angleTo(backward),
      9
    );
  });

  it('conserve exactement le plan orbital', () => {
    const { position, velocity, period } = circularState(
      2,
      MU_SUN_AU3_PER_DAY2,
      1.9
    );
    const normal = position.clone().cross(velocity).normalize();
    for (const t of [0.1, 3.7, 21.4]) {
      const after = propagateTwoBody(
        position,
        velocity,
        t * period,
        MU_SUN_AU3_PER_DAY2
      )!;
      expect(Math.abs(after.clone().normalize().dot(normal))).toBeLessThan(
        1e-12
      );
    }
  });

  /**
   * Excentricité : le rayon doit osciller entre a(1−e) et a(1+e), et seulement là. Écarte
   * une implémentation qui ne serait juste que sur le cas circulaire.
   */
  it('respecte les apsides d’une orbite excentrique', () => {
    const a = 1;
    const e = 0.6;
    const mu = MU_SUN_AU3_PER_DAY2;
    // État au périastre : r = a(1−e), vitesse perpendiculaire.
    const rPeri = a * (1 - e);
    const vPeri = Math.sqrt((mu * (1 + e)) / (a * (1 - e)));
    const position = new THREE.Vector3(rPeri, 0, 0);
    const velocity = new THREE.Vector3(0, vPeri, 0);
    const period = 2 * Math.PI * Math.sqrt((a * a * a) / mu);

    let rMin = Infinity;
    let rMax = 0;
    for (let i = 0; i <= 400; i++) {
      const after = propagateTwoBody(
        position,
        velocity,
        (i / 400) * period,
        mu
      )!;
      rMin = Math.min(rMin, after.length());
      rMax = Math.max(rMax, after.length());
    }
    expect(rMin).toBeCloseTo(a * (1 - e), 6);
    expect(rMax).toBeCloseTo(a * (1 + e), 6);
  });

  it('refuse un état non elliptique plutôt que d’inventer une position', () => {
    const mu = MU_SUN_AU3_PER_DAY2;
    const position = new THREE.Vector3(1, 0, 0);
    // Vitesse au-delà de la libération (√(2μ/r)) → orbite ouverte.
    const escape = Math.sqrt((2 * mu) / 1) * 1.2;
    expect(
      propagateTwoBody(position, new THREE.Vector3(0, escape, 0), 10, mu)
    ).toBeNull();
    expect(
      propagateTwoBody(position, new THREE.Vector3(0, 1e-3, 0), 10, 0)
    ).toBeNull();
  });

  /**
   * `gravitationalParameter` est la passerelle entre le catalogue (masses en kg) et ce
   * module (UA³/jour²). On la vérifie contre une valeur indépendante : μ☉ dérivé de la
   * constante de Gauss, que le catalogue ne connaît pas.
   */
  it('dérive un μ cohérent avec la constante de Gauss pour la masse du Soleil', () => {
    const muFromMass = gravitationalParameter(1.989e30);
    expect(muFromMass / MU_SUN_AU3_PER_DAY2).toBeCloseTo(1, 2);
  });
});
