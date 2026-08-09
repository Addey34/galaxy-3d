import { describe, expect, it } from 'vitest';
import {
  assertSafeTextureQuality,
  isSafeTextureQuality,
} from './catalogValidation';

describe('texture input security', () => {
  it('accepts only the supported quality suffixes', () => {
    expect(isSafeTextureQuality('8k')).toBe(true);
    expect(isSafeTextureQuality('1k')).toBe(true);
    expect(isSafeTextureQuality('../escape')).toBe(false);
    expect(isSafeTextureQuality('2k.jpg')).toBe(false);
    expect(() => assertSafeTextureQuality('../escape')).toThrow(/Unsafe/);
  });
});
