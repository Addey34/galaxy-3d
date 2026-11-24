import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LE CHARGEMENT PARTAGÉ DES MODÈLES DE FORME (GAL-ENGINE-HEADROOM-001) : un seul `import()` du
 * chargeur, au plus deux fichiers en vol, et la cible d'un vol passe devant.
 */
const state = {
  constructed: 0,
  inFlight: 0,
  peak: 0,
  order: [] as string[],
  release: new Map<string, () => void>(),
};

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => {
  return {
    GLTFLoader: class {
      constructor() {
        state.constructed += 1;
      }
      loadAsync(url: string): Promise<{ url: string }> {
        state.order.push(url);
        state.inFlight += 1;
        state.peak = Math.max(state.peak, state.inFlight);
        return new Promise((resolve) => {
          state.release.set(url, () => {
            state.inFlight -= 1;
            resolve({ url });
          });
        });
      }
    },
  };
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function loadModule(): Promise<typeof import('./shapeModelLoader')> {
  vi.resetModules();
  return import('./shapeModelLoader');
}

describe('shapeModelLoader', () => {
  beforeEach(() => {
    state.constructed = 0;
    state.inFlight = 0;
    state.peak = 0;
    state.order = [];
    state.release.clear();
  });

  it('n’instancie qu’UN chargeur pour tous les corps', async () => {
    const { loadShapeGltf } = await loadModule();
    const a = loadShapeGltf('a');
    const b = loadShapeGltf('b');
    await tick();
    state.release.get('a')!();
    state.release.get('b')!();
    await Promise.all([a, b]);
    expect(state.constructed).toBe(1);
  });

  it('ne laisse jamais plus de MAX_PARALLEL fichiers en vol, et sert les suivants dans l’ordre', async () => {
    const { loadShapeGltf, MAX_PARALLEL, shapeLoadState } = await loadModule();
    const done = ['a', 'b', 'c', 'd', 'e'].map((u) => loadShapeGltf(u));
    await tick();
    expect(shapeLoadState().active).toBe(MAX_PARALLEL);
    expect(shapeLoadState().waiting).toBe(5 - MAX_PARALLEL);
    for (const u of ['a', 'b', 'c', 'd', 'e']) {
      for (let i = 0; i < 20 && !state.release.has(u); i++) await tick();
      state.release.get(u)!();
      await tick();
    }
    await Promise.all(done);
    expect(state.peak).toBeLessThanOrEqual(MAX_PARALLEL);
    expect(state.order).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('un chargement urgent (le corps ciblé) passe devant ceux qui attendent', async () => {
    const { loadShapeGltf } = await loadModule();
    const first = [loadShapeGltf('a'), loadShapeGltf('b')];
    const later = [loadShapeGltf('c'), loadShapeGltf('d')];
    const urgent = loadShapeGltf('cible', true);
    await tick();
    state.release.get('a')!();
    await tick();
    // La place libérée va à la cible, pas à « c » qui attendait avant elle.
    expect(state.order.slice(0, 3)).toEqual(['a', 'b', 'cible']);
    for (const u of ['b', 'cible', 'c', 'd']) {
      for (let i = 0; i < 20 && !state.release.has(u); i++) await tick();
      state.release.get(u)!();
      await tick();
    }
    await Promise.all([...first, ...later, urgent]);
  });
});
