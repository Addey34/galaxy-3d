import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  VIEW_FROM_CLEARANCE,
  viewAnglesFromDirection,
  viewFromDistance,
} from './viewAngles';

/**
 * Le seul contrat qui compte : les angles rendus, repassés dans la conversion inverse de
 * Three.js, doivent redonner la direction demandée. Une erreur de convention (azimut mesuré
 * depuis X au lieu de Z, polaire depuis l'équateur au lieu du pôle) cadre la caméra ailleurs
 * sans rien casser d'observable — c'est exactement ce qu'un aller-retour attrape.
 */
describe('angles de caméra depuis une direction', () => {
  it.each([
    ['axe +Z', new THREE.Vector3(0, 0, 1)],
    ['axe +X', new THREE.Vector3(1, 0, 0)],
    ['axe -X', new THREE.Vector3(-1, 0, 0)],
    ['pôle nord', new THREE.Vector3(0, 1, 0)],
    ['oblique', new THREE.Vector3(0.3, -0.5, 0.81)],
  ] as const)('retrouve la direction %s', (_label, direction) => {
    const angles = viewAnglesFromDirection(direction)!;
    const back = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(angles.polarDeg),
      THREE.MathUtils.degToRad(angles.azimuthDeg)
    );
    const unit = direction.clone().normalize();
    expect(back.x).toBeCloseTo(unit.x, 6);
    expect(back.y).toBeCloseTo(unit.y, 6);
    expect(back.z).toBeCloseTo(unit.z, 6);
  });

  it('refuse une direction nulle plutôt que de rendre des angles arbitraires', () => {
    expect(viewAnglesFromDirection(new THREE.Vector3())).toBeNull();
  });
});

describe('viewFromDistance (ligne 45.2)', () => {
  it('sort la caméra de la Terre : le cas mesuré de la Lune éclipsée en Éducatif', () => {
    // Lune à 2,24 de la Terre (rayon 1), cadrée à 2,0 : la caméra était à 0,24 du centre.
    const distance = viewFromDistance(2, 2.24, 1);
    expect(distance).toBeCloseTo(2.24 - VIEW_FROM_CLEARANCE, 9);
    expect(2.24 - distance).toBeGreaterThan(1);
  });

  it('garde la distance courante quand la caméra est déjà hors du corps', () => {
    expect(viewFromDistance(2, 30, 1)).toBe(2);
  });

  it('garde la distance courante quand la cible touche presque le corps', () => {
    expect(viewFromDistance(2, 1, 1)).toBe(2);
    expect(viewFromDistance(2, Number.NaN, 1)).toBe(2);
  });
});
