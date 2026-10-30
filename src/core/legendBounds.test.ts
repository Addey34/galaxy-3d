import { beforeEach, describe, expect, it } from 'vitest';
import {
  PRECIP_DOMAIN,
  PRESSURE_DOMAIN,
  TEMPERATURE_DOMAIN,
  WIND_DOMAIN,
} from './meteoPalette';
import {
  pressureBound,
  rainBound,
  temperatureBound,
  windBound,
} from './legendBounds';
import { setUnitSystem } from './units';

const plain = (text: string): string =>
  text.split(String.fromCharCode(160)).join(' ');

describe('bornes des légendes météo', () => {
  beforeEach(() => setUnitSystem('metric'));

  it('écrit les bornes métriques que le dictionnaire portait', () => {
    expect(plain(temperatureBound(TEMPERATURE_DOMAIN.min, 'en'))).toBe(
      '−40 °C'
    );
    expect(plain(temperatureBound(TEMPERATURE_DOMAIN.max, 'en'))).toBe(
      '+45 °C'
    );
    expect(plain(pressureBound(PRESSURE_DOMAIN.min, 'en'))).toBe('960 hPa');
    expect(plain(pressureBound(PRESSURE_DOMAIN.max, 'en'))).toBe('1,060 hPa');
    expect(plain(rainBound(0.1, { locale: 'en' }))).toBe('0.1 mm/h');
    expect(
      plain(rainBound(PRECIP_DOMAIN.max, { saturates: true, locale: 'en' }))
    ).toBe('20+ mm/h');
    expect(plain(windBound(WIND_DOMAIN.min, { locale: 'en' }))).toBe('0 km/h');
    expect(
      plain(windBound(WIND_DOMAIN.max, { saturates: true, locale: 'en' }))
    ).toBe('90+ km/h');
  });

  it('suit la langue pour le séparateur décimal', () => {
    expect(plain(rainBound(0.1, { locale: 'fr' }))).toBe('0,1 mm/h');
  });

  it('convertit chaque borne en impérial, avec le bon signe', () => {
    setUnitSystem('imperial');
    // −40 est le point où les deux échelles se croisent ; +45 °C vaut 113 °F.
    expect(plain(temperatureBound(-40, 'en'))).toBe('−40 °F');
    expect(plain(temperatureBound(45, 'en'))).toBe('+113 °F');
    expect(plain(temperatureBound(-10, 'en'))).toBe('+14 °F');
    expect(plain(pressureBound(960, 'en'))).toBe('28.35 inHg');
    expect(plain(pressureBound(1060, 'en'))).toBe('31.30 inHg');
    expect(plain(rainBound(0.1, { locale: 'en' }))).toBe('0.0039 in/h');
    expect(plain(rainBound(20, { saturates: true, locale: 'en' }))).toBe(
      '0.79+ in/h'
    );
    expect(plain(windBound(0, { locale: 'en' }))).toBe('0 mph');
    expect(plain(windBound(90, { saturates: true, locale: 'en' }))).toBe(
      '56+ mph'
    );
  });

  it('ne laisse aucune unité métrique en impérial', () => {
    setUnitSystem('imperial');
    const all = [
      temperatureBound(-40),
      temperatureBound(45),
      pressureBound(960),
      pressureBound(1060),
      rainBound(0.1),
      rainBound(20, { saturates: true }),
      windBound(0),
      windBound(90, { saturates: true }),
    ].map(plain);
    for (const text of all) expect(text).not.toMatch(/°C|hPa|mm\/h|km\/h/);
  });
});
