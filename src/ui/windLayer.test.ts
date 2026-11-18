import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAPI } from '@/SolarSystemApp';
import type { ScalarGrid } from '@/core/meteoGrid';

const fetchMeteoGrids = vi.hoisted(() => vi.fn());
vi.mock('@/core/meteoClient', () => ({ fetchMeteoGrids }));

const particles = vi.hoisted(() => ({
  last: null as null | { points: { visible: boolean } },
}));
vi.mock('@/components/celestial/WindParticles', () => ({
  WindParticles: class {
    points = { visible: false, removeFromParent: () => {} };
    constructor() {
      particles.last = this;
    }
    update() {}
    dispose() {}
  },
}));

import { setupWindLayer } from './windLayer';

const grid = (): ScalarGrid => ({
  step: 90,
  latMin: -90,
  lonMin: -180,
  nLat: 3,
  nLon: 4,
  values: new Float32Array(12).fill(10),
});
const dataFor = (date: Date) => ({
  grids: { wind_speed_10m: grid(), wind_direction_10m: grid() },
  plan: { source: 'forecast', outOfRange: false, product: null },
  realDate: date.toISOString(),
});

/** Horloge simulée : le socle ne réévalue la date qu'une fois par seconde. */
let clock = 10_000;
function makeApi(initial: Date) {
  const frameCbs = new Set<() => void>();
  const state = { date: initial };
  const earth = {
    layerRadius: 1,
    attachSpinningChild: vi.fn(),
  };
  const api = {
    sceneSystem: { getBody: () => earth },
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
    tick: () => {
      clock += 2000;
      frameCbs.forEach((cb) => cb());
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const shown = () => particles.last?.points.visible;

describe('setupWindLayer : couche masquée et réactivation', () => {
  beforeEach(() => {
    clock = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    particles.last = null;
    fetchMeteoGrids.mockReset();
    fetchMeteoGrids.mockImplementation(async (d: Date) => dataFor(d));
  });

  it('ne demande rien éteinte, ni une fois masquée', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    t.tick();
    await flush();
    expect(fetchMeteoGrids).not.toHaveBeenCalled();

    layer.setVisible(true);
    await flush();
    expect(fetchMeteoGrids).toHaveBeenCalledTimes(1);
    expect(shown()).toBe(true);

    layer.setVisible(false);
    t.setDate(new Date('2026-11-18T14:00:00Z'));
    t.tick();
    await flush();
    expect(fetchMeteoGrids).toHaveBeenCalledTimes(1);
    expect(shown()).toBe(false);
  });

  it('à la réactivation sur la même heure, montre aussitôt les particules', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    layer.setVisible(true);
    expect(shown()).toBe(true);
  });

  it("à la réactivation après changement d'heure, masque jusqu'à la donnée neuve", async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    t.setDate(new Date('2026-11-18T14:00:00Z'));
    let release!: () => void;
    fetchMeteoGrids.mockImplementationOnce(
      (d: Date) =>
        new Promise((r) => {
          release = () => r(dataFor(d));
        })
    );
    layer.setVisible(true);
    await flush();
    expect(shown()).toBe(false);
    release();
    await flush();
    expect(shown()).toBe(true);
  });
});
