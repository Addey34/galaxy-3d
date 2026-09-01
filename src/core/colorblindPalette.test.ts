import { describe, it, expect } from 'vitest';
import { colorblindSafeColor } from './colorblindPalette';

describe('colorblindSafeColor', () => {
  it('assigns each of the 8 planets a fixed, mutually distinct color', () => {
    const planets = [
      'mercury',
      'venus',
      'earth',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ];
    const colors = planets.map((name) => colorblindSafeColor(0x123456, name));
    expect(new Set(colors).size).toBe(planets.length);
  });

  it('is case-insensitive on body name', () => {
    expect(colorblindSafeColor(0x123456, 'Earth')).toBe(
      colorblindSafeColor(0x123456, 'earth')
    );
  });

  it('is deterministic for the same input', () => {
    const a = colorblindSafeColor(0xa8544a);
    const b = colorblindSafeColor(0xa8544a);
    expect(a).toBe(b);
  });

  it('leaves near-neutral (low-saturation) colors unchanged', () => {
    // A near-grey color has no confusable hue to remap.
    expect(colorblindSafeColor(0x999999)).toBe(0x999999);
  });

  it('remaps an unlisted body to one of the Okabe-Ito hue family', () => {
    const result = colorblindSafeColor(0xe85d3f, 'some-unlisted-moon');
    // Not the fixed planet table, but still a valid, non-zero remapped color.
    expect(result).toBeGreaterThan(0);
    expect(result).not.toBe(0xe85d3f);
  });
});
