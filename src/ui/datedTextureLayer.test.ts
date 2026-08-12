import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createDatedTextureLayer } from './datedTextureLayer';
import type { PublicAPI } from '@/SolarSystemApp';

/**
 * Faux `api` minimal : le socle n'utilise que `orbitalMechanics.simulationDate` et
 * `animationSystem.onFrame`. `tick()` déclenche manuellement les callbacks de frame ;
 * `date` est mutable pour simuler le time-travel.
 */
function makeApi(initialDate: Date) {
  const frameCbs = new Set<() => void>();
  const state = { date: initialDate };
  const api = {
    orbitalMechanics: {
      get simulationDate() {
        return state.date;
      },
    },
    animationSystem: {
      onFrame(cb: () => void) {
        frameCbs.add(cb);
        return () => frameCbs.delete(cb);
      },
    },
  } as unknown as PublicAPI;
  return {
    api,
    setDate: (d: Date) => {
      state.date = d;
    },
    tick: () => frameCbs.forEach((cb) => cb()),
    frameCount: () => frameCbs.size,
  };
}

// Avance le throttle interne (checkIntervalMs) : performance.now est réel, donc on
// utilise checkIntervalMs:0 dans les tests pour ne pas dépendre du temps.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createDatedTextureLayer', () => {
  it('is inert when disabled', () => {
    const { api } = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    const cleanup = createDatedTextureLayer(api, {
      name: 'Test',
      enabled: false,
      keyForDate: () => 'k',
      urlForKey: () => 'u',
      apply,
      loadTexture: async () => new THREE.Texture(),
    });
    expect(apply).not.toHaveBeenCalled();
    cleanup();
  });

  it('loads and applies the image for the initial date', async () => {
    const { api } = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    const load = vi.fn(async () => new THREE.Texture());
    const cleanup = createDatedTextureLayer(api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 10),
      urlForKey: (k) => `https://x/${k}`,
      apply,
      loadTexture: load,
      checkIntervalMs: 0,
    });
    await flush();
    expect(load).toHaveBeenCalledWith('https://x/2026-08-09');
    expect(apply).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('does not refetch while the key is unchanged', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const load = vi.fn(async () => new THREE.Texture());
    const cleanup = createDatedTextureLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 10), // clé = jour
      urlForKey: (k) => k,
      apply: vi.fn(),
      loadTexture: load,
      checkIntervalMs: 0,
    });
    await flush();
    // Avance de quelques heures le MÊME jour → même clé → pas de nouveau fetch.
    ctrl.setDate(new Date('2026-08-09T18:00:00Z'));
    ctrl.tick();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('refetches and reapplies when the key changes (time-travel)', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    const load = vi.fn(async () => new THREE.Texture());
    const cleanup = createDatedTextureLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 10),
      urlForKey: (k) => k,
      apply,
      loadTexture: load,
      checkIntervalMs: 0,
    });
    await flush();
    ctrl.setDate(new Date('2021-01-15T10:00:00Z')); // autre jour
    ctrl.tick();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('does nothing (no throw) when the key is out of range (null)', async () => {
    const { api } = makeApi(new Date('1990-01-01T00:00:00Z'));
    const apply = vi.fn();
    const load = vi.fn(async () => new THREE.Texture());
    const cleanup = createDatedTextureLayer(api, {
      name: 'Test',
      enabled: true,
      keyForDate: () => null, // hors plage
      urlForKey: (k) => k,
      apply,
      loadTexture: load,
      checkIntervalMs: 0,
    });
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    cleanup();
  });

  it('falls back silently on load error and retries on next key', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(new THREE.Texture());
    const cleanup = createDatedTextureLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 10),
      urlForKey: (k) => k,
      apply,
      loadTexture: load,
      checkIntervalMs: 0,
    });
    await flush();
    expect(apply).not.toHaveBeenCalled(); // 1er échec → rien d'appliqué
    // nouvelle date → nouvelle tentative qui réussit
    ctrl.setDate(new Date('2021-01-15T10:00:00Z'));
    ctrl.tick();
    await flush();
    expect(apply).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('prefetches neighbour keys', async () => {
    const { api } = makeApi(new Date('2026-08-09T10:00:00Z'));
    const loaded: string[] = [];
    const load = vi.fn(async (url: string) => {
      loaded.push(url);
      return new THREE.Texture();
    });
    const cleanup = createDatedTextureLayer(api, {
      name: 'Test',
      enabled: true,
      keyForDate: () => 'A',
      urlForKey: (k) => k,
      apply: vi.fn(),
      loadTexture: load,
      prefetchKeys: () => ['B'],
      checkIntervalMs: 0,
    });
    await flush();
    expect(loaded).toContain('A');
    expect(loaded).toContain('B');
    cleanup();
  });

  it('cleanup disposes cached textures and unsubscribes', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const tex = new THREE.Texture();
    const dispose = vi.spyOn(tex, 'dispose');
    const cleanup = createDatedTextureLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 10),
      urlForKey: (k) => k,
      apply: vi.fn(),
      loadTexture: async () => tex,
      checkIntervalMs: 0,
    });
    await flush();
    expect(ctrl.frameCount()).toBe(1);
    cleanup();
    expect(dispose).toHaveBeenCalled();
    expect(ctrl.frameCount()).toBe(0);
  });
});
