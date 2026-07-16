import { Group as TweenGroup } from '@tweenjs/tween.js';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraSystem } from './CameraSystem';

function bodyAt(x: number): {
  group: THREE.Group;
  cameraDistance: { educ: number; explo: number };
} {
  const group = new THREE.Group();
  group.position.set(x, 0, 0);
  group.userData['radius'] = 1;
  return {
    group,
    cameraDistance: { educ: 5, explo: 0.01 },
  };
}

describe('CameraSystem target flights', () => {
  it('replaces an active flight instead of stacking competing tweens', () => {
    const cameraSystem = new CameraSystem();
    cameraSystem.camera = new THREE.PerspectiveCamera();
    cameraSystem.camera.position.set(0, 10, 10);
    cameraSystem.controls = {
      target: new THREE.Vector3(),
      enabled: true,
    } as unknown as CameraSystem['controls'];
    cameraSystem.tweenGroup = new TweenGroup();
    Reflect.set(cameraSystem, 'celestialBodies', {
      earth: bodyAt(35),
      mars: bodyAt(53),
    });

    cameraSystem.setTarget('earth');
    expect(cameraSystem.tweenGroup.getAll()).toHaveLength(2);

    cameraSystem.setTarget('mars');
    expect(cameraSystem.targetName).toBe('mars');
    expect(cameraSystem.tweenGroup.getAll()).toHaveLength(2);
  });
});
