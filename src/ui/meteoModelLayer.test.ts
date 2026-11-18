import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAPI } from '@/SolarSystemApp';
import type { ScalarGrid } from '@/core/meteoGrid';

const fetchMeteoGrid = vi.hoisted(() => vi.fn());
vi.mock('@/core/meteoClient', () => ({ fetchMeteoGrid }));

import { setupMeteoModelLayer } from './meteoModelLayer';

const grid: ScalarGrid = {
  step: 90,
  latMin: -90,
  lonMin: -180,
  nLat: 3,
  nLon: 4,
  values: new Float32Array(12),
};
const dataFor = (date: Date) => ({
  grid,
  plan: { source: 'forecast', outOfRange: false, product: null },
  realDate: date.toISOString(),
});

/** Horloge simulée : le socle ne réévalue la date qu'une fois par seconde. */
let clock = 10_000;
function makeApi(initial: Date) {
  const frameCbs = new Set<() => void>();
  const state = { date: initial };
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
    tick: () => {
      clock += 2000;
      frameCbs.forEach((cb) => cb());
    },
    frames: () => frameCbs.size,
  };
}

function makeEarth() {
  return {
    setDataOverlay: vi.fn(),
    setLayerVisible: vi.fn(),
    restoreLayerMaterial: vi.fn(),
    getLayerDiagnostics: vi.fn(() => ({ exists: true, visible: true })),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const encode = () => ({
  data: new Uint8ClampedArray(12 * 4),
  width: 4,
  height: 3,
});
const make = (
  api: PublicAPI,
  earth: ReturnType<typeof makeEarth>,
  extra = {}
) =>
  setupMeteoModelLayer(
    api,
    earth as unknown as Parameters<typeof setupMeteoModelLayer>[1],
    {
      id: 'thermal-model',
      labelKey: 'x',
      variable: 'temperature_2m',
      forecastGrid: { step: 90 },
      archiveGrid: { step: 90 },
      opacity: 0.7,
      targetLayer: 'thermal',
      encodeGrid: encode,
      ...extra,
    }
  )!;

describe('setupMeteoModelLayer : couche masquée et réactivation', () => {
  beforeEach(() => {
    clock = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    fetchMeteoGrid.mockReset();
    fetchMeteoGrid.mockImplementation(async (d: Date) => dataFor(d));
  });

  it('ne demande plus rien une fois masquée', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = make(t.api, makeEarth());
    layer.setVisible(true);
    await flush();
    expect(fetchMeteoGrid).toHaveBeenCalledTimes(1);

    layer.setVisible(false);
    expect(t.frames()).toBe(0);
    t.setDate(new Date('2026-11-18T14:00:00Z'));
    t.tick();
    await flush();
    expect(fetchMeteoGrid).toHaveBeenCalledTimes(1);
  });

  it('une couche à secours (applyFallback) continue de charger masquée', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = make(t.api, makeEarth(), { applyFallback: vi.fn() });
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    expect(t.frames()).toBe(1);
  });

  it('une couche background charge sans être visible', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = make(t.api, makeEarth(), { background: true });
    await flush();
    expect(fetchMeteoGrid).toHaveBeenCalledTimes(1);
    layer.setVisible(false);
    expect(t.frames()).toBe(1);
  });

  it("à la réactivation, n'affiche pas la texture d'une autre heure", async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const earth = makeEarth();
    const layer = make(t.api, earth);
    layer.setVisible(true);
    await flush();
    expect(earth.setLayerVisible).toHaveBeenLastCalledWith('thermal', true);

    layer.setVisible(false);
    t.setDate(new Date('2026-11-18T14:00:00Z'));
    earth.setDataOverlay.mockClear();
    earth.setLayerVisible.mockClear();
    let release!: () => void;
    fetchMeteoGrid.mockImplementationOnce(
      (d: Date) =>
        new Promise((r) => {
          release = () => r(dataFor(d));
        })
    );
    layer.setVisible(true);
    await flush();
    // Donnée de 10 h encore en mémoire, scène à 14 h : rien n'est montré.
    expect(earth.setDataOverlay).not.toHaveBeenCalled();
    expect(earth.setLayerVisible).not.toHaveBeenCalledWith('thermal', true);

    release();
    await flush();
    expect(earth.setLayerVisible).toHaveBeenLastCalledWith('thermal', true);
  });

  it('à la réactivation sur la même heure, montre aussitôt la texture', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const earth = makeEarth();
    const layer = make(t.api, earth);
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    earth.setLayerVisible.mockClear();
    layer.setVisible(true);
    expect(earth.setLayerVisible).toHaveBeenCalledWith('thermal', true);
  });

  it("une réponse tardive arrivée après le masquage n'est pas affichée", async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const earth = makeEarth();
    const layer = make(t.api, earth);
    let release!: () => void;
    fetchMeteoGrid.mockImplementationOnce(
      (d: Date) =>
        new Promise((r) => {
          release = () => r(dataFor(d));
        })
    );
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    release();
    await flush();
    expect(earth.setDataOverlay).not.toHaveBeenCalled();
    expect(earth.setLayerVisible).not.toHaveBeenCalledWith('thermal', true);
  });
});
