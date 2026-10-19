import { describe, expect, it } from 'vitest';
import { TILE_FADE_MS, tileFadeOpacity } from './tileFade';

describe('tileFadeOpacity', () => {
  it('starts invisible and ends whole', () => {
    expect(tileFadeOpacity(0)).toBe(0);
    expect(tileFadeOpacity(TILE_FADE_MS)).toBe(1);
    expect(tileFadeOpacity(10 * TILE_FADE_MS)).toBe(1);
  });

  it('rises monotonically in between', () => {
    let previous = 0;
    for (let ms = 20; ms < TILE_FADE_MS; ms += 20) {
      const value = tileFadeOpacity(ms);
      expect(value).toBeGreaterThan(previous);
      expect(value).toBeLessThan(1);
      previous = value;
    }
  });

  it('never goes negative for a clock that stepped back', () => {
    expect(tileFadeOpacity(-50)).toBe(0);
  });

  it('is instantaneous when there is no duration', () => {
    expect(tileFadeOpacity(0, 0)).toBe(1);
  });
});
