import { describe, expect, it } from 'vitest';
import {
  fetchAllSmallBodies,
  fetchSmallBodies,
  julianDateToDate,
  parseSbdbRows,
  sbdbQueryUrl,
} from './sbdb';

const D2R = Math.PI / 180;

describe('julianDateToDate', () => {
  it('maps the Unix epoch JD to 1970-01-01', () => {
    expect(julianDateToDate(2_440_587.5).toISOString()).toBe(
      '1970-01-01T00:00:00.000Z'
    );
  });

  it('maps J2000.0 (JD 2451545.0) to 2000-01-01T12:00:00Z', () => {
    expect(julianDateToDate(2_451_545.0).toISOString()).toBe(
      '2000-01-01T12:00:00.000Z'
    );
  });
});

const FIELDS = ['full_name', 'a', 'e', 'i', 'om', 'w', 'ma', 'epoch'];

describe('parseSbdbRows', () => {
  it('parses rows into orbital elements with degrees converted to radians', () => {
    const rows = [
      [
        '   1 Ceres',
        '2.7691',
        '0.076',
        '10.594',
        '80.305',
        '73.597',
        '95.989',
        '2451545.0',
      ],
    ];
    const [body] = parseSbdbRows(FIELDS, rows);
    expect(body.name).toBe('1 Ceres');
    expect(body.elements.semiMajorAxisAU).toBeCloseTo(2.7691, 6);
    expect(body.elements.inclinationRad).toBeCloseTo(10.594 * D2R, 9);
    expect(body.elements.argPerihelionRad).toBeCloseTo(73.597 * D2R, 9);
    expect(body.elements.epoch.toISOString()).toBe('2000-01-01T12:00:00.000Z');
  });

  it('skips non-elliptic and non-finite rows', () => {
    const rows = [
      ['hyperbolic', '-3.2', '1.4', '10', '20', '30', '40', '2451545.0'], // a<0, e>1
      ['garbage', 'x', 'y', 'z', '0', '0', '0', '2451545.0'], // non-finite
      ['ok', '2.5', '0.1', '5', '10', '15', '20', '2451545.0'],
    ];
    const parsed = parseSbdbRows(FIELDS, rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('ok');
  });

  it('returns [] when a required field is missing', () => {
    expect(parseSbdbRows(['full_name', 'a', 'e'], [['x', '2', '0.1']])).toEqual(
      []
    );
  });
});

describe('sbdbQueryUrl', () => {
  it('defaults to the historical main-belt query (non-regression)', () => {
    const url = new URL(sbdbQueryUrl());
    expect(url.searchParams.get('fields')).toBe(
      'full_name,a,e,i,om,w,ma,epoch'
    );
    expect(url.searchParams.get('sb-kind')).toBe('a');
    expect(url.searchParams.get('sb-cdata')).toBe('{"AND":["a|LT|4.5"]}');
    expect(url.searchParams.get('sb-group')).toBeNull();
    expect(url.searchParams.get('limit')).toBe('2000');
  });

  it('queries NEOs via sb-group, without sb-kind', () => {
    const url = new URL(sbdbQueryUrl('neo'));
    expect(url.searchParams.get('sb-group')).toBe('neo');
    expect(url.searchParams.get('sb-kind')).toBeNull();
  });

  it('queries comets via sb-kind=c', () => {
    const url = new URL(sbdbQueryUrl('comet'));
    expect(url.searchParams.get('sb-kind')).toBe('c');
  });

  it('queries TNOs via sb-kind=a with a semi-major-axis floor', () => {
    const url = new URL(sbdbQueryUrl('tno'));
    expect(url.searchParams.get('sb-kind')).toBe('a');
    expect(url.searchParams.get('sb-cdata')).toContain('a|GT|30');
  });
});

describe('fetchAllSmallBodies', () => {
  function rowFor(name: string): string[] {
    return [name, '2.5', '0.1', '5', '10', '15', '20', '2451545.0'];
  }

  it('merges the 4 categories and tags each body with its category', async () => {
    const fetchImpl = (async (input: string | URL) => {
      const url = new URL(input.toString());
      const category = url.searchParams.has('sb-group')
        ? 'neo'
        : url.searchParams.get('sb-kind') === 'c'
          ? 'comet'
          : (url.searchParams.get('sb-cdata') ?? '').includes('GT')
            ? 'tno'
            : 'main-belt';
      return {
        ok: true,
        json: async () => ({
          fields: FIELDS,
          data: [rowFor(category)],
        }),
      };
    }) as unknown as typeof fetch;

    const bodies = await fetchAllSmallBodies(fetchImpl);
    expect(bodies).toHaveLength(4);
    const byCategory = new Map(bodies.map((b) => [b.category, b.name]));
    expect(byCategory.get('main-belt')).toBe('main-belt');
    expect(byCategory.get('neo')).toBe('neo');
    expect(byCategory.get('comet')).toBe('comet');
    expect(byCategory.get('tno')).toBe('tno');
  });

  it('keeps the other 3 categories when one fails', async () => {
    const fetchImpl = (async (input: string | URL) => {
      const url = new URL(input.toString());
      if (url.searchParams.get('sb-kind') === 'c') {
        return { ok: false, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({ fields: FIELDS, data: [rowFor('x')] }),
      };
    }) as unknown as typeof fetch;

    const bodies = await fetchAllSmallBodies(fetchImpl);
    expect(bodies).toHaveLength(3);
    expect(bodies.some((b) => b.category === 'comet')).toBe(false);
  });
});

describe('fetchSmallBodies', () => {
  it('degrades to [] on a network error', async () => {
    const failing = (() =>
      Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await fetchSmallBodies('http://x', failing)).toEqual([]);
  });

  it('degrades to [] on a non-ok response', async () => {
    const notOk = (() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
      })) as unknown as typeof fetch;
    expect(await fetchSmallBodies('http://x', notOk)).toEqual([]);
  });

  it('parses a well-formed response', async () => {
    const ok = (() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            fields: FIELDS,
            data: [
              [
                '2 Pallas',
                '2.77',
                '0.23',
                '34.8',
                '173',
                '310',
                '40',
                '2451545.0',
              ],
            ],
          }),
      })) as unknown as typeof fetch;
    const parsed = await fetchSmallBodies('http://x', ok);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('2 Pallas');
  });
});
