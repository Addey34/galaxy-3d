import { describe, expect, it } from 'vitest';
import { GIBS_WMS_ENDPOINT } from './gibsClouds';
import {
  IMERG_LAYER,
  IMERG_COVERAGE,
  imergEndForDate,
  imergFrameTimes,
  imergLatestAvailable,
  imergUrl,
  snapToHalfHour,
  toImergTimeString,
} from './gibsPrecip';

describe('snapToHalfHour', () => {
  it('floors to the nearest 30-minute UTC grid point', () => {
    expect(snapToHalfHour(new Date('2026-08-09T10:29:59Z')).toISOString()).toBe(
      '2026-08-09T10:00:00.000Z'
    );
    expect(snapToHalfHour(new Date('2026-08-09T10:59:00Z')).toISOString()).toBe(
      '2026-08-09T10:30:00.000Z'
    );
    expect(snapToHalfHour(new Date('2026-08-09T10:30:00Z')).toISOString()).toBe(
      '2026-08-09T10:30:00.000Z'
    );
  });
});

describe('toImergTimeString', () => {
  it('formats on the 30-min grid without milliseconds', () => {
    expect(toImergTimeString(new Date('2026-08-09T10:47:12Z'))).toBe(
      '2026-08-09T10:30:00Z'
    );
  });
});

describe('imergLatestAvailable', () => {
  it('subtracts the publication latency and snaps to the half hour', () => {
    const now = new Date('2026-08-09T12:10:00Z');
    expect(imergLatestAvailable({ now, latencyHours: 4 }).toISOString()).toBe(
      '2026-08-09T08:00:00.000Z'
    );
  });
});

describe('imergEndForDate', () => {
  const now = new Date('2026-08-09T12:10:00Z');

  it('clamps today/future to the latest available frame', () => {
    expect(imergEndForDate(now, { now, latencyHours: 4 })?.toISOString()).toBe(
      '2026-08-09T08:00:00.000Z'
    );
    expect(
      imergEndForDate(new Date('2030-01-01T00:00:00Z'), {
        now,
        latencyHours: 4,
      })?.toISOString()
    ).toBe('2026-08-09T08:00:00.000Z');
  });

  it('passes a past instant through (snapped)', () => {
    expect(
      imergEndForDate(new Date('2022-03-04T15:47:00Z'), { now })?.toISOString()
    ).toBe('2022-03-04T15:30:00.000Z');
  });

  it('returns null before the layer start date', () => {
    expect(imergEndForDate(new Date('1999-01-01T00:00:00Z'), { now })).toBe(
      null
    );
  });
});

describe('imergFrameTimes', () => {
  it('produces count ascending frames 30 min apart ending at end', () => {
    const end = new Date('2026-08-09T08:00:00Z');
    const frames = imergFrameTimes(end, 4);
    expect(frames.map((d) => d.toISOString())).toEqual([
      '2026-08-09T06:30:00.000Z',
      '2026-08-09T07:00:00.000Z',
      '2026-08-09T07:30:00.000Z',
      '2026-08-09T08:00:00.000Z',
    ]);
  });

  it('drops frames below the minimum date', () => {
    const frames = imergFrameTimes(new Date('2000-06-01T01:00:00Z'), 6);
    // Toutes >= 2000-06-01T00:00Z ; les frames avant sont écartées.
    expect(frames[0].getTime()).toBeGreaterThanOrEqual(
      new Date('2000-06-01T00:00:00Z').getTime()
    );
    expect(frames[frames.length - 1].toISOString()).toBe(
      '2000-06-01T01:00:00.000Z'
    );
  });
});

describe('imergUrl', () => {
  it('builds a transparent PNG WMS GetMap URL for the IMERG layer', () => {
    const url = new URL(imergUrl(new Date('2026-08-09T10:30:00Z')));
    expect(`${url.origin}${url.pathname}`).toBe(GIBS_WMS_ENDPOINT);
    const p = url.searchParams;
    expect(p.get('LAYERS')).toBe(IMERG_LAYER);
    expect(p.get('FORMAT')).toBe('image/png');
    expect(p.get('TRANSPARENT')).toBe('TRUE');
    expect(p.get('CRS')).toBe('EPSG:4326');
    expect(p.get('BBOX')).toBe('-90,-180,90,180');
    expect(p.get('TIME')).toBe('2026-08-09T10:30:00Z');
    expect(p.get('WIDTH')).toBe('1024');
    expect(p.get('HEIGHT')).toBe('512');
  });
});

describe('IMERG native coverage policy', () => {
  it('keeps the official V07 field global and forbids synthetic polar filling', () => {
    expect(IMERG_COVERAGE).toMatchObject({
      minLatitude: -90,
      maxLatitude: 90,
      productVersion: '07',
      policy: 'native-alpha-no-extrapolation',
    });
  });
});
