import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { equatorialToScene, OBLIQUITY_RAD } from './frames';

const SIN_OBL = Math.sin(OBLIQUITY_RAD);
const COS_OBL = Math.cos(OBLIQUITY_RAD);

describe('equatorialToScene', () => {
  it('maps equatorial +X to scene +X', () => {
    const v = equatorialToScene(1, 0, 0);
    expect(v.x).toBeCloseTo(1, 12);
    expect(v.y).toBeCloseTo(0, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });

  it('maps the ecliptic north pole to scene +Y', () => {
    // Le pôle nord écliptique s'exprime (0, -sinε, cosε) en équatorial J2000.
    const v = equatorialToScene(0, -SIN_OBL, COS_OBL);
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(1, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });

  it('preserves vector length (pure rotation)', () => {
    const v = equatorialToScene(0.3, -1.7, 2.4);
    expect(v.length()).toBeCloseTo(Math.hypot(0.3, -1.7, 2.4), 12);
  });

  it('is a proper rotation — preserves cross products (determinant +1, not a reflection)', () => {
    const a = new THREE.Vector3(1, 2, -0.5);
    const b = new THREE.Vector3(-0.4, 0.9, 1.3);
    const crossThenMap = equatorialToScene(
      ...(new THREE.Vector3().crossVectors(a, b).toArray() as [number, number, number]),
    );
    const mapThenCross = new THREE.Vector3().crossVectors(
      equatorialToScene(a.x, a.y, a.z),
      equatorialToScene(b.x, b.y, b.z),
    );
    expect(mapThenCross.x).toBeCloseTo(crossThenMap.x, 12);
    expect(mapThenCross.y).toBeCloseTo(crossThenMap.y, 12);
    expect(mapThenCross.z).toBeCloseTo(crossThenMap.z, 12);
  });
});
