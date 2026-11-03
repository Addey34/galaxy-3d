import { describe, expect, it } from 'vitest';
import { equatorialToScene } from './frames';
import { apply, sceneToSkyImage } from './galactic';

const rad = (d: number) => (d * Math.PI) / 180;

/** Colonne et ligne de l'image (degrés depuis le centre, +droite, +haut) lues par `equirectUv`. */
function imageOffset(raDeg: number, decDeg: number) {
  const eq = [
    Math.cos(rad(decDeg)) * Math.cos(rad(raDeg)),
    Math.cos(rad(decDeg)) * Math.sin(rad(raDeg)),
    Math.sin(rad(decDeg)),
  ] as const;
  const s = equatorialToScene(...eq);
  const t = apply(sceneToSkyImage(), [s.x, s.y, s.z]);
  // equirectUv de Three.js : u = atan2(z, x) / 2π + 0.5 ; v = asin(y) / π + 0.5
  return {
    right: (Math.atan2(t[2], t[0]) * 180) / Math.PI,
    up: (Math.asin(t[1]) * 180) / Math.PI,
  };
}

describe('sceneToSkyImage', () => {
  it("est orthogonale, de déterminant −1 (le ciel vu de l'intérieur est en miroir)", () => {
    const m = sceneToSkyImage();
    const det =
      m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
      m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
      m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    expect(det).toBeCloseTo(-1, 9);
    for (const e of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as const) {
      const v = apply(m, e);
      expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    }
  });

  it("place le centre galactique au centre de l'image", () => {
    const o = imageOffset(266.4051, -28.93617);
    expect(o.right).toBeCloseTo(0, 1);
    expect(o.up).toBeCloseTo(0, 1);
  });

  it('place le Grand Nuage de Magellan à 80° à droite et 33° AU-DESSUS (haut = pôle sud)', () => {
    // LMC : l = 280,5°, b = −32,9°. Mesuré sur l'image : blob à +80° / +33°.
    const o = imageOffset(80.894, -69.756);
    expect(o.right).toBeCloseTo(79.5, 0);
    expect(o.up).toBeCloseTo(32.9, 0);
  });

  it("place le pôle galactique nord en bas de l'image", () => {
    expect(imageOffset(192.85948, 27.12825).up).toBeCloseTo(-90, 3);
  });
});
