import { describe, expect, it } from 'vitest';
import { createSurfaceMaterial } from './layerConfig';

describe('celestial layer materials', () => {
  it('uses neutral white when a textured surface has no fallback color', () => {
    const material = createSurfaceMaterial(false);

    expect(material.color.getHex()).toBe(0xffffff);
    material.dispose();
  });

  it('keeps an explicit fallback color for untextured surfaces', () => {
    const material = createSurfaceMaterial(false, 0x123456);

    expect(material.color.getHex()).toBe(0x123456);
    material.dispose();
  });
});
