import { describe, expect, it } from 'vitest';
import {
  MAGNIFICATION_FADE_END_PX,
  MAGNIFICATION_FADE_GLSL,
  MAGNIFICATION_FADE_START_PX,
  MAGNIFICATION_FLOOR_PARS_GLSL,
  MAGNIFICATION_KEPT_FLOOR,
  magnificationFloorUniform,
  setKeepAppearanceLayers,
  magnificationFade,
  pxPerTexel,
} from './dataMagnification';
import { texelMagnification } from './surfaceApproach';

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

describe('keeping the layer (floor)', () => {
  it('never goes below the floor, and still ramps down to it', () => {
    expect(magnificationFade(14, 0.4)).toBeCloseTo(0.4, 12);
    expect(magnificationFade(0.3, 0.4)).toBe(1);
    const mid = magnificationFade(4.5, 0.4);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(1);
  });

  it('is the shared uniform that every material reads, off by default', () => {
    expect(magnificationFloorUniform.value).toBe(0);
    setKeepAppearanceLayers(true);
    expect(magnificationFloorUniform.value).toBe(MAGNIFICATION_KEPT_FLOOR);
    setKeepAppearanceLayers(false);
    expect(magnificationFloorUniform.value).toBe(0);
    expect(MAGNIFICATION_FADE_GLSL).toContain('mix( uMagFloor, 1.0,');
  });
});

describe('pxPerTexel', () => {
  // La Terre vue de 1 306 km d'altitude (mesure du 2026-10-19), nuages du jour de 2 048 x 1 024.
  const earth = {
    shellRadius: 6371 * 1.01,
    texelsWide: 2048,
    texelsHigh: 1024,
  };
  const fov = 55 * (Math.PI / 180);
  const viewportHeightPx = 800;
  const pixelAngle = (2 * Math.tan(fov / 2)) / viewportHeightPx;

  it('agrees with the nadir arithmetic of the surface approach', () => {
    // Au centre de l'écran, regard vers le bas, la coquille est à (altitude − 1 % du rayon).
    const altitudeKm = 1306.597;
    const viewDistance = altitudeKm - 0.01 * 6371;
    const analytic = pxPerTexel({ ...earth, viewDistance, pixelAngle });
    const approach = texelMagnification({
      textureWidthPx: 2048,
      radiusKm: earth.shellRadius,
      altitudeKm: viewDistance,
      fovDeg: 55,
      viewportHeightPx,
    });
    expect(analytic).toBeCloseTo(approach, 6);
    // ~12 px par texel : bien au-delà de la fin du fondu, donc la couche a disparu.
    expect(magnificationFade(analytic)).toBe(0);
  });

  it('is smooth: it only depends on distance, never on a mesh triangle', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let km = 800; km < 20_000; km *= 1.05) {
      const px = pxPerTexel({ ...earth, viewDistance: km, pixelAngle });
      expect(px).toBeLessThan(previous);
      previous = px;
    }
  });

  it('keeps clouds whole from the orbit the lot 48 thresholds were read at', () => {
    // 4 235 km au-dessus de la coquille : 3,6 px par texel, les nuages se lisent encore.
    const px = pxPerTexel({ ...earth, viewDistance: 4235, pixelAngle });
    expect(px).toBeGreaterThan(3);
    expect(px).toBeLessThan(4);
  });

  it('takes the longer side of a texel for a map wider than 2:1', () => {
    const wide = pxPerTexel({
      shellRadius: 1,
      texelsWide: 1000,
      texelsHigh: 100,
      viewDistance: 1,
      pixelAngle: 1,
    });
    // Côté d'est (2/1000) plus court que le côté du nord (1/100) : le nord décide.
    expect(wide).toBeCloseTo(Math.PI / 100, 12);
  });

  it('computes the same thing in the shader, from the camera and not from the mesh', () => {
    expect(MAGNIFICATION_FLOOR_PARS_GLSL).toContain('dFdx( magRay )');
    expect(MAGNIFICATION_FLOOR_PARS_GLSL).toContain('vMagShell');
    expect(MAGNIFICATION_FADE_GLSL).toContain('magnificationPxPerTexel(');
    // Les dérivées d'UV, constantes par triangle, ont dessiné le maillage sur l'océan.
    expect(MAGNIFICATION_FADE_GLSL).not.toContain('dFdx( texelCoord )');
    expect(MAGNIFICATION_FADE_GLSL).not.toContain('vMapUv');
  });
});
