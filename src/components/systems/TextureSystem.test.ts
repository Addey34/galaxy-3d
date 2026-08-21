import { describe, expect, it } from 'vitest';
import { chooseTextureQuality } from './TextureSystem';

const levels = [
  { distance: 10, quality: '8k' },
  { distance: 20, quality: '4k' },
  { distance: 40, quality: '2k' },
  { distance: 80, quality: '1k' },
];

describe('texture quality selection', () => {
  it('selects detail from distance measured in body radii', () => {
    const available = ['8k', '4k', '2k', '1k'];
    expect(chooseTextureQuality(levels, available, 7)).toBe('8k');
    expect(chooseTextureQuality(levels, available, 18)).toBe('4k');
    expect(chooseTextureQuality(levels, available, 35)).toBe('2k');
    expect(chooseTextureQuality(levels, available, 200)).toBe('1k');
  });

  it('falls through unavailable resolutions without exceeding the device cap', () => {
    expect(chooseTextureQuality(levels, ['4k', '2k', '1k'], 7)).toBe('4k');
    expect(chooseTextureQuality(levels, ['2k', '1k'], 18)).toBe('2k');
  });

  it('respects the WebGL maximum texture size on constrained mobile GPUs', () => {
    expect(
      chooseTextureQuality(levels, ['8k', '4k', '2k', '1k'], 7, 2048)
    ).toBe('2k');
    expect(chooseTextureQuality(levels, ['4k', '2k', '1k'], 7, 1024)).toBe(
      '1k'
    );
  });
});
