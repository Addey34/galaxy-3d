import { describe, expect, it } from 'vitest';
import {
  formatPermalinkDate,
  parsePermalink,
  serializePermalink,
} from './permalink';

const validBodies = new Set(['earth', 'mars']);

describe('permalink state', () => {
  it('parses valid mode, body and UTC date', () => {
    const state = parsePermalink(
      '?mode=explo&body=Mars&date=2026-11-20T18%3A00%3A00Z',
      validBodies
    );

    expect(state.mode).toBe('explo');
    expect(state.body).toBe('mars');
    expect(state.date?.toISOString()).toBe('2026-11-20T18:00:00.000Z');
  });

  it('ignores invalid values instead of selecting an unknown body', () => {
    const state = parsePermalink(
      '?mode=unknown&body=pluto&date=not-a-date',
      validBodies
    );

    expect(state).toEqual({
      mode: undefined,
      body: undefined,
      date: undefined,
    });
  });

  it('parses a complete view (azimuth/polar/distance) and rejects a partial one', () => {
    const complete = parsePermalink('?az=45.5&pol=60&dist=12.34', validBodies);
    expect(complete.view).toEqual({
      azimuthDeg: 45.5,
      polarDeg: 60,
      distance: 12.34,
    });

    const partial = parsePermalink('?az=45.5&pol=60', validBodies);
    expect(partial.view).toBeUndefined();

    const zeroDistance = parsePermalink(
      '?az=0&pol=0&dist=0',
      validBodies
    );
    expect(zeroDistance.view).toBeUndefined();
  });

  it('round-trips a view through serialize → parse', () => {
    const search = serializePermalink({
      view: { azimuthDeg: -123.456, polarDeg: 88.9, distance: 0.0007 },
    });
    const state = parsePermalink(search, validBodies);
    expect(state.view?.azimuthDeg).toBeCloseTo(-123.5, 5);
    expect(state.view?.polarDeg).toBeCloseTo(88.9, 5);
    expect(state.view?.distance).toBeCloseTo(0.0007, 5);
  });

  it('drops the view when a new state omits it, even if the URL had one', () => {
    const search = serializePermalink(
      { mode: 'explo' },
      '?az=1&pol=2&dist=3&mode=educ'
    );
    expect(search).not.toContain('az=');
    expect(search).not.toContain('pol=');
    expect(search).not.toContain('dist=');
  });

  it('serializes a stable state and preserves unrelated parameters', () => {
    const date = new Date('2026-11-20T18:00:00.000Z');
    expect(formatPermalinkDate(date)).toBe('2026-11-20T18:00:00Z');
    expect(
      serializePermalink(
        { mode: 'explo', body: 'mars', date },
        '?utm_source=share&mode=educ'
      )
    ).toBe(
      '?utm_source=share&mode=explo&body=mars&date=2026-11-20T18%3A00%3A00Z'
    );
  });
});
