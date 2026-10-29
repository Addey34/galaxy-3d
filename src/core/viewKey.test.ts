import { describe, expect, it } from 'vitest';
import { quantizeViewKey, sameViewKey, VIEW_KEY_QUANTUM } from './viewKey';

describe('viewKey', () => {
  it('ignore une dérive bien sous le quantum', () => {
    const a = quantizeViewKey([-93.0910393, 0.5]);
    const b = quantizeViewKey([-93.0910393 + 1e-8, 0.5]);
    expect(sameViewKey(a, b)).toBe(true);
  });

  it('voit un déplacement de plusieurs quanta', () => {
    const a = quantizeViewKey([10, 0.5]);
    const b = quantizeViewKey([10 + 5 * VIEW_KEY_QUANTUM, 0.5]);
    expect(sameViewKey(a, b)).toBe(false);
  });

  it('refuse des clés de longueurs différentes', () => {
    expect(sameViewKey([1, 2], [1, 2, 3])).toBe(false);
  });
});
