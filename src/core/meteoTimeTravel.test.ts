import { describe, it, expect } from 'vitest';
import { planMeteoRequest, archiveHourIndex } from './meteoTimeTravel';

const now = new Date('2026-08-14T12:00:00Z');
const opts = { now };

describe('planMeteoRequest', () => {
  it('présent (aujourd’hui) → forecast, dans plage, statut analysis', () => {
    const p = planMeteoRequest(new Date('2026-08-14T12:00:00Z'), opts);
    expect(p.source).toBe('forecast');
    expect(p.outOfRange).toBe(false);
    expect(p.status).toBe('analysis');
    expect(p.forecastDays).toBeGreaterThanOrEqual(1);
  });

  it('futur proche (≤ horizon) → forecast, statut forecast', () => {
    const p = planMeteoRequest(new Date('2026-08-18T12:00:00Z'), opts); // +4 j
    expect(p.source).toBe('forecast');
    expect(p.outOfRange).toBe(false);
    expect(p.status).toBe('forecast');
    expect(p.forecastDays).toBeGreaterThanOrEqual(5);
  });

  it('futur au-delà de l’horizon → outOfRange, climatology', () => {
    const p = planMeteoRequest(new Date('2026-10-01T12:00:00Z'), opts); // ~+48 j
    expect(p.outOfRange).toBe(true);
    expect(p.status).toBe('climatology');
  });

  it('passé récent (dans la zone forecast) → forecast', () => {
    const p = planMeteoRequest(new Date('2026-08-12T12:00:00Z'), opts); // -2 j
    expect(p.source).toBe('forecast');
    expect(p.outOfRange).toBe(false);
    expect(p.pastDays).toBeGreaterThanOrEqual(1);
  });

  it('passé lointain → archive ERA5 avec le jour ciblé, statut observed', () => {
    const p = planMeteoRequest(new Date('2020-06-01T09:00:00Z'), opts);
    expect(p.source).toBe('archive');
    expect(p.outOfRange).toBe(false);
    expect(p.date).toBe('2020-06-01');
    expect(p.status).toBe('observed');
  });

  it('avant 1940 → outOfRange, unavailable', () => {
    const p = planMeteoRequest(new Date('1900-01-01T00:00:00Z'), opts);
    expect(p.outOfRange).toBe(true);
    expect(p.status).toBe('unavailable');
  });

  it('respecte une borne de bascule archive personnalisée', () => {
    // cutoff 2 j : une date à -3 j passe déjà en archive.
    const p = planMeteoRequest(new Date('2026-08-11T12:00:00Z'), {
      now,
      archiveCutoffDays: 2,
    });
    expect(p.source).toBe('archive');
    expect(p.date).toBe('2026-08-11');
  });
});

describe('archiveHourIndex', () => {
  it('renvoie l’heure UTC du jour', () => {
    expect(archiveHourIndex(new Date('2020-06-01T09:00:00Z'))).toBe(9);
    expect(archiveHourIndex(new Date('2020-06-01T00:00:00Z'))).toBe(0);
    expect(archiveHourIndex(new Date('2020-06-01T23:00:00Z'))).toBe(23);
  });
});
