import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAPI } from '@/SolarSystemApp';
import type { ScalarGrid } from '@/core/meteoGrid';
import type { ScalarReading } from '@/core/meteoInspect';

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

describe('setupMeteoModelLayer : inspection d’un point (GAL-METEO-INSPECT-002)', () => {
  const HOUR = 3_600_000;
  const temperatures: ScalarGrid = {
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat: 3,
    nLon: 4,
    values: Float32Array.from([5, 5, 5, 5, 10, 20, 30, 40, 7, 7, 7, 7]),
  };
  const product = (d: Date) => ({
    kind: 'forecastModel' as const,
    validTime: { from: d.getTime(), to: d.getTime() },
    offsetToleranceMs: HOUR,
  });
  const served = (d: Date, extra: Record<string, unknown> = {}) => ({
    grid: temperatures,
    plan: { source: 'forecast', outOfRange: false, product: product(d) },
    realDate: d.toISOString(),
    ...extra,
  });
  const inspecting = { inspect: { variable: 'temperature', unit: '°C' } };

  beforeEach(() => {
    clock = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    fetchMeteoGrid.mockReset();
    fetchMeteoGrid.mockImplementation(async (d: Date) => served(d));
  });

  it('une couche non inspectable n’expose pas de lecture', () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    expect(make(t.api, makeEarth()).inspect).toBeUndefined();
  });

  it('masquée : `inactive`, et l’inspection ne l’active ni ne charge rien', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const earth = makeEarth();
    const layer = make(t.api, earth, inspecting);
    for (let i = 0; i < 5; i++)
      expect(layer.inspect!(0, -90)).toMatchObject({
        availability: 'inactive',
        value: null,
      });
    await flush();
    expect(fetchMeteoGrid).not.toHaveBeenCalled();
    expect(earth.setDataOverlay).not.toHaveBeenCalled();
    expect(earth.setLayerVisible).not.toHaveBeenCalled();
    expect(t.frames()).toBe(0);
  });

  it('active et chargée : la valeur, sa provenance, et AUCUNE requête de plus par lecture', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = make(t.api, makeEarth(), inspecting);
    layer.setVisible(true);
    await flush();
    expect(fetchMeteoGrid).toHaveBeenCalledTimes(1);
    const r = layer.inspect!(0, -90);
    expect(r).toMatchObject({
      availability: 'available',
      value: 20,
      unit: '°C',
      provenance: {
        provider: 'Open-Meteo',
        requestedHour: '2026-11-18T10:00:00.000Z',
        effectiveOffsetMs: 0,
        stepDegrees: 90,
      },
    });
    for (let i = 0; i < 50; i++) layer.inspect!(i - 25, i * 7);
    expect(fetchMeteoGrid).toHaveBeenCalledTimes(1);
  });

  it('avant la première réponse : `noData` (non chargée)', () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    fetchMeteoGrid.mockImplementation(() => new Promise(() => {}));
    const layer = make(t.api, makeEarth(), inspecting);
    layer.setVisible(true);
    expect(layer.inspect!(0, 0)).toMatchObject({
      availability: 'noData',
      emptyReason: 'notLoaded',
      value: null,
    });
  });

  it('changement de date avec chargement en cours : l’ancienne grille est `stale`, puis la nouvelle', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = make(t.api, makeEarth(), inspecting);
    layer.setVisible(true);
    await flush();
    expect(layer.inspect!(0, -90).availability).toBe('available');

    let resolveNext!: (v: unknown) => void;
    fetchMeteoGrid.mockImplementationOnce(
      () => new Promise((resolve) => (resolveNext = resolve))
    );
    t.setDate(new Date('2026-11-18T14:00:00Z'));
    t.tick();
    await flush(); // la requête part (de façon asynchrone) et reste en attente
    const during = layer.inspect!(0, -90);
    expect(during).toMatchObject({ availability: 'stale', value: null });
    expect(during.provenance?.requestedHour).toBe('2026-11-18T10:00:00.000Z');

    resolveNext(served(new Date('2026-11-18T14:00:00Z')));
    await flush();
    expect(layer.inspect!(0, -90)).toMatchObject({
      availability: 'available',
      provenance: { requestedHour: '2026-11-18T14:00:00.000Z' },
    });
  });

  it('réponse TARDIVE d’une date abandonnée : ignorée, jamais lue comme actuelle', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const resolvers: Array<(v: unknown) => void> = [];
    fetchMeteoGrid.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    );
    const layer = make(t.api, makeEarth(), inspecting);
    layer.setVisible(true);
    await flush();
    t.setDate(new Date('2026-11-18T15:00:00Z'));
    t.tick();
    await flush();
    expect(resolvers.length).toBe(2);

    resolvers[0]!(served(new Date('2026-11-18T10:00:00Z')));
    await flush();
    expect(layer.inspect!(0, -90)).toMatchObject({
      availability: 'noData',
      value: null,
    });
    resolvers[1]!(served(new Date('2026-11-18T15:00:00Z')));
    await flush();
    expect(layer.inspect!(0, -90)).toMatchObject({
      availability: 'available',
      provenance: { requestedHour: '2026-11-18T15:00:00.000Z' },
    });
  });

  it('ancienne grille gardée après un ÉCHEC : `stale`, phase `error`, jamais présentée comme actuelle', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = make(t.api, makeEarth(), inspecting);
    layer.setVisible(true);
    await flush();
    fetchMeteoGrid.mockRejectedValueOnce(new Error('HTTP 429'));
    t.setDate(new Date('2026-11-18T16:00:00Z'));
    t.tick();
    await flush();
    expect(layer.inspect!(0, -90)).toMatchObject({
      availability: 'stale',
      phase: 'error',
      value: null,
    });
  });

  it('date hors de la plage du modèle : la grille est LIBÉRÉE, `noData` (hors plage)', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = make(t.api, makeEarth(), inspecting);
    layer.setVisible(true);
    await flush();
    fetchMeteoGrid.mockImplementationOnce(async (d: Date) => ({
      grid: null,
      plan: { source: 'forecast', outOfRange: true, product: null },
      realDate: d.toISOString(),
    }));
    t.setDate(new Date('2031-01-01T00:00:00Z'));
    t.tick();
    await flush();
    expect(layer.inspect!(0, -90)).toMatchObject({
      availability: 'noData',
      emptyReason: 'outOfRange',
      value: null,
      provenance: null,
    });
  });

  it('masquer puis réactiver : `inactive`, puis `stale` si la scène a avancé', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = make(t.api, makeEarth(), inspecting);
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    expect(layer.inspect!(0, -90).availability).toBe('inactive');

    t.setDate(new Date('2026-11-18T13:00:00Z'));
    fetchMeteoGrid.mockImplementationOnce(() => new Promise(() => {}));
    layer.setVisible(true);
    expect(layer.inspect!(0, -90)).toMatchObject({
      availability: 'stale',
      value: null,
    });
  });

  it('GFS : date effective différente de l’heure demandée = `available`, écart porté par la provenance', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    fetchMeteoGrid.mockImplementation(async (d: Date) =>
      served(d, {
        provider: 'NOAA GFS',
        realDate: new Date(d.getTime() + 2 * HOUR).toISOString(),
      })
    );
    const layer = make(t.api, makeEarth(), inspecting);
    layer.setVisible(true);
    await flush();
    expect(layer.inspect!(0, -90)).toMatchObject({
      availability: 'available',
      value: 20,
      provenance: {
        provider: 'NOAA GFS',
        requestedHour: '2026-11-18T10:00:00.000Z',
        effectiveDate: '2026-11-18T12:00:00.000Z',
        effectiveOffsetMs: 2 * HOUR,
      },
    });
  });

  it('précipitation : GFS en mm/h instantané, Open-Meteo en cumul de l’heure précédente', async () => {
    const rain = { inspect: { variable: 'precipitation', unit: 'mm/h' } };
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    fetchMeteoGrid.mockImplementation(async (d: Date) =>
      served(d, { provider: 'NOAA GFS' })
    );
    const gfs = make(t.api, makeEarth(), rain);
    gfs.setVisible(true);
    await flush();
    expect(gfs.inspect!(0, -90)).toMatchObject({
      unit: 'mm/h',
      nature: 'instantRate',
    });

    fetchMeteoGrid.mockImplementation(async (d: Date) => served(d));
    const om = make(t.api, makeEarth(), rain);
    om.setVisible(true);
    await flush();
    expect(om.inspect!(0, -90)).toMatchObject({
      unit: 'mm',
      nature: 'precedingHourAccumulation',
    });
  });

  it('couche à secours (nuages modèle) : lire ne rappelle jamais le secours ni ne touche l’observation', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const applyFallback = vi.fn();
    const earth = makeEarth();
    const layer = make(t.api, earth, {
      applyFallback,
      inspect: { variable: 'cloudCover', unit: '%' },
    });
    layer.setVisible(true);
    await flush();
    const fallbackCalls = applyFallback.mock.calls.length;
    const overlayCalls = earth.setDataOverlay.mock.calls.length;
    const r = layer.inspect!(0, -90);
    expect(r).toMatchObject({
      variable: 'cloudCover',
      availability: 'available',
      provenance: { productKind: 'forecastModel' },
    });
    for (let i = 0; i < 20; i++) layer.inspect!(10, i);
    expect(applyFallback.mock.calls.length).toBe(fallbackCalls);
    expect(earth.setDataOverlay.mock.calls.length).toBe(overlayCalls);
  });

  it('destruction : la grille est libérée, plus aucune valeur', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = make(t.api, makeEarth(), inspecting);
    layer.setVisible(true);
    await flush();
    layer.dispose();
    expect(layer.inspect!(0, -90)).toMatchObject({ value: null });
    expect(layer.inspect!(0, -90).availability).not.toBe('available');
  });

  it('remplacement de grille : la lecture suit la nouvelle, sans trace de l’ancienne', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = make(t.api, makeEarth(), inspecting);
    layer.setVisible(true);
    await flush();
    expect((layer.inspect!(0, -90) as ScalarReading).value).toBe(20);
    const next: ScalarGrid = {
      ...temperatures,
      values: Float32Array.from([1, 1, 1, 1, 2, 3, 4, 5, 6, 6, 6, 6]),
    };
    fetchMeteoGrid.mockImplementationOnce(async (d: Date) => ({
      ...served(d),
      grid: next,
    }));
    t.setDate(new Date('2026-11-18T11:00:00Z'));
    t.tick();
    await flush();
    expect((layer.inspect!(0, -90) as ScalarReading).value).toBe(3);
  });
});

describe('cohérence rendu/inspection avec une date effective GFS décalée (GAL-METEO-INSPECT-002)', () => {
  const HOUR = 3_600_000;
  const g: ScalarGrid = {
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat: 3,
    nLon: 4,
    values: Float32Array.from([5, 5, 5, 5, 10, 20, 30, 40, 7, 7, 7, 7]),
  };
  const gfs = async (d: Date) => ({
    grid: g,
    provider: 'NOAA GFS',
    plan: {
      source: 'forecast',
      outOfRange: false,
      product: {
        kind: 'forecastModel' as const,
        validTime: { from: d.getTime(), to: d.getTime() },
        offsetToleranceMs: HOUR,
      },
    },
    realDate: new Date(d.getTime() + 3 * HOUR).toISOString(),
  });
  const inspecting = { inspect: { variable: 'temperature', unit: '°C' } };

  beforeEach(() => {
    clock = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    fetchMeteoGrid.mockReset();
    fetchMeteoGrid.mockImplementation(gfs);
  });

  it('même heure demandée : le rendu réutilise la texture et la lecture reste disponible', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const earth = makeEarth();
    const layer = make(t.api, earth, inspecting);
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    earth.setLayerVisible.mockClear();
    fetchMeteoGrid.mockImplementationOnce(() => new Promise(() => {}));
    layer.setVisible(true);
    expect(earth.setLayerVisible).toHaveBeenCalledWith('thermal', true);
    expect(layer.inspect!(0, -90)).toMatchObject({
      availability: 'available',
      value: 20,
    });
  });

  it('heure effective (différente de la demandée) : ni rendu ni lecture de l’ancienne donnée', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const earth = makeEarth();
    const layer = make(t.api, earth, inspecting);
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    t.setDate(new Date('2026-11-18T13:00:00Z')); // = realDate de la grille gardée
    earth.setLayerVisible.mockClear();
    fetchMeteoGrid.mockImplementationOnce(() => new Promise(() => {}));
    layer.setVisible(true);
    expect(earth.setLayerVisible).not.toHaveBeenCalledWith('thermal', true);
    expect(layer.inspect!(0, -90)).toMatchObject({
      availability: 'stale',
      value: null,
    });
  });

  it('retour à l’heure demandée initialement : la donnée redevient réutilisable des deux côtés', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const earth = makeEarth();
    const layer = make(t.api, earth, inspecting);
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    t.setDate(new Date('2026-11-18T13:00:00Z'));
    fetchMeteoGrid.mockImplementationOnce(() => new Promise(() => {}));
    layer.setVisible(true); // réactivation intermédiaire, réponse différée
    layer.setVisible(false);
    t.setDate(new Date('2026-11-18T10:00:00Z'));
    earth.setLayerVisible.mockClear();
    fetchMeteoGrid.mockImplementationOnce(() => new Promise(() => {}));
    layer.setVisible(true);
    expect(earth.setLayerVisible).toHaveBeenCalledWith('thermal', true);
    expect(layer.inspect!(0, -90)).toMatchObject({
      availability: 'available',
      value: 20,
    });
  });
});
