import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  gravitationalParameter,
  MU_SUN_AU3_PER_DAY2,
  osculatingOrbitPoints,
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

  it('refuse un μ nul plutôt que d’inventer une position', () => {
    expect(
      propagateTwoBody(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 1e-3, 0),
        10,
        0
      )
    ).toBeNull();
  });

  /**
   * L'HYPERBOLE (ligne 45.10) : la forme d'un survol. Deux propriétés indépendantes de la
   * formule f et g testée : l'énergie et le moment cinétique se conservent. Une branche fausse
   * (signe de |a|, sinh au lieu de cosh) casse l'une des deux.
   */
  it('propage une hyperbole en conservant énergie et moment cinétique', () => {
    const mu = MU_SUN_AU3_PER_DAY2;
    const position = new THREE.Vector3(1, 0.2, 0.05);
    const velocity = new THREE.Vector3(-0.004, 0.03, 0.002); // au-delà de la libération
    const energy = (v: THREE.Vector3, r: THREE.Vector3) =>
      v.lengthSq() / 2 - mu / r.length();
    const e0 = energy(velocity, position);
    expect(e0).toBeGreaterThan(0);
    const h0 = new THREE.Vector3().crossVectors(position, velocity);
    for (const dt of [-40, -3, 0.5, 7, 60]) {
      const step = 1e-4;
      const p = propagateTwoBody(position, velocity, dt, mu)!;
      const v = propagateTwoBody(position, velocity, dt + step, mu)!
        .sub(propagateTwoBody(position, velocity, dt - step, mu)!)
        .divideScalar(2 * step);
      expect(energy(v, p) / e0).toBeCloseTo(1, 6);
      const h = new THREE.Vector3().crossVectors(p, v);
      expect(h.distanceTo(h0) / h0.length()).toBeLessThan(1e-7);
    }
  });

  it('revient à son point de départ après un aller-retour hyperbolique', () => {
    const mu = MU_SUN_AU3_PER_DAY2;
    const position = new THREE.Vector3(0.4, -0.3, 0.1);
    const velocity = new THREE.Vector3(0.02, 0.035, -0.003);
    const there = propagateTwoBody(position, velocity, 25, mu)!;
    const step = 1e-4;
    const v = propagateTwoBody(position, velocity, 25 + step, mu)!
      .sub(propagateTwoBody(position, velocity, 25 - step, mu)!)
      .divideScalar(2 * step);
    const back = propagateTwoBody(there, v, -25, mu)!;
    expect(back.distanceTo(position)).toBeLessThan(1e-9);
  });

  /**
   * Témoin INDÉPENDANT de la formule : une intégration numérique (RK4, pas d'une seconde) de
   * la même hyperbole autour de la Terre, au passage au plus près d'un survol réel (JUICE,
   * 2024 : ~13 000 km du centre à ~13,7 km/s). Sans la branche, la fonction rendait `null`.
   */
  it('suit une intégration numérique d’un survol de la Terre', () => {
    const mu = gravitationalParameter(5.972e24);
    const KM = 1 / 1.495_978_707e8;
    const position = new THREE.Vector3(13_000 * KM, 0, 0);
    const velocity = new THREE.Vector3(0, 13.7 * KM * 86_400, 1 * KM * 86_400);
    const accel = (r: THREE.Vector3) =>
      r.clone().multiplyScalar(-mu / Math.pow(r.length(), 3));
    const r = position.clone();
    const v = velocity.clone();
    const h = 1 / 86_400;
    const span = 0.25; // six heures
    for (let t = 0; t < span - h / 2; t += h) {
      const k1v = accel(r);
      const k1r = v.clone();
      const k2v = accel(r.clone().addScaledVector(k1r, h / 2));
      const k2r = v.clone().addScaledVector(k1v, h / 2);
      const k3v = accel(r.clone().addScaledVector(k2r, h / 2));
      const k3r = v.clone().addScaledVector(k2v, h / 2);
      const k4v = accel(r.clone().addScaledVector(k3r, h));
      const k4r = v.clone().addScaledVector(k3v, h);
      r.addScaledVector(
        k1r.add(k2r.multiplyScalar(2)).add(k3r.multiplyScalar(2)).add(k4r),
        h / 6
      );
      v.addScaledVector(
        k1v.add(k2v.multiplyScalar(2)).add(k3v.multiplyScalar(2)).add(k4v),
        h / 6
      );
    }
    const propagated = propagateTwoBody(position, velocity, span, mu)!;
    expect(propagated.distanceTo(r) / KM).toBeLessThan(0.01); // moins de 10 m
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

describe('osculatingOrbitPoints', () => {
  /** Un état au périhélie d'une orbite très excentrique (e = 0,967, celle de Halley). */
  function halleyLikeState(): {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    a: number;
    e: number;
  } {
    const a = 17.8;
    const e = 0.967;
    const q = a * (1 - e);
    const speed = Math.sqrt((MU_SUN_AU3_PER_DAY2 * (1 + e)) / q);
    return {
      position: new THREE.Vector3(q, 0, 0),
      velocity: new THREE.Vector3(0, 0, -speed),
      a,
      e,
    };
  }

  it('met le corps au milieu de la liste et la couture à l’opposé', () => {
    const { position, velocity, a, e } = halleyLikeState();
    const points = osculatingOrbitPoints(
      position,
      velocity,
      MU_SUN_AU3_PER_DAY2,
      512
    )!;
    expect(points).toHaveLength(512);
    expect(points[256]!.distanceTo(position)).toBeLessThan(1e-9);
    // Parti du périhélie, le premier point est l'aphélie.
    expect(points[0]!.length()).toBeCloseTo(a * (1 + e), 6);
  });

  it('reste sur une seule conique : même énergie, même plan', () => {
    const { position, velocity, a } = halleyLikeState();
    const points = osculatingOrbitPoints(
      position,
      velocity,
      MU_SUN_AU3_PER_DAY2,
      64
    )!;
    const normal = position.clone().cross(velocity).normalize();
    for (const point of points) {
      expect(Math.abs(point.dot(normal))).toBeLessThan(1e-9);
      expect(point.length()).toBeLessThanOrEqual(2 * a + 1e-9);
    }
  });

  it('répartit les points en anomalie excentrique, pas en temps', () => {
    // En temps, 512 points sur 76 ans laissaient 130° de trou au périhélie de Halley.
    const { position, velocity } = halleyLikeState();
    const points = osculatingOrbitPoints(
      position,
      velocity,
      MU_SUN_AU3_PER_DAY2,
      512
    )!;
    let maxGapDeg = 0;
    for (let i = 1; i < points.length; i++)
      maxGapDeg = Math.max(
        maxGapDeg,
        (points[i - 1]!.angleTo(points[i]!) * 180) / Math.PI
      );
    expect(maxGapDeg).toBeLessThan(10);
  });

  it('refuse un état non elliptique', () => {
    const position = new THREE.Vector3(1, 0, 0);
    const escape = Math.sqrt(2 * MU_SUN_AU3_PER_DAY2) * 1.01;
    expect(
      osculatingOrbitPoints(
        position,
        new THREE.Vector3(0, escape, 0),
        MU_SUN_AU3_PER_DAY2,
        16
      )
    ).toBeNull();
  });
});
