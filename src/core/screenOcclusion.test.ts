import { describe, expect, it } from 'vitest';
import { ScreenOcclusion, segmentBlockedBySphere } from './screenOcclusion';

const MARS = { name: 'mars', x: 0, y: 0, z: 0, radius: 1 };
const CAMERA = { x: 0, y: 0, z: 1.3 };

describe('un marqueur derrière un corps (ligne 45.8)', () => {
  it('est caché quand le corps est entre la caméra et lui', () => {
    expect(segmentBlockedBySphere(0, 0, 1.3, 0.2, 0.1, -50, 0, 0, 0, 1)).toBe(
      true
    );
  });

  it('reste visible quand le corps est derrière LUI, ou à côté de la ligne de visée', () => {
    // Entre la caméra et la planète.
    expect(segmentBlockedBySphere(0, 0, 1.3, 0, 0, 1.1, 0, 0, 0, 1)).toBe(
      false
    );
    // La droite passe à 1,30 du centre, au-dessus de la surface.
    expect(segmentBlockedBySphere(0, 0, 1.3, 50, 0, 0, 0, 0, 0, 1)).toBe(false);
  });

  it('cache un point SOUS la surface, et pas un point juste au-dessus du limbe', () => {
    expect(segmentBlockedBySphere(0, 0, 3, 0, 0, 0.5, 0, 0, 0, 1)).toBe(true);
    // Rasant le limbe, du bon côté : le segment passe à 1,01 du centre.
    expect(segmentBlockedBySphere(-5, 1.01, 0, 5, 1.01, 0, 0, 0, 0, 1)).toBe(
      false
    );
  });

  it('ne retient que les corps assez grands à l’écran, et ignore un corps qui contient la caméra', () => {
    const occlusion = new ScreenOcclusion();
    occlusion.set(CAMERA, [
      MARS,
      { name: 'ceres', x: 1e6, y: 0, z: 0, radius: 1 },
      { name: 'inside', x: 0, y: 0, z: 1.2, radius: 0.5 },
    ]);
    expect(occlusion.size).toBe(1);
    expect(occlusion.hides(0, 0, -100)).toBe(true);
    expect(occlusion.hides(0, 100, 0)).toBe(false);
  });

  it('ne cache pas le repère du corps lui-même', () => {
    const occlusion = new ScreenOcclusion();
    occlusion.set(CAMERA, [MARS]);
    // Le centre de Mars est derrière sa propre surface : seul `except` le laisse visible.
    expect(occlusion.hides(0, 0, 0)).toBe(true);
    expect(occlusion.hides(0, 0, 0, 'mars')).toBe(false);
  });
});
