import { describe, it, expect, beforeEach } from 'vitest';
import {
  getUnitSystem,
  setUnitSystem,
  onUnitSystemChange,
  convertDistanceKm,
  convertTemperatureC,
  distanceDecimals,
} from './units';

describe('units', () => {
  beforeEach(() => {
    setUnitSystem('metric');
  });

  it('defaults to metric, unconverted', () => {
    expect(getUnitSystem()).toBe('metric');
    expect(convertDistanceKm(100)).toEqual({ value: 100, unit: 'km' });
    expect(convertTemperatureC(0)).toEqual({ value: 0, unit: '°C' });
  });

  it('converts km to miles in imperial', () => {
    setUnitSystem('imperial');
    const { value, unit } = convertDistanceKm(1.609344);
    expect(value).toBeCloseTo(1, 5);
    expect(unit).toBe('mi');
  });

  it('converts Celsius to Fahrenheit in imperial', () => {
    setUnitSystem('imperial');
    expect(convertTemperatureC(0)).toEqual({ value: 32, unit: '°F' });
    expect(convertTemperatureC(100).value).toBeCloseTo(212, 5);
  });

  it('notifies subscribers only on an actual change', () => {
    let calls = 0;
    const unsubscribe = onUnitSystemChange(() => calls++);
    setUnitSystem('metric'); // already metric — no-op
    expect(calls).toBe(0);
    setUnitSystem('imperial');
    expect(calls).toBe(1);
    unsubscribe();
  });
});

describe('distanceDecimals', () => {
  it('ne réduit pas un corps sous le kilomètre à zéro', () => {
    // Le défaut réel : Bennu, 0,242 km de rayon, s'affichait « 0 km ». Une donnée juste
    // présentée comme un zéro se lit comme un bug de données, et personne ne va vérifier le
    // catalogue pour s'en assurer.
    expect((0.24222).toFixed(distanceDecimals(0.24222))).toBe('0.242');
    expect(
      Number((0.24222).toFixed(distanceDecimals(0.24222)))
    ).toBeGreaterThan(0);
  });

  it('garde les planètes en nombres entiers', () => {
    // L'arrondi par défaut était bon pour elles ; c'est sa généralisation qui était fausse.
    expect(distanceDecimals(6371)).toBe(0);
    expect(distanceDecimals(69911)).toBe(0);
  });

  it('donne une décimale aux petites lunes', () => {
    expect((11.267).toFixed(distanceDecimals(11.267))).toBe('11.3');
  });

  it('traite les valeurs négatives par leur magnitude', () => {
    expect(distanceDecimals(-0.5)).toBe(distanceDecimals(0.5));
  });
});
