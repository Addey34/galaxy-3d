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
