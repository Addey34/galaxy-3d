import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearMeteoClientCache, fetchMeteoGrid } from './meteoClient';
import { meteoHourKey } from './meteoTimeTravel';

const now = new Date('2026-08-14T12:00:00Z');
const grid = { step: 90, maxLat: 90 };

function responseFor(
  variable: string
): Array<{ hourly: Record<string, number[]> }> {
  return Array.from({ length: 12 }, (_, index) => ({
    hourly: {
      [variable]: Array.from({ length: 24 }, (_, hour) => index + hour),
    },
  }));
}

afterEach(() => {
  clearMeteoClientCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('meteoHourKey', () => {
  it('normalise une date sur son heure UTC', () => {
    expect(meteoHourKey(new Date('2026-08-14T12:34:56Z'))).toBe(
      '2026-08-14T12'
    );
  });
});

describe('fetchMeteoGrid', () => {
  it('utilise forecast pour le présent et recompose les lots', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseFor('cloud_cover')), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), {
      variable: 'cloud_cover',
      forecastGrid: grid,
      archiveGrid: grid,
      now,
    });

    expect(result.plan.source).toBe('forecast');
    expect(result.grid?.values[0]).toBe(0);
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'api.open-meteo.com'
    );
  });

  it('utilise archive ERA5 et sélectionne l’heure demandée', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseFor('temperature_2m')), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMeteoGrid(new Date('2020-06-01T09:00:00Z'), {
      variable: 'temperature_2m',
      forecastGrid: grid,
      archiveGrid: grid,
      now,
    });

    expect(result.plan.source).toBe('archive');
    expect(result.grid?.values[0]).toBe(9);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'archive-api.open-meteo.com'
    );
  });

  it('ne requête rien hors de la plage temporelle', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMeteoGrid(new Date('1900-01-01T00:00:00Z'), {
      variable: 'cloud_cover',
      forecastGrid: grid,
      archiveGrid: grid,
      now,
    });

    expect(result.grid).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('réessaie après un 429 puis réussit sans changer la grille', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '0' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responseFor('pressure_msl')), {
          status: 200,
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), {
      variable: 'pressure_msl',
      forecastGrid: grid,
      archiveGrid: grid,
      now,
      network: { baseDelayMs: 0, sleep: async () => undefined },
    });

    expect(result.grid?.values[0]).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborte le fetch réseau quand son seul consommateur est annulé', async () => {
    const controller = new AbortController();
    const networkSignals: AbortSignal[] = [];
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal))
            throw new Error('signal réseau manquant');
          networkSignals.push(signal);
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), {
      variable: 'cloud_cover',
      forecastGrid: grid,
      archiveGrid: grid,
      now,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(networkSignals.length).toBeGreaterThan(0);
    expect(networkSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it('garde un fetch partagé vivant tant qu’un autre consommateur l’attend', async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const networkSignals: AbortSignal[] = [];
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal))
            throw new Error('signal réseau manquant');
          networkSignals.push(signal);
          resolvers.push(resolve);
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const baseOptions = {
      variable: 'cloud_cover',
      forecastGrid: grid,
      archiveGrid: grid,
      now,
      network: { cacheTtlMs: 0 },
    };
    const first = fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), {
      ...baseOptions,
      signal: firstController.signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    const networkCallCount = fetchMock.mock.calls.length;

    const second = fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), {
      ...baseOptions,
      signal: secondController.signal,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(networkCallCount);
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(networkSignals.every((signal) => !signal.aborted)).toBe(true);

    for (const resolve of resolvers)
      resolve(
        new Response(JSON.stringify(responseFor('cloud_cover')), {
          status: 200,
        })
      );

    await expect(second).resolves.toMatchObject({
      plan: { source: 'forecast' },
    });
  });

  it('déduplique une réponse réussie encore en cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseFor('relative_humidity_2m')), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const options = {
      variable: 'relative_humidity_2m',
      forecastGrid: grid,
      archiveGrid: grid,
      now,
      network: { cacheTtlMs: 60_000 },
    };

    await fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), options);
    await fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), options);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
