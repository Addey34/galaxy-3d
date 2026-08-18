import { describe, it, expect } from 'vitest';
import { dataStatusFor, dataStatusLabelKey } from './dataStatus';

const now = new Date('2026-08-14T12:00:00Z');
const opts = { now };

describe('dataStatusFor', () => {
  it('renvoie unavailable quand aucune donnée résolue', () => {
    expect(dataStatusFor(null, opts)).toBe('unavailable');
  });

  it('qualifie une donnée passée (au-delà de la fenêtre d’analyse) en observed', () => {
    const d = new Date('2026-08-10T12:00:00Z'); // 4 jours avant
    expect(dataStatusFor(d, opts)).toBe('observed');
  });

  it('qualifie le présent (dans ±6 h par défaut) en analysis', () => {
    expect(dataStatusFor(new Date('2026-08-14T12:00:00Z'), opts)).toBe('analysis');
    expect(dataStatusFor(new Date('2026-08-14T09:00:00Z'), opts)).toBe('analysis');
    expect(dataStatusFor(new Date('2026-08-14T17:00:00Z'), opts)).toBe('analysis');
  });

  it('qualifie le futur proche (≤ 7 j) en forecast', () => {
    const d = new Date('2026-08-18T12:00:00Z'); // +4 j
    expect(dataStatusFor(d, opts)).toBe('forecast');
  });

  it('qualifie le futur moyen (7–16 j) en forecast_uncertain', () => {
    const d = new Date('2026-08-25T12:00:00Z'); // +11 j
    expect(dataStatusFor(d, opts)).toBe('forecast_uncertain');
  });

  it('qualifie au-delà de l’horizon des modèles en climatology', () => {
    const d = new Date('2026-10-01T12:00:00Z'); // ~+48 j
    expect(dataStatusFor(d, opts)).toBe('climatology');
  });

  it('respecte des horizons personnalisés', () => {
    const d = new Date('2026-08-16T12:00:00Z'); // +2 j
    expect(dataStatusFor(d, { now, forecastDays: 1 })).toBe('forecast_uncertain');
  });

  it('dérive une clé i18n stable par statut', () => {
    expect(dataStatusLabelKey('observed')).toBe('weather.status.observed');
    expect(dataStatusLabelKey('climatology')).toBe('weather.status.climatology');
  });
});
