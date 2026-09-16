import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  computeLightAttenuation,
  computeUmbralShadow,
  MIN_LIGHT_ATTENUATION,
  solarIrradianceFactor,
  UMBRA_REFRACTED_LIGHT,
  umbralDepth,
  umbralTint,
} from './eclipse';

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

const LUMINANCE = (tint: readonly [number, number, number]): number =>
  0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2];

describe('ombre cuivrée d’un occulteur qui a une atmosphère', () => {
  const body = new THREE.Vector3(10, 0, 0);
  const sun = new THREE.Vector3(0, 0, 0);
  /** Occulteur assez gros pour cacher entièrement le Soleil : ombre, pas pénombre. */
  const totalOccluder = { position: new THREE.Vector3(5, 0, 0), radius: 2 };

  /**
   * Les cinq quintiles de luminance mesurés sur une photographie NASA de totalité
   * (3 mars 2026), en LINÉAIRE et normalisés en luminance : c'est la seule référence de cette
   * teinte. Si quelqu'un « ajuste » la courbe à l'œil, ceci tombe.
   */
  it.each([
    [0, [1.58, 0.86, 0.66]],
    [0.25, [2.26, 0.69, 0.36]],
    [0.5, [2.98, 0.48, 0.28]],
    [0.75, [3.51, 0.32, 0.3]],
    [1, [4.08, 0.15, 0.32]],
  ] as const)('reproduit la mesure à la profondeur %s', (depth, measured) => {
    const tint = umbralTint(depth);
    for (let channel = 0; channel < 3; channel++)
      expect(Math.abs(tint[channel]! - measured[channel]!)).toBeLessThan(0.2);
  });

  it('ne change que la couleur, jamais la clarté', () => {
    // Normalisée en luminance à toute profondeur : sans cela, rougir l'ombre l'éclaircirait
    // aussi — c'est exactement la confusion qui avait produit un couchant brun.
    for (const depth of [0, 0.3, 0.7, 1])
      expect(LUMINANCE(umbralTint(depth))).toBeCloseTo(1, 6);
  });

  it('rougit avec la profondeur, dans les deux sens', () => {
    const edge = umbralTint(0);
    const core = umbralTint(1);
    expect(core[0]).toBeGreaterThan(edge[0]);
    expect(core[1]).toBeLessThan(edge[1]);
    expect(core[0] / core[1]).toBeGreaterThan(10 * (edge[0] / edge[1]));
  });

  it('mesure la profondeur sur la géométrie, pas sur la fraction occultée', () => {
    // La fraction occultée sature à 1 dans toute l'ombre : elle ne distingue pas ces cas.
    expect(umbralDepth(0.01, 0.05, 0)).toBeCloseTo(1, 8); // sur l'axe
    expect(umbralDepth(0.01, 0.05, 0.04)).toBeCloseTo(0, 8); // au bord de l'ombre
    expect(umbralDepth(0.01, 0.05, 0.02)).toBeCloseTo(0.5, 8);
    // Occulteur plus petit que le Soleil : anneau, aucune ombre vraie, donc aucune profondeur.
    expect(umbralDepth(0.05, 0.01, 0)).toBe(0);
  });

  it('teinte l’ombre d’un occulteur atmosphérique et laisse l’autre neutre', () => {
    const refracted = computeUmbralShadow(body, sun, 1, [totalOccluder], true);
    const airless = computeUmbralShadow(body, sun, 1, [totalOccluder], false);
    // Avec atmosphère : niveau retenu (UMBRA_REFRACTED_LIGHT) et rouge franchement dominant.
    expect(LUMINANCE(refracted)).toBeCloseTo(UMBRA_REFRACTED_LIGHT, 6);
    expect(refracted[0] / refracted[2]).toBeGreaterThan(3);
    // Sans atmosphère : rien à réfracter, ombre neutre au plancher historique.
    expect(airless[0]).toBeCloseTo(MIN_LIGHT_ATTENUATION, 8);
    expect(airless[0]).toBe(airless[1]);
    expect(airless[1]).toBe(airless[2]);
    // Une ombre cuivrée reste plus claire qu'une ombre neutre : sinon elle ne se verrait pas.
    expect(LUMINANCE(refracted)).toBeGreaterThan(LUMINANCE(airless));
  });

  it('ne teinte rien hors de l’ombre', () => {
    const clear = computeUmbralShadow(
      body,
      sun,
      1,
      [{ position: new THREE.Vector3(5, 4, 0), radius: 0.5 }],
      true
    );
    expect(clear[0]).toBeCloseTo(1, 8);
    expect(clear[1]).toBeCloseTo(1, 8);
    expect(clear[2]).toBeCloseTo(1, 8);
  });
});
