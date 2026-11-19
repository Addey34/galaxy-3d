/**
 * Ce que l'inspecteur a le droit de DIRE (GAL-METEO-INSPECT-003) : une lecture entre, du texte
 * sort. Un traducteur factice rend la clé et ses variables, pour tester le choix de la phrase sans
 * dépendre d'une langue ; les nombres, eux, sont formatés pour de vrai.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  compassPoint,
  describeReading,
  VARIABLE_ORDER,
  type Translate,
} from './inspectDisplay';
import type {
  FieldProvenance,
  FieldReading,
  ScalarReading,
  WindReading,
} from './meteoInspect';
import { setUnitSystem } from './units';

const t: Translate = (key, vars) =>
  vars ? `${key}${JSON.stringify(vars)}` : key;

const HOUR = 3_600_000;
const provenance = (over: Partial<FieldProvenance> = {}): FieldProvenance => ({
  provider: 'Open-Meteo',
  productKind: 'forecastModel',
  temporalCategory: 'reconstructed',
  confidence: 'nominal',
  planSource: 'forecast',
  requestedHour: '2026-11-10T12:00:00.000Z',
  effectiveDate: '2026-11-10T12:00:00.000Z',
  effectiveOffsetMs: 0,
  stepDegrees: 1,
  ...over,
});

const scalar = (over: Partial<ScalarReading> = {}): ScalarReading => ({
  kind: 'scalar',
  variable: 'temperature',
  unit: '°C',
  value: 12.345,
  availability: 'available',
  provenance: provenance(),
  phase: 'ready',
  ...over,
});

const wind = (over: Partial<WindReading> = {}): WindReading => ({
  kind: 'wind',
  variable: 'wind',
  speedKmh: 20,
  directionDeg: 270,
  calm: false,
  availability: 'available',
  provenance: provenance(),
  phase: 'ready',
  ...over,
});

const row = (reading: FieldReading, locale = 'en') =>
  describeReading('layer', reading, t, locale);

afterEach(() => setUnitSystem('metric'));

describe('valeurs et unités', () => {
  it('température : une décimale, °C puis °F', () => {
    expect(row(scalar()).value).toBe('12.3 °C');
    setUnitSystem('imperial');
    expect(row(scalar({ value: 0 })).value).toBe('32.0 °F');
  });

  it('pression : hPa entiers, inHg à deux décimales', () => {
    const pressure = scalar({
      variable: 'pressure',
      unit: 'hPa',
      value: 1013.4,
    });
    expect(row(pressure).value).toBe('1,013 hPa');
    setUnitSystem('imperial');
    expect(row(pressure).value).toBe('29.93 inHg');
  });

  it('humidité et nuages : pourcentage entier', () => {
    expect(
      row(scalar({ variable: 'humidity', unit: '%', value: 64.6 })).value
    ).toBe('65 %');
    expect(
      row(scalar({ variable: 'cloudCover', unit: '%', value: 0 })).value
    ).toBe('0 %');
  });

  it('suit la langue : séparateur décimal français', () => {
    expect(row(scalar(), 'fr').value).toBe('12,3 °C');
  });

  it('vent : km/h puis mph, une décimale sous 10', () => {
    expect(row(wind()).value).toBe('20 km/h');
    expect(row(wind({ speedKmh: 5 })).value).toBe('5.0 km/h');
    setUnitSystem('imperial');
    expect(row(wind()).value).toBe('12 mph');
  });
});

describe('précipitation : deux natures, un vrai zéro', () => {
  const rain = (over: Partial<ScalarReading>) =>
    scalar({ variable: 'precipitation', unit: 'mm', value: 1.5, ...over });

  it('taux GFS en mm/h, avec sa phrase', () => {
    const r = row(rain({ unit: 'mm/h', nature: 'instantRate' }));
    expect(r.value).toBe('1.5 mm/h');
    expect(r.detail).toBe('inspect.precip.rate');
  });

  it('cumul de l’heure précédente en mm, avec sa phrase', () => {
    const r = row(rain({ nature: 'precedingHourAccumulation' }));
    expect(r.value).toBe('1.5 mm');
    expect(r.detail).toBe('inspect.precip.accumulation');
  });

  it('impérial : la nature se garde (in/h, in)', () => {
    setUnitSystem('imperial');
    expect(
      row(rain({ unit: 'mm/h', nature: 'instantRate', value: 25.4 })).value
    ).toBe('1 in/h');
    expect(
      row(rain({ nature: 'precedingHourAccumulation', value: 25.4 })).value
    ).toBe('1 in');
  });

  it('un vrai zéro s’écrit 0 et le dit', () => {
    const r = row(rain({ value: 0, nature: 'precedingHourAccumulation' }));
    expect(r.status).toBe('value');
    expect(r.value).toBe('0 mm');
    expect(r.detail).toContain('inspect.precip.none');
  });

  it('une donnée manquante n’est jamais écrite 0', () => {
    const r = row(rain({ value: null, availability: 'missing' }));
    expect(r.status).toBe('unavailable');
    expect(r.value).toBeNull();
    expect(r.message).toBe('inspect.msg.missing');
  });
});

describe('vent : direction et calme', () => {
  it('dit D’OÙ vient l’air : rumb et degrés', () => {
    const r = row(wind({ directionDeg: 270 }));
    expect(r.detail).toBe(
      'inspect.wind.from{"dir":"inspect.dir.W","deg":"270"}'
    );
  });

  it('un vent calme n’a pas de direction', () => {
    const r = row(wind({ speedKmh: 0.4, directionDeg: null, calm: true }));
    expect(r.value).toBe('0.4 km/h');
    expect(r.detail).toBe('inspect.wind.calm');
  });

  it('les huit rumbs, et le tour de cadran', () => {
    expect(
      [0, 45, 90, 135, 180, 225, 270, 315, 359.9, 360, -90, 22.4, 22.6].map(
        compassPoint
      )
    ).toEqual([
      'N',
      'NE',
      'E',
      'SE',
      'S',
      'SW',
      'W',
      'NW',
      'N',
      'N',
      'W',
      'N',
      'NE',
    ]);
  });
});

describe('absence de valeur : chaque cas dit sa raison, aucun ne montre un chiffre', () => {
  const cases: Array<[string, Partial<ScalarReading>, string, string]> = [
    [
      'missing',
      { availability: 'missing', value: null },
      'unavailable',
      'inspect.msg.missing',
    ],
    [
      'outOfCoverage',
      { availability: 'outOfCoverage', value: null },
      'unavailable',
      'inspect.msg.outOfCoverage',
    ],
    [
      'stale au repos',
      { availability: 'stale', value: null, phase: 'ready' },
      'unavailable',
      'inspect.msg.stale',
    ],
    [
      'stale en chargement',
      { availability: 'stale', value: null, phase: 'loading' },
      'pending',
      'inspect.msg.updating',
    ],
    [
      'stale après échec',
      { availability: 'stale', value: null, phase: 'error' },
      'error',
      'inspect.msg.staleError',
    ],
    [
      'noData hors plage',
      {
        availability: 'noData',
        value: null,
        provenance: null,
        emptyReason: 'outOfRange',
      },
      'unavailable',
      'inspect.msg.outOfRange',
    ],
    [
      'noData en chargement',
      {
        availability: 'noData',
        value: null,
        provenance: null,
        emptyReason: 'notLoaded',
        phase: 'loading',
      },
      'pending',
      'inspect.msg.loading',
    ],
    [
      'noData échec',
      {
        availability: 'noData',
        value: null,
        provenance: null,
        emptyReason: 'notLoaded',
        phase: 'error',
      },
      'error',
      'inspect.msg.error',
    ],
  ];
  for (const [name, over, status, message] of cases)
    it(name, () => {
      const r = row(scalar(over));
      expect(r.status).toBe(status);
      expect(r.message).toBe(message);
      expect(r.value).toBeNull();
      expect(r.detail).toBeNull();
    });

  it('le vent périmé ne montre ni vitesse ni direction', () => {
    const r = row(
      wind({
        availability: 'stale',
        speedKmh: null,
        directionDeg: null,
        calm: null,
      })
    );
    expect(r.value).toBeNull();
    expect(r.detail).toBeNull();
    expect(r.message).toBe('inspect.msg.stale');
  });
});

describe('métadonnées', () => {
  it('fournisseur, nature, validité, pas de grille ; pas d’écart si aucun', () => {
    const meta = Object.fromEntries(
      row(scalar()).meta.map((m) => [m.label, m.value])
    );
    expect(meta['inspect.meta.source']).toBe('Open-Meteo');
    expect(meta['inspect.meta.nature']).toBe('time.category.reconstructed');
    expect(meta['inspect.meta.effective']).toBe('2026-11-10 12:00 UTC');
    expect(meta['inspect.meta.requested']).toBeUndefined();
    expect(meta['inspect.meta.grid']).toBe(
      'inspect.meta.gridValue{"step":"1"}'
    );
  });

  it('GFS : la date effective et l’heure demandée sont toutes deux écrites, avec l’écart', () => {
    const meta = Object.fromEntries(
      row(
        scalar({
          provenance: provenance({
            provider: 'NOAA GFS',
            effectiveDate: '2026-11-10T15:00:00.000Z',
            effectiveOffsetMs: 3 * HOUR,
          }),
        })
      ).meta.map((m) => [m.label, m.value])
    );
    expect(meta['inspect.meta.source']).toBe('NOAA GFS');
    expect(meta['inspect.meta.effective']).toBe('2026-11-10 15:00 UTC');
    expect(meta['inspect.meta.requested']).toBe(
      '2026-11-10 12:00 UTC (inspect.meta.offset{"h":"+3"})'
    );
  });

  it('un écart négatif ou fractionnaire s’écrit avec son signe', () => {
    const requested = (offset: number) =>
      row(
        scalar({ provenance: provenance({ effectiveOffsetMs: offset }) })
      ).meta.find((m) => m.label === 'inspect.meta.requested')!.value;
    expect(requested(-3 * HOUR)).toContain('{"h":"−3"}');
    expect(requested(1.5 * HOUR)).toContain('{"h":"+1.5"}');
  });

  it('confiance réduite d’une prévision lointaine', () => {
    const meta = row(
      scalar({
        provenance: provenance({
          temporalCategory: 'predicted',
          confidence: 'reduced',
        }),
      })
    ).meta.find((m) => m.label === 'inspect.meta.nature')!;
    expect(meta.value).toBe(
      'time.category.predicted · time.confidence.reduced'
    );
  });

  it('sans provenance (couche vide) : aucune métadonnée', () => {
    expect(
      row(scalar({ availability: 'noData', value: null, provenance: null }))
        .meta
    ).toEqual([]);
  });
});

describe('ordre des lignes', () => {
  it('température, pression, humidité, précipitation, nuages, vent', () => {
    expect(VARIABLE_ORDER).toEqual([
      'temperature',
      'pressure',
      'humidity',
      'precipitation',
      'cloudCover',
      'wind',
    ]);
  });
});
