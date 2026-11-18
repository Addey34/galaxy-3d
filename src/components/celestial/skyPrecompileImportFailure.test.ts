import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import CelestialObject from './CelestialObject';
import type { AerialCompileContext } from './aerialPrecompile';
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { TextureSystem } from '@/components/systems/TextureSystem';
import { CELESTIAL_CONFIG } from '@/config/bodies';

/**
 * GAL-RENDER-001C : la precompilation est FACULTATIVE. Si son morceau ne se charge pas (reseau
 * coupe, deploiement partiel), le ciel doit etre pose quand meme, et l'import ne doit pas etre
 * retente a chaque image.
 */

let importAttempts = 0;
vi.mock('./aerialPrecompile', () => {
  importAttempts += 1;
  throw new Error('chunk aerialPrecompile introuvable');
});

const textureSystem = {
  getLODTexture: () => new Promise<never>(() => {}),
} as unknown as TextureSystem;
const animationSystem = {
  addUpdatable: () => {},
  removeUpdatable: () => {},
} as unknown as AnimationSystem;

const context: AerialCompileContext = {
  renderer: {
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    xr: { isPresenting: false },
    properties: { get: () => ({}) },
    compile: () => new Set(),
  } as unknown as THREE.WebGLRenderer,
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  renderTarget: null,
};

const flush = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await flush();
  if (!cond()) throw new Error('etat attendu non atteint');
}

describe("echec d'import de la precompilation", () => {
  it('le ciel est pose quand meme, sans precompilation, et sans nouvel import', async () => {
    const body = new CelestialObject(
      textureSystem,
      CELESTIAL_CONFIG.bodies['earth'],
      'earth',
      animationSystem
    );
    const internals = body as unknown as {
      _scaleFactor: number;
      _sky: number;
      _aerialPrecompile: unknown;
      _aerialUnavailable: boolean;
    };
    internals._scaleFactor = 35;
    const near = new THREE.Vector3();
    const sun = new THREE.Vector3(10, 0, 0);
    body.update(0.016, sun, true, near, null, context);
    await until(() => internals._sky === 2);
    expect(internals._aerialPrecompile).toBeNull();
    expect(internals._aerialUnavailable).toBe(true);
    expect(importAttempts).toBeGreaterThan(0);
    body.dispose();
  });
});
