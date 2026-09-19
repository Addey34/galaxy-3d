import { describe, expect, it, vi } from 'vitest';
import { createDatedDataLayer } from './datedDataLayer';
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

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createDatedDataLayer', () => {
  it('is inert when disabled', () => {
    const { api } = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    const cleanup = createDatedDataLayer(api, {
      name: 'Test',
      enabled: false,
      keyForDate: () => 'k',
      fetchForKey: async () => 42,
      apply,
    });
    expect(apply).not.toHaveBeenCalled();
    cleanup();
  });

  it('fetches and applies the data for the initial date', async () => {
    const { api } = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    const fetchForKey = vi.fn(async (k: string) => `data:${k}`);
    const cleanup = createDatedDataLayer(api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 13), // clé = heure
      fetchForKey,
      apply,
      checkIntervalMs: 0,
    });
    await flush();
    expect(fetchForKey).toHaveBeenCalledWith(
      '2026-08-09T10',
      expect.any(AbortSignal)
    );
    expect(apply).toHaveBeenCalledWith('data:2026-08-09T10');
    cleanup();
  });

  it('does not refetch while the key is unchanged', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const fetchForKey = vi.fn(async () => 1);
    const cleanup = createDatedDataLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 13), // clé = heure
      fetchForKey,
      apply: vi.fn(),
      checkIntervalMs: 0,
    });
    await flush();
    // Avance de quelques minutes la MÊME heure → même clé → pas de nouveau fetch.
    ctrl.setDate(new Date('2026-08-09T10:45:00Z'));
    ctrl.tick();
    await flush();
    expect(fetchForKey).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('refetches and reapplies when the key changes (time-travel)', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    const fetchForKey = vi.fn(async (k: string) => k);
    const cleanup = createDatedDataLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 13),
      fetchForKey,
      apply,
      checkIntervalMs: 0,
    });
    await flush();
    ctrl.setDate(new Date('2021-01-15T08:00:00Z')); // autre heure
    ctrl.tick();
    await flush();
    expect(fetchForKey).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('does nothing (no throw) when the key is out of range (null)', async () => {
    const { api } = makeApi(new Date('1990-01-01T00:00:00Z'));
    const apply = vi.fn();
    const fetchForKey = vi.fn(async () => 1);
    const cleanup = createDatedDataLayer(api, {
      name: 'Test',
      enabled: true,
      keyForDate: () => null,
      fetchForKey,
      apply,
      checkIntervalMs: 0,
    });
    await flush();
    expect(fetchForKey).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    cleanup();
  });

  it('throttles retrying the SAME failed key via backoff', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const fetchForKey = vi.fn().mockRejectedValue(new Error('offline'));
    const cleanup = createDatedDataLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 13),
      fetchForKey,
      apply: vi.fn(),
      checkIntervalMs: 0,
      retry: { baseMs: 60_000, maxMs: 60_000 },
    });
    await flush();
    expect(fetchForKey).toHaveBeenCalledTimes(1);
    ctrl.tick();
    await flush();
    ctrl.tick();
    await flush();
    expect(fetchForKey).toHaveBeenCalledTimes(1); // backoff bloque les ré-essais
    cleanup();
  });

  it('still fetches a DIFFERENT key immediately despite a pending backoff', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    const fetchForKey = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('ok');
    const cleanup = createDatedDataLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 13),
      fetchForKey,
      apply,
      checkIntervalMs: 0,
      retry: { baseMs: 60_000, maxMs: 60_000 },
    });
    await flush();
    expect(apply).not.toHaveBeenCalled();
    ctrl.setDate(new Date('2021-01-15T08:00:00Z')); // autre heure → passe malgré le backoff
    ctrl.tick();
    await flush();
    expect(apply).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('aborts the obsolete request when the simulation key changes', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    let firstSignal: AbortSignal | undefined;

    const fetchForKey = vi.fn((key: string, signal?: AbortSignal) => {
      if (key === '2026-08-09T10') {
        firstSignal = signal;
        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        });
      }
      return Promise.resolve('new');
    });

    const cleanup = createDatedDataLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 13),
      fetchForKey,
      apply,
      checkIntervalMs: 0,
    });

    await flush();
    ctrl.setDate(new Date('2021-01-15T08:00:00Z'));
    ctrl.tick();
    await flush();

    expect(firstSignal?.aborted).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('new');
    cleanup();
  });

  it('ignores a stale rejection from a loader that does not honor AbortSignal', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    const onStateChange = vi.fn();
    let rejectFirst!: (error: Error) => void;

    const fetchForKey = vi.fn((key: string) => {
      if (key === '2026-08-09T10')
        return new Promise<string>((_resolve, reject) => {
          rejectFirst = reject;
        });
      return Promise.resolve('new');
    });

    const cleanup = createDatedDataLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 13),
      fetchForKey,
      apply,
      onStateChange,
      checkIntervalMs: 0,
    });

    await flush();
    ctrl.setDate(new Date('2021-01-15T08:00:00Z'));
    ctrl.tick();
    await flush();
    rejectFirst(new Error('old request failed'));
    await flush();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('new');
    expect(onStateChange).toHaveBeenLastCalledWith('ready');
    cleanup();
  });

  it('cleanup aborts in-flight work and suppresses late callbacks', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const apply = vi.fn();
    const onStateChange = vi.fn();
    let signal: AbortSignal | undefined;
    let resolveLate!: (value: number) => void;

    const fetchForKey = vi.fn((_key: string, requestSignal?: AbortSignal) => {
      signal = requestSignal;
      return new Promise<number>((resolve) => {
        resolveLate = resolve;
      });
    });

    const cleanup = createDatedDataLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 13),
      fetchForKey,
      apply,
      onStateChange,
      checkIntervalMs: 0,
    });

    await flush();
    cleanup();
    resolveLate(42);
    await flush();

    expect(signal?.aborted).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenCalledWith('loading');
    expect(onStateChange).not.toHaveBeenCalledWith('ready');
    expect(onStateChange).not.toHaveBeenCalledWith('error');
    expect(ctrl.frameCount()).toBe(0);
  });

  it('cleanup unsubscribes from the frame loop', async () => {
    const ctrl = makeApi(new Date('2026-08-09T10:00:00Z'));
    const cleanup = createDatedDataLayer(ctrl.api, {
      name: 'Test',
      enabled: true,
      keyForDate: (d) => d.toISOString().slice(0, 13),
      fetchForKey: async () => 1,
      apply: vi.fn(),
      checkIntervalMs: 0,
    });
    await flush();
    expect(ctrl.frameCount()).toBe(1);
    cleanup();
    expect(ctrl.frameCount()).toBe(0);
  });
});
