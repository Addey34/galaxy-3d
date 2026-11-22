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

/**
 * LE RENDU DE REMPLACEMENT (GAL-UNIVERSE-002) : le voisinage solaire dessine à la place de la scène
 * solaire, avec le MÊME renderer et la MÊME boucle. Une seule boucle (`setAnimationLoop` posé une
 * fois), un seul rendu par image, simulation figée (delta 0) tant qu'il est posé, et la scène solaire
 * reprend dès qu'il est retiré.
 */
describe('rendu de remplacement (voisinage solaire)', () => {
  function harness() {
    const system = new AnimationSystem();
    const calls = { solarRender: 0, update: [] as number[], override: 0 };
    const loops: Array<(() => void) | null> = [];
    Reflect.set(system, 'renderer', {
      setAnimationLoop: (fn: (() => void) | null) => loops.push(fn),
    });
    Reflect.set(system, 'tweenGroup', { update: () => undefined });
    Reflect.set(system, 'fpsCounter', { update: () => undefined });
    Reflect.set(system, '_update', (delta: number) => calls.update.push(delta));
    Reflect.set(system, '_render', () => (calls.solarRender += 1));
    // `clock.getDelta` d'une horloge réelle : 16 ms entre deux images.
    Reflect.set(system, 'clock', {
      getDelta: () => 0.016,
      start: () => undefined,
    });
    const frame = Reflect.get(system, '_animate') as () => void;
    return { system, calls, loops, frame: () => frame.call(system) };
  }

  it("ne pose qu'une boucle, et rend la scène solaire tant qu'aucun remplacement n'est posé", () => {
    const { system, calls, loops, frame } = harness();
    system.run();
    expect(loops.filter(Boolean)).toHaveLength(1);
    frame();
    expect(calls.solarRender).toBe(1);
    expect(calls.update).toEqual([0.016]);
  });

  it('remplacé : un seul rendu par image (le remplaçant), simulation figée, boucle inchangée', () => {
    const { system, calls, loops, frame } = harness();
    system.run();
    let override = 0;
    system.setRenderOverride(() => (override += 1));
    frame();
    frame();
    expect(override).toBe(2);
    expect(calls.solarRender).toBe(0);
    // delta 0 : la date de la scène ne dérive pas pendant que la vue stellaire est ouverte.
    expect(calls.update).toEqual([0, 0]);
    // Aucune seconde boucle n'a été posée.
    expect(loops.filter(Boolean)).toHaveLength(1);
  });

  it('retiré : la scène solaire reprend, avec son delta réel (falsification : un remplaçant oublié la figerait)', () => {
    const { system, calls, frame } = harness();
    system.run();
    system.setRenderOverride(() => undefined);
    frame();
    system.setRenderOverride(null);
    frame();
    expect(calls.solarRender).toBe(1);
    expect(calls.update).toEqual([0, 0.016]);
  });
});
