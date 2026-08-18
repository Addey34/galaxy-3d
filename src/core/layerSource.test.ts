import { describe, expect, it } from 'vitest';
import {
  resolveCloudSources,
  resolveCloudFractionDaySource,
  resolveCloudFractionNightSource,
  resolvePrecipSources,
  resolveThermalSources,
} from './layerSource';

const NOW = new Date('2026-08-13T12:00:00Z');

describe('resolveCloudSources', () => {
  it('offers VIIRS first for a recent date', () => {
    const c = resolveCloudSources(new Date('2026-08-10T00:00:00Z'), NOW);
    expect(c[0].label).toBe('VIIRS');
    expect(c.map((x) => x.label)).toContain('MODIS Terra');
    expect(c.map((x) => x.label)).toContain('MODIS Aqua');
  });

  it('drops VIIRS before its archive but keeps MODIS for 2010', () => {
    const c = resolveCloudSources(new Date('2010-06-15T00:00:00Z'), NOW);
    const labels = c.map((x) => x.label);
    expect(labels).not.toContain('VIIRS'); // avant ~2015
    expect(labels[0]).toBe('MODIS Terra');
    expect(labels).toContain('MODIS Aqua');
  });

  it('drops MODIS Aqua before 2002 (only Terra remains for 2001)', () => {
    const c = resolveCloudSources(new Date('2001-06-15T00:00:00Z'), NOW);
    expect(c.map((x) => x.label)).toEqual(['MODIS Terra']);
  });

  it('returns nothing before all cloud archives', () => {
    expect(resolveCloudSources(new Date('1990-01-01T00:00:00Z'), NOW)).toEqual(
      []
    );
  });
});

describe('resolveCloudFractionDaySource', () => {
  it('résout la fraction diurne Aqua en PNG scientifique', () => {
    const c = resolveCloudFractionDaySource(
      new Date('2026-08-10T00:00:00Z'),
      NOW,
      { resolution: 1024 }
    );
    expect(c?.label).toBe('MODIS Aqua cloud fraction day');
    expect(c?.realDate).toBe('2026-08-10');
    expect(c?.url).toContain('MODIS_Aqua_Cloud_Fraction_Day');
    expect(c?.url).toContain('FORMAT=image%2Fpng');
  });
});
describe('resolveCloudFractionNightSource', () => {
  it('résout la fraction nocturne à la même date satellite', () => {
    const c = resolveCloudFractionNightSource(
      new Date('2026-08-10T00:00:00Z'),
      NOW
    );
    expect(c?.label).toBe('MODIS Aqua cloud fraction night');
    expect(c?.realDate).toBe('2026-08-10');
    expect(c?.url).toContain('MODIS_Aqua_Cloud_Fraction_Night');
    expect(c?.url).toContain('FORMAT=image%2Fpng');
  });

  it('est indisponible avant l’archive Aqua', () => {
    expect(
      resolveCloudFractionNightSource(new Date('1990-01-01T00:00:00Z'), NOW)
    ).toBeNull();
  });
});
describe('resolvePrecipSources', () => {
  it('first candidate is exact (not approx), later ones step back (approx)', () => {
    const c = resolvePrecipSources(new Date('2023-08-15T12:00:00Z'), NOW, {
      latencyHours: 4,
      stepBack: 3,
    });
    expect(c[0].approx).toBe(false);
    expect(c[1].approx).toBe(true);
    // Chaque recul est 30 min avant le précédent.
    const t0 = new Date(c[0].realDate).getTime();
    const t1 = new Date(c[1].realDate).getTime();
    expect(t0 - t1).toBe(30 * 60 * 1000);
  });

  it('ends with the daily IMERG fallback (approx)', () => {
    const c = resolvePrecipSources(new Date('2023-08-15T12:00:00Z'), NOW, {
      stepBack: 2,
    });
    const last = c[c.length - 1];
    expect(last.label).toBe('IMERG (jour)');
    expect(last.approx).toBe(true);
  });

  it('marks every IMERG candidate as native-alpha data without a polar fallback', () => {
    const c = resolvePrecipSources(new Date('2023-08-15T12:00:00Z'), NOW, {
      stepBack: 2,
    });
    expect(c.length).toBeGreaterThan(0);
    for (const candidate of c) {
      expect(candidate.label).toMatch(/^IMERG/);
      expect(candidate.coverage).toMatchObject({
        minLatitude: -90,
        maxLatitude: 90,
        productVersion: '07',
        policy: 'native-alpha-no-extrapolation',
      });
    }
  });
  it('returns nothing before the IMERG archive', () => {
    expect(resolvePrecipSources(new Date('1995-01-01T00:00:00Z'), NOW)).toEqual(
      []
    );
  });
});

describe('resolveThermalSources', () => {
  it('first month is exact, earlier months are approx', () => {
    const c = resolveThermalSources(new Date('2023-06-15T00:00:00Z'), NOW, {
      stepBackMonths: 2,
    });
    expect(c[0].approx).toBe(false);
    expect(c[0].realDate).toBe('2023-06-01');
    expect(c[1].realDate).toBe('2023-05-01');
    expect(c[1].approx).toBe(true);
  });

  it('clamps future dates to the latest published month (dedup collapses reculs)', () => {
    // Date « maintenant » : le mois courant n'est pas publié → clampé, reculs redondants dédupés.
    const c = resolveThermalSources(NOW, NOW, {
      latencyMonths: 3,
      stepBackMonths: 3,
    });
    // Le premier candidat existe et les realDate sont uniques.
    expect(c.length).toBeGreaterThan(0);
    const dates = c.map((x) => x.realDate);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('recule depuis le mois CLAMPÉ pour une date future (pas bloqué sur un mois unique)', () => {
    // Futur : le mois de base est clampé au dernier publié ; les reculs doivent descendre
    // sous ce mois (et non rester collés dessus). latencyMonths:1 → base = juillet ; recul → juin, mai…
    const future = new Date('2027-08-13T00:00:00Z');
    const c = resolveThermalSources(future, NOW, {
      latencyMonths: 1,
      stepBackMonths: 3,
    });
    expect(c[0].realDate).toBe('2026-07-01'); // clampé (now=2026-08, latence 1 mois)
    expect(c[1].realDate).toBe('2026-06-01'); // recule bien
    expect(c[2].realDate).toBe('2026-05-01');
    expect(c[1].approx).toBe(true);
  });
});
