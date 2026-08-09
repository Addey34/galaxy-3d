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
  it('adapts FOV and exposure for a distant true-scale target', () => {
    const cameraSystem = new CameraSystem();
    cameraSystem.camera = new THREE.PerspectiveCamera(65);
    cameraSystem.camera.position.set(0, 10, 10);
    cameraSystem.controls = {
      target: new THREE.Vector3(),
      enabled: true,
      update: () => {},
    } as unknown as CameraSystem['controls'];
    cameraSystem.renderer = {
      toneMappingExposure: 1,
    } as unknown as CameraSystem['renderer'];
    cameraSystem.tweenGroup = new TweenGroup();

    Reflect.set(cameraSystem, '_scaleMode', 'explo');
    Reflect.set(cameraSystem, 'celestialBodies', {
      neptune: bodyAt(1050),
    });

    cameraSystem.setTarget('neptune');

    expect(cameraSystem.camera.fov).toBe(55);
    expect(cameraSystem.renderer.toneMappingExposure).toBe(4);
  });

  it('keeps the current camera framing during a scale-mode transition', () => {
    const cameraSystem = new CameraSystem();
    cameraSystem.camera = new THREE.PerspectiveCamera(65);
    cameraSystem.camera.position.set(7, 11, 13);
    cameraSystem.controls = {
      target: new THREE.Vector3(2, 3, 5),
      enabled: true,
      minDistance: 0,
      maxDistance: 100,
      update: () => {},
    } as unknown as CameraSystem['controls'];
    cameraSystem.renderer = {
      toneMappingExposure: 1,
    } as unknown as CameraSystem['renderer'];
    cameraSystem.tweenGroup = new TweenGroup();
    Reflect.set(cameraSystem, '_scaleMode', 'educ');
    Reflect.set(cameraSystem, 'currentTarget', {
      name: 'earth',
      group: bodyAt(35).group,
      distance: 5,
    });

    const position = cameraSystem.camera.position.clone();
    const target = cameraSystem.controls.target.clone();
    cameraSystem.transitionScaleMode('explo');

    expect(cameraSystem.camera.position.equals(position)).toBe(true);
    expect(cameraSystem.controls.target.equals(target)).toBe(true);
    expect(cameraSystem.camera.fov).toBe(65);
    expect(cameraSystem.targetName).toBe('earth');
    const targetBody = (
      Reflect.get(cameraSystem, 'currentTarget') as { group: THREE.Group }
    ).group;
    targetBody.position.x = 40;
    cameraSystem.update(0);
    expect(cameraSystem.controls.target.x).toBeCloseTo(40);
    expect(cameraSystem.camera.position.x).toBeCloseTo(45);
    expect(cameraSystem.tweenGroup.getAll()).toHaveLength(0);
  });
});
it('clamps optical FOV in Educational mode too', () => {
  const cameraSystem = new CameraSystem();
  cameraSystem.camera = new THREE.PerspectiveCamera(55);

  cameraSystem.setOpticalFov(1);
  expect(cameraSystem.opticalFov).toBe(8);
  expect(cameraSystem.camera.fov).toBe(8);

  cameraSystem.setOpticalFov(90);
  expect(cameraSystem.opticalFov).toBe(55);
  expect(cameraSystem.camera.fov).toBe(55);
});
