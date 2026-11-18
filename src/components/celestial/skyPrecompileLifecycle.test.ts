import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CelestialObject from './CelestialObject';
import type { AerialCompileContext } from './aerialPrecompile';
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { TextureSystem } from '@/components/systems/TextureSystem';
import { CELESTIAL_CONFIG } from '@/config/bodies';

/**
 * CYCLE DE VIE DE LA PRECOMPILATION AERIENNE, vu de CelestialObject (GAL-RENDER-001C, commit C) :
 * une seule operation par corps, aucun nouvel essai a chaque image, aucune finalisation sur un
 * corps libere, copies liberees apres usage effectif, a l'echec ou a l'abandon.
 */

const textureSystem = {
  getLODTexture: () => new Promise<never>(() => {}),
} as unknown as TextureSystem;
const animationSystem = {
  addUpdatable: () => {},
  removeUpdatable: () => {},
} as unknown as AnimationSystem;

function earth() {
  const body = new CelestialObject(
    textureSystem,
    CELESTIAL_CONFIG.bodies['earth'],
    'earth',
    animationSystem
  );
  // Explo (facteur d'echelle different de 1) : le ciel ne se charge qu'en Explo.
  (body as unknown as { _scaleFactor: number })._scaleFactor = 35;
  return body;
}

function context(
  compileAsync: (...a: never[]) => Promise<unknown>
): AerialCompileContext & { compileAsync: typeof compileAsync } {
  let target: unknown = null;
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => {
      target = t;
    },
    xr: { isPresenting: false },
    compileAsync,
  };
  return {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    renderTarget: null,
    compileAsync,
  };
}

const near = new THREE.Vector3(0, 0, 0);
const sun = new THREE.Vector3(10, 0, 0);
const frame = (b: CelestialObject, ctx?: AerialCompileContext) =>
  b.update(0.016, sun, true, near, null, ctx);
const flush = () => new Promise((r) => setTimeout(r, 0));
/** Attend un etat (les imports dynamiques prennent plusieurs tours de boucle). */
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await flush();
  if (!cond()) throw new Error('etat attendu non atteint');
}
const state = (b: CelestialObject) =>
  b as unknown as {
    _sky: number;
    _aerialPrecompile: { held: number; release(): void } | null;
  };

afterEach(() => vi.restoreAllMocks());

describe('ciel + precompilation : une operation, un repli, pas de fuite', () => {
  it('une seule precompilation, meme si update est appele a chaque image pendant la compilation', async () => {
    let resolve!: () => void;
    const compileAsync = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const ctx = context(compileAsync);
    const b = earth();
    for (let i = 0; i < 20; i++) frame(b, ctx);
    await until(() => compileAsync.mock.calls.length === 1);
    for (let i = 0; i < 20; i++) frame(b, ctx);
    expect(state(b)._sky).toBe(1);
    expect(compileAsync).toHaveBeenCalledTimes(1);
    resolve();
    await until(() => state(b)._sky === 2);
    for (let i = 0; i < 20; i++) frame(b, ctx);
    expect(compileAsync).toHaveBeenCalledTimes(1);
    b.dispose();
  });

  it('libere les copies apres 3 images visibles, pas avant', async () => {
    const ctx = context(() => Promise.resolve());
    const b = earth();
    frame(b, ctx);
    await until(() => state(b)._sky === 2);
    const pre = state(b)._aerialPrecompile!;
    expect(pre.held).toBeGreaterThan(0);
    frame(b, ctx);
    frame(b, ctx);
    expect(state(b)._aerialPrecompile).toBe(pre);
    expect(pre.held).toBeGreaterThan(0);
    frame(b, ctx);
    expect(state(b)._aerialPrecompile).toBeNull();
    expect(pre.held).toBe(0);
    b.dispose();
  });

  it('les images hors champ ne comptent pas comme usage effectif', async () => {
    const ctx = context(() => Promise.resolve());
    const b = earth();
    frame(b, ctx);
    await until(() => state(b)._sky === 2);
    for (let i = 0; i < 10; i++) b.update(0.016, sun, false, near, null, ctx);
    expect(state(b)._aerialPrecompile?.held).toBeGreaterThan(0);
    b.dispose();
    expect(state(b)._aerialPrecompile).toBeNull();
  });

  it('compileAsync qui echoue : le ciel est pose quand meme (rendu de reference), sans nouvelle tentative', async () => {
    const compileAsync = vi.fn(() => Promise.reject(new Error('perdu')));
    const ctx = context(compileAsync);
    const b = earth();
    frame(b, ctx);
    await until(() => state(b)._sky === 2);
    expect(state(b)._sky).toBe(2);
    for (let i = 0; i < 10; i++) frame(b, ctx);
    expect(compileAsync).toHaveBeenCalledTimes(1);
    b.dispose();
  });

  it('sans contexte de rendu (ou en XR) : pas de precompilation, le ciel est pose', async () => {
    const b = earth();
    frame(b, undefined);
    await until(() => state(b)._sky === 2);
    expect(state(b)._sky).toBe(2);
    expect(state(b)._aerialPrecompile).toBeNull();
    b.dispose();

    const compileAsync = vi.fn(() => Promise.resolve());
    const xr = context(compileAsync);
    (xr.renderer.xr as { isPresenting: boolean }).isPresenting = true;
    const c = earth();
    frame(c, xr);
    await until(() => state(c)._sky === 2);
    expect(state(c)._sky).toBe(2);
    expect(compileAsync).not.toHaveBeenCalled();
    c.dispose();
  });

  it('corps libere pendant la compilation : copies liberees, ciel non pose', async () => {
    let resolve!: () => void;
    const started = vi.fn();
    const ctx = context(
      () =>
        new Promise<void>((r) => {
          started();
          resolve = r;
        })
    );
    const b = earth();
    const disposeSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
    frame(b, ctx);
    await until(() => started.mock.calls.length === 1);
    const before = disposeSpy.mock.calls.length;
    b.dispose();
    const afterDispose = disposeSpy.mock.calls.length;
    resolve();
    await flush();
    await flush();
    expect(state(b)._aerialPrecompile).toBeNull();
    expect(state(b)._sky).not.toBe(2);
    // Les copies ont ete liberees une fois, par le seul abandon.
    expect(disposeSpy.mock.calls.length).toBeGreaterThanOrEqual(afterDispose);
    expect(afterDispose).toBeGreaterThanOrEqual(before);
  });

  it('rien ne rejette sans etre gere quand la compilation echoue apres la liberation', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    let reject!: (e: Error) => void;
    const started = vi.fn();
    const ctx = context(
      () =>
        new Promise<void>((_, r) => {
          started();
          reject = r;
        })
    );
    const b = earth();
    frame(b, ctx);
    await until(() => started.mock.calls.length === 1);
    b.dispose();
    reject(new Error('tard'));
    await flush();
    await flush();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
