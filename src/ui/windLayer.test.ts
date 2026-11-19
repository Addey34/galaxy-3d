import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAPI } from '@/SolarSystemApp';
import type { ScalarGrid } from '@/core/meteoGrid';
import type { WindReading } from '@/core/meteoInspect';

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

describe('setupWindLayer : inspection d’un point (GAL-METEO-INSPECT-002)', () => {
  const HOUR = 3_600_000;
  const filled = (v: number): ScalarGrid => ({
    ...grid(),
    values: new Float32Array(12).fill(v),
  });
  /** Vent d'ouest de 10 km/h partout (direction 270°). */
  const west = (d: Date, extra: Record<string, unknown> = {}) => ({
    grids: { wind_speed_10m: filled(10), wind_direction_10m: filled(270) },
    plan: { source: 'forecast', outOfRange: false, product: null },
    realDate: d.toISOString(),
    ...extra,
  });

  beforeEach(() => {
    clock = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    particles.last = null;
    fetchMeteoGrids.mockReset();
    fetchMeteoGrids.mockImplementation(async (d: Date) => west(d));
  });

  it('éteinte : `inactive`, et lire ne charge ni n’active rien', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    for (let i = 0; i < 5; i++)
      expect(layer.inspect!(0, 0)).toMatchObject({
        kind: 'wind',
        availability: 'inactive',
        speedKmh: null,
        directionDeg: null,
      });
    t.tick();
    await flush();
    expect(fetchMeteoGrids).not.toHaveBeenCalled();
    expect(particles.last).toBeNull(); // pas même de particules créées
  });

  it('champ valide : vitesse, direction (d’où vient l’air) et provenance', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    const r = layer.inspect!(20, 30) as WindReading;
    expect(r).toMatchObject({
      availability: 'available',
      calm: false,
      provenance: {
        provider: 'Open-Meteo',
        requestedHour: '2026-11-18T10:00:00.000Z',
        effectiveOffsetMs: 0,
        stepDegrees: 90,
      },
    });
    expect(r.speedKmh).toBeCloseTo(10, 4);
    expect(r.directionDeg).toBeCloseTo(270, 3);
  });

  it('vrai champ de calme (vitesses nulles, direction absente) : disponible, sans direction', async () => {
    fetchMeteoGrids.mockImplementation(async (d: Date) => ({
      ...west(d),
      grids: {
        wind_speed_10m: filled(0),
        wind_direction_10m: filled(Number.NaN),
      },
    }));
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    expect(layer.inspect!(10, 10)).toMatchObject({
      availability: 'available',
      speedKmh: 0,
      directionDeg: null,
      calm: true,
    });
  });

  it('champ composé entièrement inconnu : la couche est en erreur, rien n’est lisible', async () => {
    fetchMeteoGrids.mockImplementation(async (d: Date) => ({
      ...west(d),
      grids: {
        wind_speed_10m: filled(5),
        wind_direction_10m: filled(Number.NaN),
      },
    }));
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    expect(layer.inspect!(0, 0)).toMatchObject({
      availability: 'noData',
      phase: 'error',
      speedKmh: null,
    });
  });

  it('changement d’heure : `stale` pendant le chargement, puis la grille neuve', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    let release!: () => void;
    fetchMeteoGrids.mockImplementationOnce(
      (d: Date) =>
        new Promise((r) => {
          release = () => r(west(d));
        })
    );
    t.setDate(new Date('2026-11-18T14:00:00Z'));
    t.tick();
    await flush();
    expect(layer.inspect!(0, 0)).toMatchObject({
      availability: 'stale',
      speedKmh: null,
      directionDeg: null,
    });
    release();
    await flush();
    expect(layer.inspect!(0, 0)).toMatchObject({
      availability: 'available',
      provenance: { requestedHour: '2026-11-18T14:00:00.000Z' },
    });
  });

  it('ancienne grille conservée après un ÉCHEC : `stale`, phase `error`', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    fetchMeteoGrids.mockRejectedValueOnce(new Error('HTTP 429'));
    t.setDate(new Date('2026-11-18T16:00:00Z'));
    t.tick();
    await flush();
    expect(layer.inspect!(0, 0)).toMatchObject({
      availability: 'stale',
      phase: 'error',
      speedKmh: null,
    });
  });

  it('réponse TARDIVE d’une date abandonnée : ignorée', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const resolvers: Array<(v: unknown) => void> = [];
    fetchMeteoGrids.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    );
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    t.setDate(new Date('2026-11-18T15:00:00Z'));
    t.tick();
    await flush();
    expect(resolvers.length).toBe(2);
    resolvers[0]!(west(new Date('2026-11-18T10:00:00Z')));
    await flush();
    expect(layer.inspect!(0, 0)).toMatchObject({
      availability: 'noData',
      speedKmh: null,
    });
    resolvers[1]!(west(new Date('2026-11-18T15:00:00Z')));
    await flush();
    expect(layer.inspect!(0, 0)).toMatchObject({
      availability: 'available',
      provenance: { requestedHour: '2026-11-18T15:00:00.000Z' },
    });
  });

  it('GFS : date effective différente de l’heure demandée = disponible, écart dans la provenance', async () => {
    fetchMeteoGrids.mockImplementation(async (d: Date) =>
      west(d, {
        provider: 'NOAA GFS',
        realDate: new Date(d.getTime() + 3 * HOUR).toISOString(),
      })
    );
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    expect(layer.inspect!(0, 0)).toMatchObject({
      availability: 'available',
      provenance: {
        provider: 'NOAA GFS',
        requestedHour: '2026-11-18T10:00:00.000Z',
        effectiveDate: '2026-11-18T13:00:00.000Z',
        effectiveOffsetMs: 3 * HOUR,
      },
    });
  });

  it('date hors de la plage du modèle : aucune grille, `noData` (hors plage)', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    fetchMeteoGrids.mockImplementationOnce(async (d: Date) => ({
      grids: null,
      plan: { source: 'forecast', outOfRange: true, product: null },
      realDate: d.toISOString(),
    }));
    t.setDate(new Date('2031-01-01T00:00:00Z'));
    t.tick();
    await flush();
    expect(layer.inspect!(0, 0)).toMatchObject({
      availability: 'noData',
      emptyReason: 'outOfRange',
      provenance: null,
    });
  });

  it('masquée : `inactive`, la grille ne se lit plus ; réactivée à une autre heure : `stale`', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    expect(layer.inspect!(0, 0).availability).toBe('inactive');
    t.setDate(new Date('2026-11-18T13:00:00Z'));
    fetchMeteoGrids.mockImplementationOnce(() => new Promise(() => {}));
    layer.setVisible(true);
    expect(layer.inspect!(0, 0).availability).toBe('stale');
  });

  it('aucune requête de plus par lecture', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    expect(fetchMeteoGrids).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 50; i++) layer.inspect!(i - 25, i * 7);
    t.tick();
    await flush();
    expect(fetchMeteoGrids).toHaveBeenCalledTimes(1);
  });

  it('la lecture est celle de la grille APPLIQUÉE : un autre champ se lit aussitôt', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    expect((layer.inspect!(0, 0) as WindReading).directionDeg).toBeCloseTo(
      270,
      3
    );
    fetchMeteoGrids.mockImplementationOnce(async (d: Date) => ({
      ...west(d),
      grids: { wind_speed_10m: filled(20), wind_direction_10m: filled(0) },
    }));
    t.setDate(new Date('2026-11-18T11:00:00Z'));
    t.tick();
    await flush();
    const r = layer.inspect!(0, 0) as WindReading;
    expect(r.speedKmh).toBeCloseTo(20, 4);
    expect(
      r.directionDeg === null
        ? 0
        : Math.min(r.directionDeg, 360 - r.directionDeg)
    ).toBeLessThan(0.01);
  });

  it('destruction : la grille est libérée, plus aucune valeur', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    layer.dispose();
    const r = layer.inspect!(0, 0);
    expect(r.availability).not.toBe('available');
    expect(r).toMatchObject({ speedKmh: null, directionDeg: null });
  });
});

describe('cohérence rendu/inspection avec une date effective GFS décalée (GAL-METEO-INSPECT-002)', () => {
  const HOUR = 3_600_000;
  const filled = (v: number): ScalarGrid => ({
    ...grid(),
    values: new Float32Array(12).fill(v),
  });
  const gfsWind = async (d: Date) => ({
    grids: { wind_speed_10m: filled(10), wind_direction_10m: filled(270) },
    provider: 'NOAA GFS',
    plan: { source: 'forecast', outOfRange: false, product: null },
    realDate: new Date(d.getTime() + 3 * HOUR).toISOString(),
  });

  beforeEach(() => {
    clock = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    particles.last = null;
    fetchMeteoGrids.mockReset();
    fetchMeteoGrids.mockImplementation(gfsWind);
  });

  it('même heure demandée : particules aussitôt visibles et lecture disponible', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    fetchMeteoGrids.mockImplementationOnce(() => new Promise(() => {}));
    layer.setVisible(true);
    expect(shown()).toBe(true);
    expect(layer.inspect!(0, 0)).toMatchObject({ availability: 'available' });
  });

  it('heure effective : particules masquées et lecture `stale`, jamais l’ancienne grille', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    t.setDate(new Date('2026-11-18T13:00:00Z'));
    fetchMeteoGrids.mockImplementationOnce(() => new Promise(() => {}));
    layer.setVisible(true);
    expect(shown()).toBe(false);
    expect(layer.inspect!(0, 0)).toMatchObject({
      availability: 'stale',
      speedKmh: null,
    });
  });

  it('retour à l’heure demandée initialement après une réactivation intermédiaire', async () => {
    const t = makeApi(new Date('2026-11-18T10:00:00Z'));
    const layer = setupWindLayer(t.api)!;
    layer.setVisible(true);
    await flush();
    layer.setVisible(false);
    t.setDate(new Date('2026-11-18T13:00:00Z'));
    fetchMeteoGrids.mockImplementationOnce(() => new Promise(() => {}));
    layer.setVisible(true);
    layer.setVisible(false);
    t.setDate(new Date('2026-11-18T10:00:00Z'));
    fetchMeteoGrids.mockImplementationOnce(() => new Promise(() => {}));
    layer.setVisible(true);
    expect(shown()).toBe(true);
    expect(layer.inspect!(0, 0).availability).toBe('available');
  });
});
