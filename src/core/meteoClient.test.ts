import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearMeteoClientCache,
  fetchMeteoGrid,
  fetchMeteoGrids,
} from './meteoClient';
import { meteoHourIndex } from './meteoGrid';
import { countValidWind, windGridFromScalars } from './windField';
import { meteoHourKey } from './meteoTimeTravel';

const now = new Date('2026-08-14T12:00:00Z');
const grid = { step: 90, maxLat: 90 };

function responseFor(
  variable: string
): Array<{ hourly: Record<string, number[]> }> {
  return Array.from({ length: 12 }, (_, index) => ({
    hourly: {
      // Série aussi longue que la fenêtre demandée (passé + prévision) : une série trop courte
      // rendrait une absence (NaN) à l'heure demandée, et c'est ce que ces tests doivent voir.
      [variable]: Array.from({ length: 24 * 16 }, (_, hour) => index + hour),
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
      skipGalaxyData: true,
    });

    expect(result.plan.source).toBe('forecast');
    // La cellule 0 vaut son indice + l'index horaire demandé : une valeur lue, pas un zéro.
    expect(result.grid?.values[0]).toBe(
      meteoHourIndex(
        new Date('2026-08-14T12:00:00Z'),
        now,
        result.plan.pastDays ?? 0
      )
    );
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
      skipGalaxyData: true,
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
      skipGalaxyData: true,
    });

    expect(result.grid).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('garde un trou en NaN à sa place, sans décaler les cellules suivantes', async () => {
    const body = responseFor('cloud_cover');
    body[3] = { hourly: {} }; // point sans donnée
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
    );
    const result = await fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), {
      variable: 'cloud_cover',
      forecastGrid: grid,
      archiveGrid: grid,
      now,
      skipGalaxyData: true,
    });
    const hour = result.grid!.values[0]!;
    expect(result.grid?.values[3]).toBeNaN();
    expect(result.grid?.values[2]).toBe(2 + hour);
    expect(result.grid?.values[4]).toBe(4 + hour);
  });

  it('refuse une réponse tronquée au lieu de livrer une grille décalée', async () => {
    const body = responseFor('cloud_cover').slice(0, 11);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
    );
    await expect(
      fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), {
        variable: 'cloud_cover',
        forecastGrid: grid,
        archiveGrid: grid,
        now,
        skipGalaxyData: true,
      })
    ).rejects.toThrow(/désalignée/);
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
      skipGalaxyData: true,
      network: { baseDelayMs: 0, sleep: async () => undefined },
    });

    expect(result.grid?.values[0]).toBe(
      meteoHourIndex(
        new Date('2026-08-14T12:00:00Z'),
        now,
        result.plan.pastDays ?? 0
      )
    );
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
      skipGalaxyData: true,
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
      skipGalaxyData: true,
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
      skipGalaxyData: true,
      network: { cacheTtlMs: 60_000 },
    };

    await fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), options);
    await fetchMeteoGrid(new Date('2026-08-14T12:00:00Z'), options);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchMeteoGrids : direction du vent absente (GAL-METEO-DATA-001)', () => {
  const calmBody = (direction: unknown): string =>
    JSON.stringify(
      Array.from({ length: 12 }, () => ({
        hourly: {
          wind_speed_10m: Array(24 * 6).fill(0),
          wind_direction_10m: Array(24 * 6).fill(direction),
        },
      }))
    );
  const run = (optionalVariables?: readonly string[]) =>
    fetchMeteoGrids(new Date('2026-08-14T12:00:00Z'), {
      variables: ['wind_speed_10m', 'wind_direction_10m'],
      forecastGrid: grid,
      archiveGrid: grid,
      now,
      skipGalaxyData: true,
      ...(optionalVariables ? { optionalVariables } : {}),
    });

  it('vitesses toutes nulles, direction nulle partout : acceptée si la direction est facultative, et le champ composé est un vrai calme', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(calmBody(null), { status: 200 }))
    );
    const result = await run(['wind_direction_10m']);
    const speed = result.grids!['wind_speed_10m']!;
    const direction = result.grids!['wind_direction_10m']!;
    expect([...speed.values].every((v) => v === 0)).toBe(true); // zéros préservés
    expect([...direction.values].every(Number.isNaN)).toBe(true);
    const wind = windGridFromScalars(speed, direction);
    expect(countValidWind(wind)).toBe(12);
  });

  it('sans déclaration « facultative », une direction entièrement absente reste refusée', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(calmBody(null), { status: 200 }))
    );
    await expect(run()).rejects.toThrow(/entièrement invalide/);
  });

  it('la vitesse n’est JAMAIS facultative : des vitesses absentes échouent même si la direction l’est', async () => {
    const body = JSON.stringify(
      Array.from({ length: 12 }, () => ({
        hourly: {
          wind_speed_10m: [],
          wind_direction_10m: Array(24 * 6).fill(90),
        },
      }))
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    );
    await expect(run(['wind_direction_10m'])).rejects.toThrow(/wind_speed_10m/);
  });
});

describe('fetchMeteoGrids (le vent, 2026-10-12)', () => {
  it('sert vitesse ET direction d’une seule requête, à l’heure de la scène même à J+3', async () => {
    // Chaque point porte les deux séries, de longueur suffisante pour plusieurs jours.
    const both = Array.from({ length: 12 }, () => ({
      hourly: {
        wind_speed_10m: Array.from({ length: 24 * 6 }, (_, h) => h),
        wind_direction_10m: Array.from({ length: 24 * 6 }, (_, h) => 1000 + h),
      },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(both), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const scene = new Date('2026-08-17T06:00:00Z'); // J+3 de `now`
    const result = await fetchMeteoGrids(scene, {
      variables: ['wind_speed_10m', 'wind_direction_10m'],
      forecastGrid: grid,
      archiveGrid: grid,
      now,
      skipGalaxyData: true,
    });

    // UNE requête pour les deux variables, qui les demande toutes deux.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      hourly: string[];
      forecast_days: number;
    };
    expect(body.hourly).toEqual(['wind_speed_10m', 'wind_direction_10m']);
    // La fenêtre couvre J+3 : l'ancien prototype demandait toujours un seul jour.
    expect(body.forecast_days).toBeGreaterThanOrEqual(4);
    // L'index lu est celui de J+3 06:00 dans la série, pas 06:00 d'aujourd'hui.
    const speed = result.grids?.['wind_speed_10m']?.values[0];
    const direction = result.grids?.['wind_direction_10m']?.values[0];
    expect(speed).toBeGreaterThanOrEqual(3 * 24 + 6);
    expect(direction).toBe(1000 + speed!);
  });
});

describe('heure échantillonnée et `realDate` (chemin Open-Meteo, GAL-METEO-INSPECT-002)', () => {
  // Comme l'API : la série démarre à minuit UTC de (aujourd'hui − past_days) ; chaque case porte
  // ici l'HEURE ABSOLUE (en heures depuis 1970) qu'elle représente. Lire la bonne case, c'est
  // lire la valeur de l'heure demandée, pas celle d'une heure voisine.
  const slotHours = (body: { past_days?: number; forecast_days?: number }) => {
    const midnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - (body.past_days ?? 0)
    );
    const count = ((body.past_days ?? 0) + (body.forecast_days ?? 1)) * 24;
    return Array.from(
      { length: count },
      (_, i) => (midnight + i * 3_600_000) / 3_600_000
    );
  };

  it('prévision : la case lue est exactement celle de l’heure de la scène, et `realDate` la nomme', async () => {
    for (const iso of [
      '2026-08-14T00:00:00Z',
      '2026-08-14T12:00:00Z',
      '2026-08-14T23:00:00Z',
      '2026-08-13T05:00:00Z',
      '2026-08-17T18:00:00Z',
    ]) {
      clearMeteoClientCache();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(String(init.body));
          const series = slotHours(body);
          return new Response(
            JSON.stringify(
              body.latitude.map(() => ({ hourly: { cloud_cover: series } }))
            ),
            { status: 200 }
          );
        })
      );
      const simDate = new Date(iso);
      const result = await fetchMeteoGrid(simDate, {
        variable: 'cloud_cover',
        forecastGrid: grid,
        archiveGrid: grid,
        now,
        skipGalaxyData: true,
      });
      expect(result.plan.source).toBe('forecast');
      expect(result.realDate).toBe(simDate.toISOString());
      expect(result.grid!.values[0]).toBe(simDate.getTime() / 3_600_000);
    }
  });

  it('archive : la case lue est l’heure UTC du jour demandé', async () => {
    clearMeteoClientCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        const day = Date.parse(body.start_date[0] + 'T00:00:00Z');
        const series = Array.from(
          { length: 24 },
          (_, h) => day / 3_600_000 + h
        );
        return new Response(
          JSON.stringify(
            body.latitude.map(() => ({ hourly: { cloud_cover: series } }))
          ),
          { status: 200 }
        );
      })
    );
    const simDate = new Date('2020-06-01T17:00:00Z');
    const result = await fetchMeteoGrid(simDate, {
      variable: 'cloud_cover',
      forecastGrid: grid,
      archiveGrid: grid,
      now,
      skipGalaxyData: true,
    });
    expect(result.plan.source).toBe('archive');
    expect(result.realDate).toBe(simDate.toISOString());
    expect(result.grid!.values[0]).toBe(simDate.getTime() / 3_600_000);
  });
});
