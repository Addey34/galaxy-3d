import { describe, it, expect } from 'vitest';
import {
  meteoGridCoords,
  meteoGridDims,
  buildMeteoGridUrl,
  chunkCoords,
  buildMeteoPayloads,
  parseScalarGrid,
  sampleScalar,
  meteoHourIndex,
  cloudCoverToRGBA,
  OPEN_METEO_MAX_POINTS,
  type ScalarGrid,
} from './meteoGrid';

describe('meteoGridCoords / dims', () => {
  it('génère une grille pôle à pôle cohérente avec ses dimensions', () => {
    const { lats, lons } = meteoGridCoords({ step: 90, maxLat: 90 });
    const { nLat, nLon } = meteoGridDims({ step: 90, maxLat: 90 });
    expect(nLat).toBe(3); // -90, 0, 90
    expect(nLon).toBe(4); // -180,-90,0,90
    expect(lats.length).toBe(nLat * nLon);
    expect(lons.length).toBe(nLat * nLon);
    expect(lats[0]).toBe(-90);
    expect(lons[0]).toBe(-180);
  });
});

describe('buildMeteoGridUrl', () => {
  it('encode la variable, la fenêtre passé/futur et les coordonnées', () => {
    const url = buildMeteoGridUrl('cloud_cover', {
      step: 90,
      maxLat: 90,
      pastDays: 2,
      forecastDays: 3,
    });
    expect(url).toContain('hourly=cloud_cover');
    expect(url).toContain('past_days=2');
    expect(url).toContain('forecast_days=3');
    expect(url).toContain('api.open-meteo.com');
  });
});

describe('chunkCoords', () => {
  it('découpe en lots ≤ maxPoints en préservant l’ordre global', () => {
    const opts = { step: 30, maxLat: 90 }; // 7 lats × 12 lons = 84 points
    const total = meteoGridCoords(opts).lats.length;
    const chunks = chunkCoords(opts, 25);
    expect(chunks.length).toBe(Math.ceil(total / 25));
    // Recombiné = grille complète, même ordre.
    const lats = chunks.flatMap((c) => c.lats);
    expect(lats).toEqual(meteoGridCoords(opts).lats);
    // Aucun lot ne dépasse la limite.
    for (const c of chunks) expect(c.lats.length).toBeLessThanOrEqual(25);
  });

  it('respecte la limite serveur par défaut (1000 points)', () => {
    const chunks = chunkCoords({ step: 4, maxLat: 90 });
    for (const c of chunks) expect(c.lats.length).toBeLessThanOrEqual(OPEN_METEO_MAX_POINTS);
  });
});

describe('buildMeteoPayloads', () => {
  it('produit un payload POST par lot, avec hourly en tableau et la fenêtre temporelle', () => {
    const payloads = buildMeteoPayloads('cloud_cover', {
      step: 30,
      maxLat: 90,
      pastDays: 2,
      forecastDays: 7,
    });
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads[0].hourly).toEqual(['cloud_cover']);
    expect(payloads[0].past_days).toBe(2);
    expect(payloads[0].forecast_days).toBe(7);
    expect(payloads[0].latitude.length).toBe(payloads[0].longitude.length);
  });

  it('mode archive : start_date/end_date en tableaux alignés sur les points, sans forecast_days', () => {
    const payloads = buildMeteoPayloads('cloud_cover', {
      step: 30,
      maxLat: 90,
      date: '2020-06-01',
    });
    expect(payloads[0].forecast_days).toBeUndefined();
    expect(payloads[0].start_date).toBeDefined();
    expect(payloads[0].start_date!.length).toBe(payloads[0].latitude.length);
    expect(payloads[0].start_date!.every((d) => d === '2020-06-01')).toBe(true);
    expect(payloads[0].end_date).toEqual(payloads[0].start_date);
  });
});

describe('parseScalarGrid', () => {
  it('remplit la grille dans l’ordre des points, à l’heure demandée', () => {
    const opts = { step: 90, maxLat: 90 };
    const { nLat, nLon } = meteoGridDims(opts);
    const response = Array.from({ length: nLat * nLon }, (_, i) => ({
      hourly: { cloud_cover: [i, i + 100] },
    }));
    const g0 = parseScalarGrid(response, 'cloud_cover', opts, 0);
    const g1 = parseScalarGrid(response, 'cloud_cover', opts, 1);
    expect(g0.values[0]).toBe(0);
    expect(g0.values[5]).toBe(5);
    expect(g1.values[5]).toBe(105);
  });

  it('recombine plusieurs réponses CHUNKÉES dans l’ordre (mode POST)', () => {
    const opts = { step: 90, maxLat: 90 }; // 3×4 = 12 points
    const { nLat, nLon } = meteoGridDims(opts);
    const all = Array.from({ length: nLat * nLon }, (_, i) => ({
      hourly: { cloud_cover: [i * 10] },
    }));
    // Deux lots : [0..6] puis [7..11].
    const chunked = [all.slice(0, 7), all.slice(7)];
    const g = parseScalarGrid(chunked, 'cloud_cover', opts, 0);
    expect(g.values[0]).toBe(0);
    expect(g.values[7]).toBe(70);
    expect(g.values[11]).toBe(110);
  });

  it('met 0 pour les points manquants sans planter', () => {
    const g = parseScalarGrid([{ hourly: {} }], 'cloud_cover', { step: 90, maxLat: 90 });
    expect(g.values[0]).toBe(0);
  });
});

describe('sampleScalar', () => {
  const grid: ScalarGrid = {
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat: 3,
    nLon: 4,
    values: new Float32Array([
      0, 0, 0, 0, // lat -90
      10, 20, 30, 40, // lat 0
      0, 0, 0, 0, // lat 90
    ]),
  };

  it('retourne la valeur exacte sur un nœud', () => {
    expect(sampleScalar(grid, 0, -90)).toBeCloseTo(20, 5);
  });

  it('interpole entre nœuds', () => {
    expect(sampleScalar(grid, 0, -135)).toBeCloseTo(15, 5); // entre 10 et 20
  });

  it('clampe la latitude aux bornes', () => {
    expect(sampleScalar(grid, 200, -90)).toBeCloseTo(0, 5); // rangée nord = 0
  });
});

describe('meteoHourIndex', () => {
  const now = new Date('2026-08-14T00:00:00Z');
  it('donne l’heure écoulée depuis minuit du premier jour de la fenêtre', () => {
    expect(meteoHourIndex(new Date('2026-08-14T06:00:00Z'), now, 0)).toBe(6);
    // avec 2 jours de passé, la série démarre 2 jours plus tôt
    expect(meteoHourIndex(new Date('2026-08-14T06:00:00Z'), now, 2)).toBe(54);
  });
  it('ne renvoie jamais un index négatif', () => {
    expect(meteoHourIndex(new Date('2020-01-01T00:00:00Z'), now, 0)).toBe(0);
  });
});

describe('cloudCoverToRGBA', () => {
  it('mappe la couverture sur l’alpha et inverse le Nord en haut', () => {
    const grid: ScalarGrid = {
      step: 90,
      latMin: -90,
      lonMin: -180,
      nLat: 2,
      nLon: 1,
      values: new Float32Array([0, 100]), // sud=0%, nord=100%
    };
    const { data, width, height } = cloudCoverToRGBA(grid, 1);
    expect(width).toBe(1);
    expect(height).toBe(2);
    // ligne 0 de l'image = NORD (100% → gris 255 sur R=G=B, canal vert lu par alphaMap)
    expect(data[1]).toBe(255);
    expect(data[3]).toBe(255); // A constant
    // ligne 1 de l'image = SUD (0% → gris 0)
    expect(data[5]).toBe(0);
  });
});
