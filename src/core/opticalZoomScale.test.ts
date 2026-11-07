import { describe, expect, it } from 'vitest';
import {
  ZOOM_POSITION_MAX,
  ZOOM_POSITION_STEP,
  fovFromZoomPosition,
  zoomPositionFromFov,
} from './opticalZoomScale';

const MIN = 8;
const MAX = 55;
const mag = (fov: number) => 1 / Math.tan((fov * Math.PI) / 360);

describe('échelle du zoom optique', () => {
  it('place les bornes aux extrémités de la course', () => {
    expect(fovFromZoomPosition(0, MIN, MAX)).toBeCloseTo(MAX, 9);
    expect(fovFromZoomPosition(ZOOM_POSITION_MAX, MIN, MAX)).toBeCloseTo(
      MIN,
      9
    );
    expect(zoomPositionFromFov(MAX, MIN, MAX)).toBe(0);
    expect(zoomPositionFromFov(MIN, MIN, MAX)).toBe(ZOOM_POSITION_MAX);
  });

  it('est monotone : plus on avance, plus le champ se resserre', () => {
    let previous = Infinity;
    for (let p = 0; p <= ZOOM_POSITION_MAX; p += ZOOM_POSITION_STEP) {
      const fov = fovFromZoomPosition(p, MIN, MAX);
      expect(fov).toBeLessThan(previous);
      previous = fov;
    }
  });

  it('donne le même rapport de grossissement à chaque pas, pas le même nombre de degrés', () => {
    const ratio = (p: number) =>
      mag(fovFromZoomPosition(p + ZOOM_POSITION_STEP, MIN, MAX)) /
      mag(fovFromZoomPosition(p, MIN, MAX));
    expect(ratio(0)).toBeCloseTo(ratio(500), 9);
    expect(ratio(0)).toBeCloseTo(
      ratio(ZOOM_POSITION_MAX - ZOOM_POSITION_STEP),
      9
    );
    // Environ 1 % par appui de flèche.
    expect(ratio(0)).toBeGreaterThan(1.009);
    expect(ratio(0)).toBeLessThan(1.011);
  });

  it('le milieu de course est la moyenne géométrique des grossissements, pas celle des degrés', () => {
    const half = fovFromZoomPosition(ZOOM_POSITION_MAX / 2, MIN, MAX);
    expect(mag(half)).toBeCloseTo(Math.sqrt(mag(MIN) * mag(MAX)), 9);
    expect(half).toBeLessThan((MIN + MAX) / 2);
  });

  it("l'aller-retour position, champ, position est exact sur chaque pas", () => {
    for (let p = 0; p <= ZOOM_POSITION_MAX; p += ZOOM_POSITION_STEP) {
      const fov = fovFromZoomPosition(p, MIN, MAX);
      expect(zoomPositionFromFov(fov, MIN, MAX)).toBe(p);
    }
  });

  it('borne un champ hors course au lieu de sortir du curseur', () => {
    expect(zoomPositionFromFov(120, MIN, MAX)).toBe(0);
    expect(zoomPositionFromFov(1, MIN, MAX)).toBe(ZOOM_POSITION_MAX);
    expect(fovFromZoomPosition(-50, MIN, MAX)).toBeCloseTo(MAX, 9);
    expect(fovFromZoomPosition(5000, MIN, MAX)).toBeCloseTo(MIN, 9);
  });
});
