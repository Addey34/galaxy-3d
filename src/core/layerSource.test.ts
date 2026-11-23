import { describe, expect, it } from 'vitest';
import {
  resolveCloudSources,
  resolveCloudFractionDaySource,
  resolveCloudFractionNightSource,
  resolvePrecipSources,
  resolveThermalSources,
  resolveSeaSurfaceTemperatureSources,
} from './layerSource';

const NOW = new Date('2026-08-13T12:00:00Z');

describe('resolveCloudSources', () => {
  const labelsAt = (iso: string, now: Date = NOW): string[] =>
    resolveCloudSources(new Date(`${iso}T00:00:00Z`), now).map((x) => x.label);

  it('garde SNPP en tête pour tout le passé sain (même source qu’avant), NOAA en repli', () => {
    expect(labelsAt('2026-08-10')).toEqual([
      'VIIRS SNPP',
      'VIIRS NOAA-20',
      'VIIRS NOAA-21',
      'MODIS Terra',
      'MODIS Aqua',
    ]);
    // Avant NOAA-21 (2023-02-10) : pas de candidat NOAA-21.
    expect(labelsAt('2020-06-15')).toEqual([
      'VIIRS SNPP',
      'VIIRS NOAA-20',
      'MODIS Terra',
      'MODIS Aqua',
    ]);
  });

  it('le dernier jour sain de SNPP est le 2026-10-02, NOAA-21 passe devant dès le 2026-10-03', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    expect(labelsAt('2026-10-02', now)[0]).toBe('VIIRS SNPP');
    expect(labelsAt('2026-10-03', now)).toEqual([
      'VIIRS NOAA-21',
      'VIIRS NOAA-20',
      'VIIRS SNPP',
      'MODIS Terra',
      'MODIS Aqua',
    ]);
  });

  it('SNPP s’arrête avec le 2026-11-02 : plus aucune requête SNPP après', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    expect(labelsAt('2026-11-02', now)).toContain('VIIRS SNPP');
    const after = labelsAt('2026-11-03', now);
    expect(after).not.toContain('VIIRS SNPP');
    expect(after[0]).toBe('VIIRS NOAA-21');
    // « Aujourd’hui » (clampé à J-2) suit la même chaîne : c’est le cas réel du produit.
    expect(labelsAt('2026-11-23', now)).toEqual([
      'VIIRS NOAA-21',
      'VIIRS NOAA-20',
      'MODIS Terra',
      'MODIS Aqua',
    ]);
  });

  it('chaque candidat vise sa couche, la date réelle clampée, et ne change que la couche', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    const c = resolveCloudSources(new Date('2026-11-23T00:00:00Z'), now);
    expect(c[0].realDate).toBe('2026-11-21');
    expect(c[0].url).toContain(
      'LAYERS=VIIRS_NOAA21_CorrectedReflectance_TrueColor'
    );
    expect(c[0].id).toBe(
      'VIIRS_NOAA21_CorrectedReflectance_TrueColor:2026-11-21'
    );
    expect(c[1].url).toContain(
      'LAYERS=VIIRS_NOAA20_CorrectedReflectance_TrueColor'
    );
    expect(c[1].url.replace('NOAA20', 'NOAA21')).toBe(c[0].url);
  });

  it('drops VIIRS before its archive but keeps MODIS for 2010', () => {
    const c = resolveCloudSources(new Date('2010-06-15T00:00:00Z'), NOW);
    const labels = c.map((x) => x.label);
    expect(labels.some((l) => l.startsWith('VIIRS'))).toBe(false); // avant ~2015
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

describe('resolveSeaSurfaceTemperatureSources (lot 53)', () => {
  it('le jour de la scène, puis les jours d’avant, en analyse sur la journée', () => {
    const c = resolveSeaSurfaceTemperatureSources(
      new Date('2010-03-05T15:00:00Z'),
      NOW
    );
    expect(c.map((x) => x.realDate)).toEqual([
      '2010-03-05',
      '2010-03-04',
      '2010-03-03',
      '2010-03-02',
    ]);
    expect(c[0]!.approx).toBe(false);
    expect(c[1]!.approx).toBe(true);
    // Une analyse de niveau 4 n'est PAS une mesure : elle se lit « reconstruite ».
    expect(c[0]!.product?.kind).toBe('analysis');
    expect(c[0]!.url).toContain('LAYERS=GHRSST_L4_MUR_Sea_Surface_Temperature');
    expect(c[0]!.url).toContain('FORMAT=image%2Fpng');
  });

  it('une scène future prend la dernière analyse publiée, jamais un jour à venir', () => {
    const c = resolveSeaSurfaceTemperatureSources(
      new Date('2099-01-01T00:00:00Z'),
      NOW
    );
    const latest = new Date(NOW);
    latest.setUTCDate(latest.getUTCDate() - 2);
    expect(c[0]!.realDate).toBe(latest.toISOString().slice(0, 10));
  });

  it('rien avant le premier jour publié, et le recul s’arrête à cette borne', () => {
    expect(
      resolveSeaSurfaceTemperatureSources(new Date('2002-05-31T12:00:00Z'), NOW)
    ).toEqual([]);
    const c = resolveSeaSurfaceTemperatureSources(
      new Date('2002-06-02T12:00:00Z'),
      NOW
    );
    expect(c.map((x) => x.realDate)).toEqual(['2002-06-02', '2002-06-01']);
  });
});
