import { beforeEach, describe, expect, it } from 'vitest';
import { kelvinWithConversion, superscript } from './numberText';
import { setUnitSystem } from './units';

const plain = (text: string): string =>
  text.split(String.fromCharCode(160)).join(' ');

describe('textes de nombres partagés', () => {
  beforeEach(() => setUnitSystem('metric'));

  it('écrit les exposants, négatifs compris', () => {
    expect(superscript(24)).toBe('\u00b2\u2074');
    expect(superscript(-3)).toBe('\u207b\u00b3');
    expect(superscript(0)).toBe('\u2070');
  });

  it('écrit le kelvin publié puis sa conversion', () => {
    const fmt = (n: number): string => String(Math.round(n));
    expect(plain(kelvinWithConversion(165, fmt))).toBe('165 K (-108 °C)');
    setUnitSystem('imperial');
    expect(plain(kelvinWithConversion(165, fmt))).toBe('165 K (-163 °F)');
  });
});
