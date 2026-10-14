import { describe, expect, it } from 'vitest';
import {
  MAGNIFICATION_FADE_END_PX,
  MAGNIFICATION_FADE_GLSL,
  MAGNIFICATION_FADE_START_PX,
  magnificationFade,
  maxPxPerTexel,
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

describe('maxPxPerTexel', () => {
  // Jacobienne d'un horizon : un quart de texel par pixel LE LONG de l'horizon, un texel par
  // pixel en travers. Le grossissement maximal est donc 4 px par texel, quelle que soit
  // l'inclinaison de l'horizon sur l'écran.
  const horizon = (degrees: number) => {
    const a = (degrees * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    // J = R(a) · diag(0,25 ; 1) : colonnes = dérivées selon x et y de l'écran.
    const dx: [number, number] = [0.25 * c, 0.25 * s];
    const dy: [number, number] = [-s, c];
    return { dx, dy };
  };

  it('reads an axis-aligned stretch as the shorter derivative', () => {
    const { dx, dy } = horizon(0);
    expect(maxPxPerTexel(dx, dy)).toBeCloseTo(4, 9);
    expect(maxPxPerTexel([0.5, 0], [0, 0.5])).toBeCloseTo(2, 9);
  });

  it('does not depend on how the stretch is oriented on screen', () => {
    for (const degrees of [10, 20, 33, 45, 70, 90, 135]) {
      const { dx, dy } = horizon(degrees);
      expect(maxPxPerTexel(dx, dy), `${degrees}°`).toBeCloseTo(4, 9);
    }
  });

  it('sees the horizon the shorter derivative missed (2026-10-14)', () => {
    // Même jacobienne, mais la direction comprimée tournée de 20° par rapport aux axes de
    // l'écran (J = diag(0,25 ; 1) · R(20°)) : chaque colonne mélange les deux étirements.
    const a = (20 * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const dx: [number, number] = [0.25 * c, s];
    const dy: [number, number] = [-0.25 * s, c];
    const shorterDerivative =
      1 / Math.min(Math.hypot(...dx), Math.hypot(...dy));
    expect(shorterDerivative).toBeLessThan(MAGNIFICATION_FADE_START_PX);
    expect(maxPxPerTexel(dx, dy)).toBeCloseTo(4, 9);
    expect(magnificationFade(maxPxPerTexel(dx, dy))).toBeLessThan(1);
  });

  it('computes the same thing in the shader', () => {
    expect(MAGNIFICATION_FADE_GLSL).toContain('jDet / sigmaMax');
    expect(MAGNIFICATION_FADE_GLSL).not.toContain('min( length(');
  });
});
