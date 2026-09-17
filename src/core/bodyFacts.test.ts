import { describe, expect, it } from 'vitest';
import { measured } from '@/config/factSources';
import type { CelestialBodyConfig } from '@/types';
import {
  bodyFact,
  citationOrder,
  displayedUncertainty,
  factValue,
} from './bodyFacts';

const body = (
  realData: CelestialBodyConfig['realData'],
  extra: Partial<CelestialBodyConfig> = {}
): CelestialBodyConfig =>
  ({
    kind: 'planet',
    rotationSpeed: 0,
    realData,
    ...extra,
  }) as CelestialBodyConfig;

describe('bodyFact : ce qui s’affiche comme un fait', () => {
  it('affiche une valeur sourcée', () => {
    const entry = bodyFact(
      body({ radiusKm: 100, sources: { radiusKm: measured('jpl-sbdb') } }),
      'radiusKm'
    );
    expect(entry).toMatchObject({ status: 'value', value: 100 });
  });

  it('ne publie JAMAIS une valeur sans provenance, même si le catalogue la porte', () => {
    // Filet de sécurité derrière le test de catalogue : une régression qui retire une source ne
    // doit pas transformer silencieusement un chiffre non sourcé en fait publié.
    const entry = bodyFact(body({ radiusKm: 100 }), 'radiusKm');
    expect(entry.status).toBe('unknown');
    expect(entry.status === 'unknown' && entry.reason.unsourced).toBe(true);
  });

  it('fait primer la déclaration d’inconnue sur la valeur de simulation', () => {
    // L'obliquité 0 d'une lune synchrone sert au rendu ; elle n'est pas une mesure.
    const reason = { en: 'x'.repeat(40), fr: 'x'.repeat(40), unsourced: true };
    const entry = bodyFact(
      body({
        axialTilt: 0,
        sources: {},
        unknown: { axialTilt: reason },
      }),
      'axialTilt'
    );
    expect(entry).toEqual({ field: 'axialTilt', status: 'unknown', reason });
  });

  it('ne compte pas de lunes à une lune ni à une étoile', () => {
    const src = { moonCount: measured('jpl-sbdb', { asOf: '2026-09' }) };
    expect(
      bodyFact(
        body({ moonCount: 0, sources: src }, { kind: 'moon' }),
        'moonCount'
      ).status
    ).toBe('absent');
    expect(
      bodyFact(
        body({ moonCount: 0, sources: src }, { kind: 'star' }),
        'moonCount'
      ).status
    ).toBe('absent');
    expect(
      bodyFact(body({ moonCount: 0, sources: src }), 'moonCount').status
    ).toBe('value');
  });

  it('lit la rotation dans la vitesse que la scène applique, en valeur absolue', () => {
    const triton = body({}, { rotationSpeed: -(2 * Math.PI) / (141 * 3600) });
    expect(factValue(triton, 'rotationPeriod')).toBeCloseTo(141, 9);
    expect(factValue(body({}), 'rotationPeriod')).toBeUndefined();
  });
});

describe('incertitude affichée', () => {
  const entry = (value: number, uncertainty: number) =>
    bodyFact(
      body({
        massKg: value,
        sources: { massKg: measured('jpl-sbdb', { uncertainty }) },
      }),
      'massKg'
    );

  it('montre une incertitude qui change la lecture du chiffre', () => {
    // Protée : GM 2,58 ± 2,42 km³/s².
    expect(displayedUncertainty(entry(2.58342, 2.4207))).toBeCloseTo(0.937, 3);
  });

  it('tait une incertitude que l’arrondi affiché dit déjà', () => {
    expect(displayedUncertainty(entry(1000, 49))).toBeNull();
    expect(displayedUncertainty(entry(1000, 50))).toBeCloseTo(0.05, 9);
  });
});

describe('numérotation des sources', () => {
  it('numérote dans l’ordre de première citation, une fois par source', () => {
    const cfg = body({
      radiusKm: 1,
      massKg: 1,
      gravity: 1,
      sources: {
        radiusKm: measured('jpl-sbdb'),
        massKg: measured('nssdca-fact-sheets'),
        gravity: measured('jpl-sbdb'),
      },
    });
    const order = citationOrder(
      (['radiusKm', 'massKg', 'gravity'] as const).map((f) => bodyFact(cfg, f))
    );
    expect([...order]).toEqual([
      ['jpl-sbdb', 1],
      ['nssdca-fact-sheets', 2],
    ]);
  });
});
