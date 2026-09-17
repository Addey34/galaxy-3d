import { describe, it, expect } from 'vitest';
import { planMeteoRequest, archiveHourIndex } from './meteoTimeTravel';
import { classifyTemporal } from './temporal';

const now = new Date('2026-08-14T12:00:00Z');
const opts = { now };

describe('planMeteoRequest', () => {
  it('présent (aujourd’hui) → forecast, dans plage, run de prévision reconstruit', () => {
    const sim = new Date('2026-08-14T12:00:00Z');
    const p = planMeteoRequest(sim, opts);
    expect(p.source).toBe('forecast');
    expect(p.outOfRange).toBe(false);
    expect(p.product?.kind).toBe('forecastModel');
    expect(classifyTemporal(p.product!, sim, now).category).toBe(
      'reconstructed'
    );
    expect(p.forecastDays).toBeGreaterThanOrEqual(1);
  });

  it('futur proche (≤ horizon) → forecast, prédit en confiance nominale', () => {
    const sim = new Date('2026-08-18T12:00:00Z'); // +4 j
    const p = planMeteoRequest(sim, opts);
    expect(p.source).toBe('forecast');
    expect(p.outOfRange).toBe(false);
    expect(classifyTemporal(p.product!, sim, now)).toMatchObject({
      category: 'predicted',
      confidence: 'nominal',
      offset: false,
    });
    expect(p.forecastDays).toBeGreaterThanOrEqual(5);
  });

  it('futur entre 7 et 16 j → prédit en confiance réduite', () => {
    const sim = new Date('2026-08-25T12:00:00Z'); // +11 j
    const p = planMeteoRequest(sim, opts);
    expect(classifyTemporal(p.product!, sim, now)).toMatchObject({
      category: 'predicted',
      confidence: 'reduced',
    });
  });

  it('futur au-delà de l’horizon → outOfRange, aucun produit (pas de climatologie inventée)', () => {
    const p = planMeteoRequest(new Date('2026-10-01T12:00:00Z'), opts); // ~+48 j
    expect(p.outOfRange).toBe(true);
    expect(p.product).toBeNull();
  });

  it('passé récent (dans la zone forecast) → forecast', () => {
    const p = planMeteoRequest(new Date('2026-08-12T12:00:00Z'), opts); // -2 j
    expect(p.source).toBe('forecast');
    expect(p.outOfRange).toBe(false);
    expect(p.pastDays).toBeGreaterThanOrEqual(1);
  });

  it('passé lointain → archive ERA5 avec le jour ciblé, RÉANALYSE et non observation', () => {
    const sim = new Date('2020-06-01T09:40:00Z');
    const p = planMeteoRequest(sim, opts);
    expect(p.source).toBe('archive');
    expect(p.outOfRange).toBe(false);
    expect(p.date).toBe('2020-06-01');
    expect(p.product?.kind).toBe('reanalysis');
    // Valeur de 09:00 servie pour une scène à 09:40 : dans la tolérance d'une heure.
    expect(classifyTemporal(p.product!, sim, now)).toMatchObject({
      category: 'reconstructed',
      offset: false,
    });
  });

  it('avant 1940 → outOfRange, aucun produit', () => {
    const p = planMeteoRequest(new Date('1900-01-01T00:00:00Z'), opts);
    expect(p.outOfRange).toBe(true);
    expect(p.product).toBeNull();
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
