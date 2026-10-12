import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GALAXY_DATA_MANIFEST,
  GALAXY_DATA_ORIGIN,
  composeVariable,
  decodeGxf,
  galaxyDataFieldUrl,
  pickGalaxyDataTime,
  type GalaxyDataManifest,
} from './galaxyData';
import { clearMeteoClientCache, fetchMeteoGrids } from './meteoClient';

/**
 * LE CLIENT DU SERVICE DE DONNÉES (lot 46), contre un fichier ÉCRIT PAR L'ENCODEUR PYTHON
 * (`python services/galaxy-data/ingest.py --fixture src/core/galaxyData.fixture.bin`) : le
 * décodeur de l'application et l'encodeur du serveur ne peuvent pas dériver l'un de l'autre.
 * Le champ : vent 4 × 3 au pas de 90°, nord en haut, longitude 0 en premier ; u = indice du
 * point, v = −indice, le point 5 absent dans u.
 */
const fixture = readFileSync(
  resolve(import.meta.dirname, 'galaxyData.fixture.bin')
);
const buffer = (): ArrayBuffer =>
  fixture.buffer.slice(
    fixture.byteOffset,
    fixture.byteOffset + fixture.byteLength
  ) as ArrayBuffer;

const manifest: GalaxyDataManifest = {
  format: 'GXF1',
  generated: '2026-10-12T05:00:00Z',
  source: { name: 'NOAA', url: '', licence: '' },
  stepHours: 3,
  path: 'gfs/{validTime}/{cycle}/{field}.bin',
  fields: { wind10m: { unit: 'm/s', bands: 2 } },
  times: {
    '2026101200': {
      cycle: '2026101200',
      kind: 'analysis',
      fields: ['wind10m'],
    },
    '2026101206': {
      cycle: '2026101200',
      kind: 'forecast',
      fields: ['wind10m'],
    },
  },
};

afterEach(() => {
  clearMeteoClientCache();
  vi.unstubAllGlobals();
});

describe('decodeGxf', () => {
  it('lit l’en-tête et les deux bandes que l’encodeur Python a écrits', () => {
    const { header, bands } = decodeGxf(buffer());
    expect(header.field).toBe('wind10m');
    expect([header.nLon, header.nLat, header.bands]).toEqual([4, 3, 2]);
    expect(bands[0]![7]).toBeCloseTo(7, 6);
    expect(Number.isNaN(bands[0]![5]!)).toBe(true);
    expect(bands[1]![11]).toBeCloseTo(-11, 6);
  });

  it('refuse un fichier tronqué ou étranger', () => {
    expect(() => decodeGxf(buffer().slice(0, 300))).toThrow(/octets/);
    expect(() => decodeGxf(new TextEncoder().encode('<html>').buffer)).toThrow(
      /GXF1/
    );
  });
});

describe('la grille du service, réindexée dans la convention des couches', () => {
  it('rangée 0 au SUD et colonne 0 à −180°, sans interpolation', () => {
    const grid = composeVariable('wind_speed_10m', decodeGxf(buffer()));
    expect([grid.step, grid.latMin, grid.lonMin, grid.nLat, grid.nLon]).toEqual(
      [90, -90, -180, 3, 4]
    );
    // (lat −90, lon −180) = rangée source 2, colonne source 2 = point 10 : u 10, v −10.
    expect(grid.values[0]).toBeCloseTo(Math.hypot(10, 10) * 3.6, 4);
    // Le point 5 (lat 0, lon 90) est absent : il reste absent, jamais zéro.
    expect(Number.isNaN(grid.values[1 * 4 + 3]!)).toBe(true);
  });

  it('dérive la direction météo (d’où vient le vent) depuis u et v', () => {
    const grid = composeVariable('wind_direction_10m', decodeGxf(buffer()));
    // u = +10 (vers l'est), v = −10 (vers le sud) : l'air vient du nord-ouest.
    expect(grid.values[0]).toBeCloseTo(315, 6);
  });
});

describe('pickGalaxyDataTime', () => {
  const at = (iso: string) => Date.parse(iso);

  it('prend l’instant le plus proche à un demi-pas au plus', () => {
    expect(
      pickGalaxyDataTime(manifest, at('2026-10-12T05:00:00Z'), ['wind10m'])
    ).toEqual({ stamp: '2026101206', cycle: '2026101200', kind: 'forecast' });
  });

  it('rend null au-delà d’un demi-pas : la donnée décrirait un autre moment', () => {
    expect(
      pickGalaxyDataTime(manifest, at('2026-10-12T09:00:00Z'), ['wind10m'])
    ).toBeNull();
  });

  it('rend null pour un champ que l’instant ne porte pas', () => {
    expect(
      pickGalaxyDataTime(manifest, at('2026-10-12T06:00:00Z'), ['t2m'])
    ).toBeNull();
  });
});

describe('fetchMeteoGrids passe par le service avant Open-Meteo', () => {
  const now = new Date('2026-10-12T05:30:00Z');
  const grid = { step: 90, maxLat: 90 };

  it('sert NOAA GFS, à l’instant du champ, sans aucun appel à Open-Meteo', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === GALAXY_DATA_MANIFEST)
        return new Response(JSON.stringify(manifest), { status: 200 });
      if (
        url ===
        galaxyDataFieldUrl(manifest, '2026101206', '2026101200', 'wind10m')
      )
        return new Response(buffer(), { status: 200 });
      throw new Error(`requête inattendue : ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMeteoGrids(new Date('2026-10-12T05:00:00Z'), {
      variables: ['wind_speed_10m', 'wind_direction_10m'],
      forecastGrid: grid,
      archiveGrid: grid,
      now,
    });

    expect(result.provider).toBe('NOAA GFS');
    // L'instant SERVI, pas celui de la scène : le badge montre l'écart d'une heure.
    expect(result.realDate).toBe('2026-10-12T06:00:00.000Z');
    expect(result.plan.product?.kind).toBe('forecastModel');
    expect(result.grids?.['wind_direction_10m']?.values[0]).toBeCloseTo(315, 6);
    expect(
      fetchMock.mock.calls.every(([url]) => url.startsWith(GALAXY_DATA_ORIGIN))
    ).toBe(true);
  });

  it('une analyse se présente comme une donnée reconstruite du passé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === GALAXY_DATA_MANIFEST
          ? new Response(JSON.stringify(manifest), { status: 200 })
          : new Response(buffer(), { status: 200 })
      )
    );
    const result = await fetchMeteoGrids(new Date('2026-10-12T00:30:00Z'), {
      variables: ['wind_speed_10m'],
      forecastGrid: grid,
      archiveGrid: grid,
      now,
    });
    expect(result.plan.product?.kind).toBe('reanalysis');
  });

  it('retombe sur Open-Meteo quand le service ne répond pas', async () => {
    const points = Array.from({ length: 12 }, () => ({
      hourly: { wind_speed_10m: Array(24 * 8).fill(20) },
    }));
    const fetchMock = vi.fn(async (url: string) =>
      url === GALAXY_DATA_MANIFEST
        ? new Response('', { status: 503 })
        : new Response(JSON.stringify(points), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMeteoGrids(new Date('2026-10-12T05:00:00Z'), {
      variables: ['wind_speed_10m'],
      forecastGrid: grid,
      archiveGrid: grid,
      now,
    });
    expect(result.provider).toBeUndefined();
    expect(result.grids?.['wind_speed_10m']?.values[0]).toBe(20);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('open-meteo'))
    ).toBe(true);
  });
});
