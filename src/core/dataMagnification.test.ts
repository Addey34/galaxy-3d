import { describe, expect, it } from 'vitest';
import {
  MAGNIFICATION_FADE_END_PX,
  MAGNIFICATION_FADE_GLSL,
  MAGNIFICATION_FADE_START_PX,
  magnificationFade,
} from './dataMagnification';

describe('magnificationFade', () => {
  it('keeps the layer whole while a texel fits in a few screen pixels', () => {
    expect(magnificationFade(0.3)).toBe(1);
    expect(magnificationFade(MAGNIFICATION_FADE_START_PX)).toBe(1);
  });

  it('removes it once the data grid is what the screen shows', () => {
    expect(magnificationFade(MAGNIFICATION_FADE_END_PX)).toBe(0);
    // Mesuré à 1 036 km au-dessus de la Terre : 14 px par texel des nuages du jour.
    expect(magnificationFade(14)).toBe(0);
  });

  it('ramps monotonically in between', () => {
    let previous = 1;
    for (
      let px = MAGNIFICATION_FADE_START_PX + 0.5;
      px < MAGNIFICATION_FADE_END_PX;
      px += 0.5
    ) {
      const f = magnificationFade(px);
      expect(f).toBeLessThan(previous);
      expect(f).toBeGreaterThan(0);
      previous = f;
    }
  });

  it('writes the same thresholds into the shader as the mirror uses', () => {
    expect(MAGNIFICATION_FADE_GLSL).toContain(
      `smoothstep( ${MAGNIFICATION_FADE_START_PX}.0, ${MAGNIFICATION_FADE_END_PX}.0, pxPerTexel )`
    );
  });
});
