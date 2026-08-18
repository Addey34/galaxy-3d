import { describe, expect, it } from 'vitest';
import {
  GIBS_DEFAULT_LAYER,
  GIBS_CLOUD_FRACTION_DAY_LAYER,
  GIBS_WMS_ENDPOINT,
  gibsCloudDateFor,
  gibsCloudUrl,
  gibsLegendUrl,
  gibsMonthlyDateFor,
  toGibsDateString,
} from './gibsClouds';

describe('toGibsDateString', () => {
  it('formats a date as YYYY-MM-DD on the UTC calendar', () => {
    expect(toGibsDateString(new Date('2026-08-11T12:00:00Z'))).toBe(
      '2026-08-11'
    );
  });

  it('uses UTC, not local time (day does not shift near midnight UTC)', () => {
    expect(toGibsDateString(new Date('2026-01-01T00:30:00Z'))).toBe(
      '2026-01-01'
    );
  });
});

describe('gibsCloudDateFor', () => {
  const now = new Date('2026-08-12T09:00:00Z');

  it('clamps today/future to the latest available day (now - latency)', () => {
    // Aujourd'hui → J-1 par défaut (latence de publication).
    expect(gibsCloudDateFor(new Date('2026-08-12T00:00:00Z'), { now })).toBe(
      '2026-08-11'
    );
    // Futur → même dernier jour disponible.
    expect(gibsCloudDateFor(new Date('2027-01-01T00:00:00Z'), { now })).toBe(
      '2026-08-11'
    );
  });

  it('honours a custom latency', () => {
    expect(
      gibsCloudDateFor(new Date('2026-08-12T00:00:00Z'), {
        now,
        latencyDays: 3,
      })
    ).toBe('2026-08-09');
  });

  it('passes a past date through unchanged (time-travel)', () => {
    expect(gibsCloudDateFor(new Date('2020-06-15T00:00:00Z'), { now })).toBe(
      '2020-06-15'
    );
  });

  it('returns null before the layer start date (fallback to static)', () => {
    expect(gibsCloudDateFor(new Date('2010-01-01T00:00:00Z'), { now })).toBe(
      null
    );
  });

  it('respects a custom minimum date', () => {
    expect(
      gibsCloudDateFor(new Date('2018-01-01T00:00:00Z'), {
        now,
        minDate: '2019-01-01',
      })
    ).toBe(null);
    expect(
      gibsCloudDateFor(new Date('2019-06-01T00:00:00Z'), {
        now,
        minDate: '2019-01-01',
      })
    ).toBe('2019-06-01');
  });
});

describe('gibsLegendUrl', () => {
  it('builds the official GIBS SVG legend URL (horizontal by default)', () => {
    expect(gibsLegendUrl('MERRA2_2m_Air_Temperature_Monthly')).toBe(
      'https://gibs.earthdata.nasa.gov/legends/MERRA2_2m_Air_Temperature_Monthly_H.svg'
    );
  });

  it('supports the vertical orientation', () => {
    expect(gibsLegendUrl('MERRA2_2m_Air_Temperature_Monthly', 'V')).toBe(
      'https://gibs.earthdata.nasa.gov/legends/MERRA2_2m_Air_Temperature_Monthly_V.svg'
    );
  });
});

describe('gibsMonthlyDateFor', () => {
  const now = new Date('2026-08-13T09:00:00Z');

  it('snaps any date to the first of its month (YYYY-MM-01)', () => {
    expect(gibsMonthlyDateFor(new Date('2024-03-17T12:00:00Z'), { now })).toBe(
      '2024-03-01'
    );
  });

  it('clamps today/future to the latest published month (now - latency)', () => {
    // Août 2026 → J-1 mois = juillet 2026 (latence de publication par défaut).
    expect(gibsMonthlyDateFor(new Date('2026-08-20T00:00:00Z'), { now })).toBe(
      '2026-07-01'
    );
    expect(gibsMonthlyDateFor(new Date('2030-01-01T00:00:00Z'), { now })).toBe(
      '2026-07-01'
    );
  });

  it('honours a custom monthly latency', () => {
    expect(
      gibsMonthlyDateFor(new Date('2026-08-01T00:00:00Z'), {
        now,
        latencyMonths: 3,
      })
    ).toBe('2026-05-01');
  });

  it('returns null before the layer start date', () => {
    expect(
      gibsMonthlyDateFor(new Date('1979-06-01T00:00:00Z'), {
        now,
        minDate: '1980-01-01',
      })
    ).toBe(null);
  });
});

describe('gibsCloudUrl - cloud fraction day', () => {
  it('builds a PNG URL for the day cloud fraction layer', () => {
    const url = new URL(
      gibsCloudUrl('2026-08-11', {
        layer: GIBS_CLOUD_FRACTION_DAY_LAYER,
        format: 'image/png',
      })
    );
    expect(url.searchParams.get('LAYERS')).toBe(GIBS_CLOUD_FRACTION_DAY_LAYER);
    expect(url.searchParams.get('FORMAT')).toBe('image/png');
  });
});

describe('gibsCloudUrl', () => {
  it('builds a WMS 1.3.0 GetMap URL with the expected global parameters', () => {
    const url = new URL(gibsCloudUrl('2026-08-11'));
    expect(`${url.origin}${url.pathname}`).toBe(GIBS_WMS_ENDPOINT);
    const p = url.searchParams;
    expect(p.get('SERVICE')).toBe('WMS');
    expect(p.get('REQUEST')).toBe('GetMap');
    expect(p.get('VERSION')).toBe('1.3.0');
    expect(p.get('CRS')).toBe('EPSG:4326');
    expect(p.get('BBOX')).toBe('-90,-180,90,180');
    expect(p.get('LAYERS')).toBe(GIBS_DEFAULT_LAYER);
    expect(p.get('TIME')).toBe('2026-08-11');
  });

  it('defaults to a 2:1 equirectangular size and allows overrides', () => {
    const def = new URL(gibsCloudUrl('2026-08-11'));
    expect(def.searchParams.get('WIDTH')).toBe('2048');
    expect(def.searchParams.get('HEIGHT')).toBe('1024');

    const custom = new URL(
      gibsCloudUrl('2026-08-11', { width: 4096, layer: 'OTHER_LAYER' })
    );
    expect(custom.searchParams.get('WIDTH')).toBe('4096');
    expect(custom.searchParams.get('HEIGHT')).toBe('2048');
    expect(custom.searchParams.get('LAYERS')).toBe('OTHER_LAYER');
  });
});
