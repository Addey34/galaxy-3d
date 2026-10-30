import { describe, it, expect, beforeEach } from 'vitest';
import {
  getUnitSystem,
  setUnitSystem,
  onUnitSystemChange,
  convertDistanceKm,
  convertTemperatureC,
  distanceDecimals,
  convertHeightKm,
  convertSpeedMs,
  convertSpeedKmh,
  convertMassKg,
  convertAcceleration,
  convertDensity,
  convertPressureBar,
  convertPressureHpa,
  convertRainRateMmH,
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

describe('les autres grandeurs suivent le bouton', () => {
  beforeEach(() => {
    setUnitSystem('metric');
  });

  it('ne change rien en métrique', () => {
    expect(convertHeightKm(0.5)).toEqual({ value: 500, unit: 'm' });
    expect(convertHeightKm(12)).toEqual({ value: 12, unit: 'km' });
    expect(convertSpeedMs(30)).toEqual({ value: 30, unit: 'm/s' });
    expect(convertSpeedKmh(90)).toEqual({ value: 90, unit: 'km/h' });
    expect(convertMassKg(5)).toEqual({ value: 5, unit: 'kg' });
    expect(convertAcceleration(9.8)).toEqual({ value: 9.8, unit: 'm/s²' });
    expect(convertDensity(1000)).toEqual({ value: 1000, unit: 'kg/m³' });
    expect(convertPressureBar(1)).toEqual({ value: 1, unit: 'bar' });
    expect(convertPressureHpa(1013)).toEqual({ value: 1013, unit: 'hPa' });
    expect(convertRainRateMmH(20)).toEqual({ value: 20, unit: 'mm/h' });
  });

  it('convertit avec les facteurs exacts du système impérial', () => {
    setUnitSystem('imperial');
    // Références : définitions légales (pied 0,3048 m, livre 0,45359237 kg, mille 1609,344 m).
    expect(convertSpeedMs(0.44704).value).toBeCloseTo(1, 6);
    expect(convertSpeedMs(1).unit).toBe('mph');
    expect(convertSpeedKmh(1.609344).value).toBeCloseTo(1, 6);
    expect(convertMassKg(0.45359237).value).toBeCloseTo(1, 8);
    expect(convertMassKg(1).unit).toBe('lb');
    expect(convertAcceleration(0.3048).value).toBeCloseTo(1, 8);
    expect(convertAcceleration(1).unit).toBe('ft/s²');
    expect(convertDensity(16.01846337).value).toBeCloseTo(1, 8);
    expect(convertDensity(1).unit).toBe('lb/ft³');
    expect(convertPressureBar(1).value).toBeCloseTo(14.5038, 3);
    expect(convertPressureBar(1).unit).toBe('psi');
    expect(convertPressureHpa(1013.25).value).toBeCloseTo(29.92, 2);
    expect(convertPressureHpa(1).unit).toBe('inHg');
    expect(convertRainRateMmH(25.4).value).toBeCloseTo(1, 8);
    expect(convertRainRateMmH(1).unit).toBe('in/h');
  });

  it('bascule sur l’unité de route au mille, pas au kilomètre', () => {
    setUnitSystem('imperial');
    // 1,5 km = 0,93 mi : encore en pieds. 1,7 km = 1,06 mi : en miles.
    expect(convertHeightKm(1.5).unit).toBe('ft');
    expect(convertHeightKm(1.5).value).toBeCloseTo(4921.26, 1);
    expect(convertHeightKm(1.7).unit).toBe('mi');
    expect(convertHeightKm(1.609344).value).toBeCloseTo(1, 8);
  });
});
