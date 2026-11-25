import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LE CHARGEMENT PARTAGÉ DES MODÈLES DE FORME (GAL-ENGINE-HEADROOM-001) : un seul `import()` du
 * chargeur, au plus deux fichiers en vol, et la cible d'un vol passe devant.
 */
const state = {
  inFlight: 0,
  peak: 0,
  order: [] as string[],
  release: new Map<string, () => void>(),
};

vi.mock('./shapeGlb', () => {
  class UnsupportedGlb extends Error {}
  return {
    UnsupportedGlb,
    loadShapeGlb(url: string): Promise<{ url: string }> {
      if (url.startsWith('riche'))
        return Promise.reject(new UnsupportedGlb(url));
      state.order.push(url);
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      return new Promise((resolve) => {
        state.release.set(url, () => {
          state.inFlight -= 1;
          resolve({ url });
        });
      });
    },
  };
});

// Le chargeur complet ne sert QUE de repli, pour un fichier hors du sous-ensemble des modèles de forme.
const full = { loads: [] as string[] };
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    loadAsync(url: string): Promise<{ url: string; full: true }> {
      full.loads.push(url);
      return Promise.resolve({ url, full: true });
    }
  },
}));

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function loadModule(): Promise<typeof import('./shapeModelLoader')> {
  vi.resetModules();
  return import('./shapeModelLoader');
}

describe('shapeModelLoader', () => {
  beforeEach(() => {
    state.inFlight = 0;
    state.peak = 0;
    state.order = [];
    state.release.clear();
  });

  it('repasse par le chargeur complet pour un fichier hors du sous-ensemble, et seulement là', async () => {
    const { loadShapeGltf } = await loadModule();
    full.loads = [];
    const rich = (await loadShapeGltf('riche.glb')) as unknown as {
      full?: true;
    };
    expect(rich.full).toBe(true);
    expect(full.loads).toEqual(['riche.glb']);
    const simple = loadShapeGltf('simple.glb');
    await tick();
    state.release.get('simple.glb')!();
    await simple;
    expect(full.loads).toEqual(['riche.glb']);
  });

  it('sert tous les corps par le MÊME lecteur, sans le chargeur complet', async () => {
    const { loadShapeGltf } = await loadModule();
    full.loads = [];
    const a = loadShapeGltf('a');
    const b = loadShapeGltf('b');
    await tick();
    state.release.get('a')!();
    state.release.get('b')!();
    await Promise.all([a, b]);
    expect(state.order).toEqual(['a', 'b']);
    expect(full.loads).toEqual([]);
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
