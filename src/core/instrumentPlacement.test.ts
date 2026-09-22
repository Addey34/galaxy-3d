import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { placeInstrument, spacecraftPlacer } from './instrumentPlacement';
import {
  EDUCATIVE_PARENT_GAP,
  educationalParentOrbitScale,
  educationalSatelliteDistance,
} from './educationalScale';
import { scaleToScene } from './overlayScale';
import { SQRT_K } from './ScaleService';
import { CELESTIAL_CONFIG } from '@/config/bodies';

const jupiter = CELESTIAL_CONFIG.bodies.jupiter!;
const JUPITER_AU = new THREE.Vector3(5.2, 0, 0);

describe('placement des objets d’instrument', () => {
  it('hors phase, reste la compression héliocentrique des couches 2D', () => {
    const p = new THREE.Vector3(1.3, 0.2, -0.4);
    for (const morph of [0, 0.4, 1])
      expect(
        placeInstrument(new THREE.Vector3(), p, null, morph).toArray()
      ).toEqual(
        scaleToScene(new THREE.Vector3(), p.x, p.y, p.z, morph).toArray()
      );
  });

  it('en Explo, reste la VRAIE position, phase ou non (invariant du mode)', () => {
    const probe = new THREE.Vector3(5.23, 0.01, -0.02);
    const out = placeInstrument(
      new THREE.Vector3(),
      probe,
      { parent: jupiter, parentHelioAU: JUPITER_AU },
      1
    );
    expect(out.distanceTo(probe.clone().multiplyScalar(SQRT_K))).toBeLessThan(
      1e-12
    );
  });

  it('en Éducatif, se pose dans le système du corps par la règle des lunes', () => {
    const offset = new THREE.Vector3(0.03, 0.01, -0.02);
    const out = placeInstrument(
      new THREE.Vector3(),
      JUPITER_AU.clone().add(offset),
      { parent: jupiter, parentHelioAU: JUPITER_AU },
      0
    );
    const center = scaleToScene(new THREE.Vector3(), 5.2, 0, 0, 0);
    const rel = out.clone().sub(center);
    // Même direction que la vraie position relative, à la distance de la règle des lunes.
    expect(rel.clone().normalize().dot(offset.clone().normalize())).toBeCloseTo(
      1,
      12
    );
    expect(rel.length()).toBeCloseTo(
      educationalSatelliteDistance(jupiter, offset.length()),
      10
    );
  });

  it('garde l’ordre des distances avec les lunes, et ne passe jamais sous la surface agrandie', () => {
    // Au-delà de la lune la plus proche, la règle est exactement celle des lunes (même facteur
    // commun), donc l'ordre réel est conservé : Juno à l'apojove (0,054 UA) au-delà de
    // Callisto (0,0126 UA). En deçà, la sonde se pose à la surface agrandie, pas dedans.
    const scale = educationalParentOrbitScale(jupiter);
    const callisto = jupiter.satellites!.callisto!.realData!.distanceAU!;
    expect(educationalSatelliteDistance(jupiter, callisto)).toBeCloseTo(
      Math.sqrt(callisto) * SQRT_K * scale,
      10
    );
    expect(educationalSatelliteDistance(jupiter, 0.054)).toBeGreaterThan(
      educationalSatelliteDistance(jupiter, callisto)
    );
    expect(educationalSatelliteDistance(jupiter, 1e-6)).toBe(
      jupiter.radius + EDUCATIVE_PARENT_GAP
    );
  });

  it('le placeur des sondes applique la phase déclarée, et elle seule', () => {
    const phase = { body: 'jupiter', fromMs: 0, toMs: 1000 };
    const place = spacecraftPlacer(
      [{ name: 'probe', satelliteOf: [phase] }],
      CELESTIAL_CONFIG.bodies,
      (name) => (name === 'jupiter' ? JUPITER_AU.clone() : null)
    );
    const probe = JUPITER_AU.clone().add(new THREE.Vector3(0.001, 0, 0));
    const center = scaleToScene(new THREE.Vector3(), 5.2, 0, 0, 0);
    const inPhase = place(
      new THREE.Vector3(),
      'probe',
      probe,
      new Date(500),
      0
    );
    const after = place(new THREE.Vector3(), 'probe', probe, new Date(2000), 0);
    const other = place(new THREE.Vector3(), 'other', probe, new Date(500), 0);
    expect(inPhase.distanceTo(center)).toBeGreaterThan(jupiter.radius);
    // Hors phase, ou pour un objet sans phase : la compression héliocentrique, qui la posait
    // DANS la sphère agrandie (le défaut d'origine).
    expect(after.distanceTo(center)).toBeLessThan(jupiter.radius);
    expect(other.distanceTo(center)).toBeLessThan(jupiter.radius);
  });
});
