import { describe, expect, it } from 'vitest';
import { HORIZON_ABOVE_CENTRE_OF_FOV, horizonTiltRad } from './horizonTilt';

const deg = (rad: number) => (rad * 180) / Math.PI;
const R = 6371;
const FOV = 55;

describe('horizonTiltRad', () => {
  it('leaves the globe centred while it does not fill the frame', () => {
    expect(horizonTiltRad(R * 7, R, FOV)).toBe(0);
    expect(horizonTiltRad(R * 3.5, R, FOV)).toBe(0);
  });

  it('starts exactly where the limb reaches its line above the centre', () => {
    const above = FOV * HORIZON_ABOVE_CENTRE_OF_FOV;
    // Le limbe est à `above` du nadir quand acos(R / d) = 90° − above.
    const start = R / Math.cos(((90 - above) * Math.PI) / 180);
    expect(horizonTiltRad(start * 1.0001, R, FOV)).toBe(0);
    expect(horizonTiltRad(start * 0.999, R, FOV)).toBeGreaterThan(0);
    // Vers 2,2 rayons d'altitude pour un champ de 55°, comme l'écrit le module.
    expect(start / R - 1).toBeCloseTo(2.19, 1);
  });

  it('keeps the horizon at a third of the vertical field above the centre', () => {
    for (const h of [5, 50, 500, 3000]) {
      const d = R + h;
      const tilt = deg(horizonTiltRad(d, R, FOV));
      const limbFromNadir = 90 - deg(Math.acos(R / d));
      expect(limbFromNadir - tilt).toBeCloseTo(FOV / 3, 6);
    }
  });

  it('rises monotonically towards the horizon as the camera descends', () => {
    let previous = 0;
    for (const h of [10000, 3000, 1000, 300, 50, 10, 1]) {
      const tilt = horizonTiltRad(R + h, R, FOV);
      expect(tilt).toBeGreaterThan(previous);
      previous = tilt;
    }
    // À 1 km du sol : presque à l'horizontale, à fov / 3 près.
    expect(deg(previous)).toBeGreaterThan(70);
    expect(deg(previous)).toBeLessThan(90 - FOV / 3);
  });

  it('does nothing under the ground or without a radius', () => {
    expect(horizonTiltRad(R * 0.99, R, FOV)).toBe(0);
    expect(horizonTiltRad(R, 0, FOV)).toBe(0);
  });
});
