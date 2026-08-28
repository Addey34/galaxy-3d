import { describe, expect, it, vi } from 'vitest';
import { runTour, type TourRuntimeHost, type TourScript, type TourSignal } from './tourEngine';

function makeHost(overrides: Partial<TourRuntimeHost> = {}): TourRuntimeHost {
  return {
    flyTo: vi.fn(),
    isFlying: vi.fn(() => false),
    jumpToDate: vi.fn(),
    setTimeScale: vi.fn(),
    waitForAdvance: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function makeSignal(): TourSignal {
  return { cancelled: false, paused: false };
}

const text = { en: 'Caption', fr: 'Légende' };

describe('runTour', () => {
  it('runs every step in order and reports progress via onStepChange', async () => {
    vi.useFakeTimers();
    const host = makeHost();
    const script: TourScript = {
      id: 'demo',
      titleKey: text,
      steps: [
        { kind: 'flyTo', body: 'earth' },
        { kind: 'jumpToDate', date: new Date('2030-01-01T00:00:00Z') },
        { kind: 'setTimeScale', scale: 1000 },
      ],
    };
    const seen: number[] = [];
    const promise = runTour(script, host, (i) => seen.push(i), makeSignal());
    await vi.runAllTimersAsync();
    await promise;

    expect(seen).toEqual([0, 1, 2]);
    expect(host.flyTo).toHaveBeenCalledWith('earth');
    expect(host.jumpToDate).toHaveBeenCalledWith(new Date('2030-01-01T00:00:00Z'));
    expect(host.setTimeScale).toHaveBeenCalledWith(1000);
    vi.useRealTimers();
  });

  it('waits for isFlying() to become false before advancing past a flyTo step', async () => {
    vi.useFakeTimers();
    let flying = true;
    const host = makeHost({ isFlying: () => flying });
    const script: TourScript = {
      id: 'demo',
      titleKey: text,
      steps: [
        { kind: 'flyTo', body: 'moon' },
        { kind: 'setTimeScale', scale: 1 },
      ],
    };
    const seen: number[] = [];
    const promise = runTour(script, host, (i) => seen.push(i), makeSignal());

    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toEqual([0]); // toujours bloqué sur le vol

    flying = false;
    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(seen).toEqual([0, 1]);
    vi.useRealTimers();
  });

  it('stops advancing once cancelled', async () => {
    vi.useFakeTimers();
    const host = makeHost({ isFlying: () => true });
    const script: TourScript = {
      id: 'demo',
      titleKey: text,
      steps: [
        { kind: 'flyTo', body: 'jupiter' },
        { kind: 'setTimeScale', scale: 1 },
      ],
    };
    const signal = makeSignal();
    const seen: number[] = [];
    const promise = runTour(script, host, (i) => seen.push(i), signal);

    await vi.advanceTimersByTimeAsync(200);
    signal.cancelled = true;
    await vi.runAllTimersAsync();
    await promise;

    expect(seen).toEqual([0]);
    expect(host.setTimeScale).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('suspends progress while paused without cancelling an in-flight arrival wait', async () => {
    vi.useFakeTimers();
    let flying = true;
    const host = makeHost({ isFlying: () => flying });
    const script: TourScript = {
      id: 'demo',
      titleKey: text,
      steps: [
        { kind: 'flyTo', body: 'saturn' },
        { kind: 'setTimeScale', scale: 1 },
      ],
    };
    const signal = makeSignal();
    signal.paused = true;
    const seen: number[] = [];
    const promise = runTour(script, host, (i) => seen.push(i), signal);

    // En pause avant même la première étape : rien ne démarre.
    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toEqual([]);

    signal.paused = false;
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toEqual([0]);

    flying = false;
    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(seen).toEqual([0, 1]);
    vi.useRealTimers();
  });

  it('waits on host.waitForAdvance() for a caption without durationMs', async () => {
    let resolveAdvance: () => void = () => {};
    const advance = new Promise<void>((resolve) => {
      resolveAdvance = resolve;
    });
    const host = makeHost({ waitForAdvance: () => advance });
    const script: TourScript = {
      id: 'demo',
      titleKey: text,
      steps: [{ kind: 'caption', text }],
    };
    let done = false;
    const promise = runTour(script, host, () => {}, makeSignal()).then(() => {
      done = true;
    });

    await Promise.resolve();
    expect(done).toBe(false);
    resolveAdvance();
    await promise;
    expect(done).toBe(true);
  });

  it('auto-advances a timed caption after durationMs', async () => {
    vi.useFakeTimers();
    const host = makeHost();
    const script: TourScript = {
      id: 'demo',
      titleKey: text,
      steps: [
        { kind: 'caption', text, durationMs: 500 },
        { kind: 'setTimeScale', scale: 42 },
      ],
    };
    const promise = runTour(script, host, () => {}, makeSignal());
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(host.setTimeScale).toHaveBeenCalledWith(42);
    vi.useRealTimers();
  });
});
