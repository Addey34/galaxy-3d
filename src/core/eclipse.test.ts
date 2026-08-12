import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computeLightAttenuation, solarIrradianceFactor } from './eclipse';

describe('physical light attenuation', () => {
  const body = new THREE.Vector3(10, 0, 0);
  const sun = new THREE.Vector3(0, 0, 0);

  it('keeps full light without an aligned foreground occluder', () => {
    expect(
      computeLightAttenuation(body, sun, 1, [
        { position: new THREE.Vector3(5, 4, 0), radius: 0.5 },
      ])
    ).toBeCloseTo(1, 8);
  });

  it('models total and partial eclipses with bounded residual light', () => {
    const total = computeLightAttenuation(body, sun, 1, [
      { position: new THREE.Vector3(5, 0, 0), radius: 2 },
    ]);
    const partial = computeLightAttenuation(body, sun, 1, [
      { position: new THREE.Vector3(5, 0.45, 0), radius: 0.75 },
    ]);

    expect(total).toBeCloseTo(0.02, 8);
    expect(partial).toBeGreaterThan(0.02);
    expect(partial).toBeLessThan(1);
  });

  it('keeps shallow partial eclipses nearly luminous (tightened umbra)', () => {
    // Occulteur légèrement décalé : le disque solaire n'est que faiblement mordu.
    const shallow = computeLightAttenuation(body, sun, 1, [
      { position: new THREE.Vector3(5, 0.9, 0), radius: 0.75 },
    ]);
    // La courbe puissance doit laisser >85 % de lumière sur une occultation faible.
    expect(shallow).toBeGreaterThan(0.85);
    expect(shallow).toBeLessThan(1);
  });

  it('uses inverse-square irradiance with safe visual bounds', () => {
    expect(solarIrradianceFactor(1)).toBe(1);
    expect(solarIrradianceFactor(0.5)).toBe(4);
    expect(solarIrradianceFactor(30)).toBe(0.03);
  });
});
