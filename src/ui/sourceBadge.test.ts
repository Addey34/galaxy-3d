import { describe, it, expect } from 'vitest';
import { sourceBadgeText } from './sourceBadge';
import { resolveCloudSources, resolveThermalSources } from '@/core/layerSource';
import { planMeteoRequest } from '@/core/meteoTimeTravel';
import type { SourceCandidate } from '@/core/layerSource';

// Traduction identité avec interpolation : le test lit les CLÉS, pas une langue.
const t = (key: string, vars?: Record<string, string | number>): string =>
  vars ? `${key}(${Object.values(vars).join(',')})` : key;

const now = new Date('2026-09-17T12:00:00Z');

describe('sourceBadgeText', () => {
  it('nuages d’une scène au présent : observés, décalés de la latence (J-2), sans mentir', () => {
    const [viirs] = resolveCloudSources(now, now);
    expect(viirs.realDate).toBe('2026-09-15');
    expect(sourceBadgeText(viirs, now, now, t)).toBe(
      'weather.source.prefix VIIRS · 2026-09-15 · time.category.observed · time.offset.scene(2026-09-17)'
    );
  });

  it('nuages d’une scène en 2030 : la dernière image réelle est servie ET l’écart se voit', () => {
    // Défaut corrigé : la tuile ramenée à J-2 sortait « observé » sans rien signaler.
    const sim = new Date('2030-01-01T00:00:00Z');
    const [viirs] = resolveCloudSources(sim, now);
    expect(viirs.approx).toBe(false);
    expect(sourceBadgeText(viirs, sim, now, t)).toContain(
      'time.offset.scene(2030-01-01)'
    );
  });

  it('nuages d’une date passée couverte : observés, aucun écart', () => {
    const sim = new Date('2020-03-10T15:00:00Z');
    const [viirs] = resolveCloudSources(sim, now);
    const text = sourceBadgeText(viirs, sim, now, t);
    expect(text).toContain('time.category.observed');
    expect(text).not.toContain('time.offset.scene');
  });

  it('MERRA-2 est une réanalyse, jamais une observation', () => {
    const sim = new Date('2020-03-10T15:00:00Z');
    const [merra] = resolveThermalSources(sim, now);
    const text = sourceBadgeText(merra, sim, now, t);
    expect(text).toContain('time.category.reconstructed');
    expect(text).not.toContain('time.category.observed');
  });

  it('ERA5 (archive Open-Meteo) est une réanalyse ; une prévision à 11 j est prédite en confiance réduite', () => {
    const past = new Date('2020-06-01T09:00:00Z');
    const era5: SourceCandidate = {
      id: 'era5',
      label: 'ERA5',
      url: '',
      realDate: past.toISOString(),
      approx: false,
      product: planMeteoRequest(past, { now }).product,
    };
    expect(sourceBadgeText(era5, past, now, t)).toBe(
      'weather.source.prefix ERA5 · 2020-06-01 · time.category.reconstructed'
    );

    const future = new Date('2026-09-28T12:00:00Z');
    const forecast: SourceCandidate = {
      ...era5,
      label: 'Open-Meteo',
      realDate: future.toISOString(),
      product: planMeteoRequest(future, { now }).product,
    };
    expect(sourceBadgeText(forecast, future, now, t)).toBe(
      'weather.source.prefix Open-Meteo · 2026-09-28 · time.category.predicted · time.confidence.reduced'
    );
  });

  it('au-delà de l’horizon du modèle : indisponible, pas de moyenne climatique inventée', () => {
    const far = new Date('2027-01-01T00:00:00Z');
    const plan = planMeteoRequest(far, { now });
    const none: SourceCandidate = {
      id: 'x',
      label: 'Open-Meteo',
      url: '',
      realDate: far.toISOString(),
      approx: false,
      product: plan.product,
    };
    expect(sourceBadgeText(none, far, now, t)).toContain(
      'time.category.unavailable'
    );
  });
});
