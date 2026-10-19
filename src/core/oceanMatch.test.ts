import { describe, expect, it } from 'vitest';
import { OCEAN_MATCH_FRAGMENT_GLSL, oceanLiftLinear } from './oceanMatch';

describe('oceanLiftLinear', () => {
  it('is the linear difference base minus tile, never negative for a darker tile', () => {
    const lift = oceanLiftLinear({
      tileSrgb: [2, 5, 20],
      baseSrgb: [31, 60, 118],
    });
    for (const channel of lift) expect(channel).toBeGreaterThan(0);
    // Le bleu porte l'essentiel de l'écart : l'eau de la base est bien plus bleue.
    expect(lift[2]).toBeGreaterThan(lift[1]);
    expect(lift[1]).toBeGreaterThan(lift[0]);
  });

  it('is zero when the mosaic already has the colour of the base', () => {
    expect(
      oceanLiftLinear({ tileSrgb: [31, 60, 118], baseSrgb: [31, 60, 118] })
    ).toEqual([0, 0, 0]);
  });
});

describe('the ocean-match shader', () => {
  it('reads the base water mask with the SphereGeometry convention', () => {
    expect(OCEAN_MATCH_FRAGMENT_GLSL).toContain(
      'atan( oceanDir.z, - oceanDir.x )'
    );
    expect(OCEAN_MATCH_FRAGMENT_GLSL).toContain('1.0 - acos(');
  });

  it('re-wraps the gradients at the u = 0 seam', () => {
    expect(OCEAN_MATCH_FRAGMENT_GLSL).toContain('oceanGx.x -= floor');
  });
});
