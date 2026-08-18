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
