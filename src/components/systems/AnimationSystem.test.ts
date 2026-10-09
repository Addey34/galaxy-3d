import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AnimationSystem } from './AnimationSystem';
import { SQRT_K } from '@/core/ScaleService';

/**
 * L'ADAPTATION AU CORPS SUIVI (ligne 45.7), lue là où elle s'applique : la passe d'éclairage
 * Explo. Avant elle, Cérès suivie recevait 13 % de l'éclairement terrestre et se rendait à une
 * luminance moyenne de 2 sur 255 ; le facteur commun la ramène à l'éclairement de la Terre sans
 * changer les rapports entre corps.
 */
function fakeBody(
  au: number,
  angle = 0
): {
  group: THREE.Group;
  attenuation: number;
  setLightAttenuation(value: number): void;
  setEclipseShadowSource(): void;
  setUmbraTint(): void;
  refractsLight: boolean;
} {
  const group = new THREE.Group();
  // Chacun dans sa direction : alignés, ils s'éclipseraient les uns les autres.
  group.position.set(
    au * SQRT_K * Math.cos(angle),
    0,
    au * SQRT_K * Math.sin(angle)
  );
  group.userData['radius'] = 0.0001;
  return {
    group,
    attenuation: NaN,
    setLightAttenuation(value) {
      this.attenuation = value;
    },
    setEclipseShadowSource() {},
    setUmbraTint() {},
    refractsLight: false,
  };
}

function lightingPass(
  target: string | null,
  probePosition: THREE.Vector3 | null = null
): Record<string, ReturnType<typeof fakeBody>> {
  const bodies = {
    sun: fakeBody(0),
    mars: fakeBody(1.52, 0),
    ceres: fakeBody(2.77, 2),
    saturn: fakeBody(9.54, 4),
  };
  const system = new AnimationSystem();
  Reflect.set(system, 'celestialBodies', bodies);
  Reflect.set(system, 'orbitalMechanics', { scaleMode: 'explo' });
  Reflect.set(system, 'cameraSystem', {
    targetName: target,
    getTargetWorldPosition(out: THREE.Vector3): boolean {
      if (!probePosition) return false;
      out.copy(probePosition);
      return true;
    },
  });
  const pass = Reflect.get(system, '_updatePhysicalLighting') as (
    sun: THREE.Vector3
  ) => void;
  pass.call(system, new THREE.Vector3());
  return bodies;
}

describe('adaptation de l’éclairage au corps suivi (ligne 45.7)', () => {
  it('éclaire Cérès suivie comme à 1 UA, et garde les rapports entre corps', () => {
    const free = lightingPass(null);
    const followed = lightingPass('ceres');
    expect(free.ceres.attenuation).toBeCloseTo(1 / 2.77 ** 2, 6);
    expect(followed.ceres.attenuation).toBeCloseTo(1, 6);
    // Même facteur pour tous : Mars reste 3,3 fois plus éclairée que Cérès.
    expect(followed.mars.attenuation / followed.ceres.attenuation).toBeCloseTo(
      free.mars.attenuation / free.ceres.attenuation,
      6
    );
    expect(followed.sun.attenuation).toBe(1);
  });

  it('suit aussi un objet sans corps (sonde) par la position que lit la caméra', () => {
    const atSaturn = lightingPass(
      'cassini',
      new THREE.Vector3(0, 0, -9.54 * SQRT_K)
    );
    expect(atSaturn.saturn.attenuation).toBeCloseTo(1, 6);
    // Sans position lisible, rien ne change.
    expect(lightingPass('cassini').saturn.attenuation).toBeCloseTo(
      lightingPass(null).saturn.attenuation,
      9
    );
  });

  it('ne change rien quand le Soleil est suivi', () => {
    expect(lightingPass('sun').ceres.attenuation).toBeCloseTo(
      lightingPass(null).ceres.attenuation,
      9
    );
  });
});
