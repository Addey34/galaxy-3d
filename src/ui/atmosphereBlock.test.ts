import { beforeEach, describe, expect, it } from 'vitest';
import { setUnitSystem } from '@/core/units';
import { formatPressure } from './atmosphereBlock';

/**
 * LA PRESSION D'UN PROFIL MESURÉ SUIT LE BOUTON D'UNITÉS (audit des panneaux, lot 1).
 * Les espaces sont insécables, comme à l'écran ; on les normalise pour lire le test.
 */
const plain = (text: string): string =>
  text.split(String.fromCharCode(160)).join(' ');

describe('formatPressure', () => {
  beforeEach(() => setUnitSystem('metric'));

  it('garde le bar, le millibar et la notation scientifique en métrique', () => {
    expect(plain(formatPressure(1))).toMatch(/^1([.,]00)? bar$/);
    expect(plain(formatPressure(0.0063))).toMatch(/mbar$/);
    expect(plain(formatPressure(1e-5))).toMatch(/10⁻⁵ bar$/);
  });

  it('passe tout en psi en impérial, sans bar ni millibar', () => {
    setUnitSystem('imperial');
    expect(plain(formatPressure(1))).toMatch(/^14[.,]5 psi$/);
    expect(plain(formatPressure(92))).toMatch(/psi$/);
    expect(plain(formatPressure(0.0063))).toMatch(/^0[.,]0914 psi$/);
    expect(plain(formatPressure(1e-6))).toMatch(/10⁻⁵ psi$/);
    for (const bar of [92, 1, 0.0063, 1e-6])
      expect(plain(formatPressure(bar))).not.toMatch(/bar/);
  });
});
