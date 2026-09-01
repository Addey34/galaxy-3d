import { describe, it, expect, beforeEach } from 'vitest';
import {
  getUnitSystem,
  setUnitSystem,
  onUnitSystemChange,
  convertDistanceKm,
  convertTemperatureC,
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
