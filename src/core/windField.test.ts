import { describe, expect, it } from 'vitest';
import {
  buildWindArchiveUrl,
  buildWindGridUrl,
  parseWindGrid,
  sampleWind,
  windGridCoords,
  windToUV,
  type WindGrid,
} from './windField';

describe('windGridCoords', () => {
  it('produces a full lon ring per lat row', () => {
    const { lats, lons } = windGridCoords({ step: 10, maxLat: 80 });
    // 17 rangées de lat (-80..80) × 36 lon (-180..170) = 612 points.
    expect(lats.length).toBe(612);
    expect(lons.length).toBe(612);
    expect(lats[0]).toBe(-80);
    expect(lons[0]).toBe(-180);
  });
});

describe('buildWindGridUrl', () => {
  it('requests speed + direction for the grid', () => {
    const url = new URL(buildWindGridUrl({ step: 10 }));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/gfs');
    expect(url.searchParams.get('hourly')).toBe(
      'wind_speed_10m,wind_direction_10m'
    );
    expect(url.searchParams.get('latitude')?.split(',').length).toBe(612);
  });
});

describe('buildWindArchiveUrl (voyage temps ERA5)', () => {
  it('targets the ERA5 archive endpoint for a single past day', () => {
    const url = new URL(buildWindArchiveUrl('2019-03-10', { step: 10 }));
    expect(url.origin + url.pathname).toBe(
      'https://archive-api.open-meteo.com/v1/archive'
    );
    expect(url.searchParams.get('hourly')).toBe(
      'wind_speed_10m,wind_direction_10m'
    );
    // Journée unique : start = end. La grille est identique à celle du forecast.
    expect(url.searchParams.get('start_date')).toBe('2019-03-10');
    expect(url.searchParams.get('end_date')).toBe('2019-03-10');
    expect(url.searchParams.get('latitude')?.split(',').length).toBe(612);
  });
});

describe('windToUV (météo: direction = d\'où vient le vent)', () => {
  it('north wind (0°) blows toward the south → v negative', () => {
    const { u, v } = windToUV(10, 0);
    expect(Math.abs(u)).toBeLessThan(1e-6);
    expect(v).toBeCloseTo(-10, 5);
  });
  it('east wind (90°) blows toward the west → u negative', () => {
    const { u, v } = windToUV(10, 90);
    expect(u).toBeCloseTo(-10, 5);
    expect(Math.abs(v)).toBeLessThan(1e-6);
  });
  it('south wind (180°) blows toward the north → v positive', () => {
    const { v } = windToUV(10, 180);
    expect(v).toBeCloseTo(10, 5);
  });
  it('west wind (270°) blows toward the east → u positive', () => {
    const { u } = windToUV(10, 270);
    expect(u).toBeCloseTo(10, 5);
  });
});

describe('parseWindGrid', () => {
  it('fills u/v from the response at the given hour', () => {
    const opts = { step: 90, maxLat: 90 }; // grille minuscule 3 lat × 4 lon = 12 pts
    const { lats } = windGridCoords(opts);
    const response = lats.map(() => ({
      hourly: { wind_speed_10m: [10, 20], wind_direction_10m: [270, 0] },
    }));
    const grid = parseWindGrid(response, opts, 0);
    expect(grid.nLat).toBe(3);
    expect(grid.nLon).toBe(4);
    // heure 0 : vent d'ouest 10 → u ≈ +10
    expect(grid.u[0]).toBeCloseTo(10, 4);
    const grid1 = parseWindGrid(response, opts, 1);
    // heure 1 : vent du nord 20 → v ≈ -20
    expect(grid1.v[0]).toBeCloseTo(-20, 4);
  });
});

describe('sampleWind', () => {
  const grid: WindGrid = {
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat: 3,
    nLon: 4,
    u: new Float32Array(12).fill(5),
    v: new Float32Array(12).fill(-3),
  };

  it('returns the field value on a uniform grid', () => {
    const s = sampleWind(grid, 12, 34);
    expect(s.u).toBeCloseTo(5, 4);
    expect(s.v).toBeCloseTo(-3, 4);
  });

  it('interpolates between distinct cells', () => {
    const g = { ...grid, u: new Float32Array(12), v: new Float32Array(12) };
    // col 0 = 0, col 1 = 10 (à lonMin=-180 → col0 ; -90 → col1)
    for (let r = 0; r < 3; r++) {
      g.u[r * 4 + 0] = 0;
      g.u[r * 4 + 1] = 10;
    }
    // à mi-chemin entre lon -180 et -90 → u ≈ 5
    const s = sampleWind(g, 0, -135);
    expect(s.u).toBeCloseTo(5, 4);
  });

  it('wraps longitude across ±180', () => {
    const g = { ...grid, u: new Float32Array(12) };
    // dernière colonne (lon 90) = 8, première (lon -180) = 0 ; à lon 135 on interpole
    // entre col3 (90) et col0 (wrap -180) → défini, pas de crash.
    for (let r = 0; r < 3; r++) g.u[r * 4 + 3] = 8;
    const s = sampleWind(g, 0, 170);
    expect(Number.isFinite(s.u)).toBe(true);
  });
});
