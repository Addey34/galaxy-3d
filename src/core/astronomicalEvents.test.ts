import { describe, expect, it } from 'vitest';
import { findUpcomingAstronomicalEvents } from './astronomicalEvents';

describe('astronomical events', () => {
  it('returns chronological future events within the requested horizon', () => {
    const start = new Date('2025-01-01T00:00:00.000Z');
    const events = findUpcomingAstronomicalEvents(start, {
      count: 12,
      horizonDays: 400,
    });

    expect(events).toHaveLength(12);
    expect(events.every((event) => event.date > start)).toBe(true);
    expect(
      events.every(
        (event, index) => index === 0 || event.date >= events[index - 1]!.date
      )
    ).toBe(true);
    expect(events.some((event) => event.kind === 'full-moon')).toBe(true);
  });

  it('includes planetary oppositions and inferior conjunctions with their body', () => {
    const start = new Date('2025-01-01T00:00:00.000Z');
    const events = findUpcomingAstronomicalEvents(start, {
      count: 200,
      horizonDays: 800,
    });

    const oppositions = events.filter((event) => event.kind === 'opposition');
    const conjunctions = events.filter(
      (event) => event.kind === 'conjunction'
    );
    expect(oppositions.length).toBeGreaterThan(0);
    expect(conjunctions.length).toBeGreaterThan(0);
    expect(
      oppositions.every(
        (event) =>
          typeof event.body === 'string' &&
          ['mars', 'jupiter', 'saturn', 'uranus', 'neptune'].includes(
            event.body
          )
      )
    ).toBe(true);
    expect(
      conjunctions.every(
        (event) =>
          event.body === 'mercury' || event.body === 'venus'
      )
    ).toBe(true);
    expect(events.every((event) => event.date > start)).toBe(true);
  });

  it('supports a small horizon and a bounded result count', () => {
    const events = findUpcomingAstronomicalEvents(
      new Date('2026-01-01T00:00:00.000Z'),
      { count: 2, horizonDays: 45 }
    );

    expect(events).toHaveLength(2);
    expect(events[0]!.date.getTime()).toBeLessThanOrEqual(
      events[1]!.date.getTime()
    );
  });
});
