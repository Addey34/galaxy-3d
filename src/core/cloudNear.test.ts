import { describe, expect, it } from 'vitest';

import {
  CLOUD_NEAR_GLSL,
  NEAR_CLOUD_MAX_LOD,
  NEAR_TARGET_PX,
  nearCloudLod,
  nearModisGate,
  residualPxPerTexel,
} from './cloudNear';
import {
  MAGNIFICATION_FADE_END_PX,
  MAGNIFICATION_FADE_START_PX,
} from './dataMagnification';

describe('les nuages réels de près', () => {
  it('loin (texel net), aucun niveau plus grossier : la donnée est montrée telle quelle', () => {
    expect(nearCloudLod(0.5)).toBe(0);
    expect(nearCloudLod(NEAR_TARGET_PX)).toBe(0);
  });

  it('de près, le texel effectif tient dans la cible : ni carré visible, ni effacement de la couche', () => {
    // Kerguelen à 22,5 km : coque à 10 km, texel de 250 m à ~12,5 km, ~16 px par texel (mesure de 2026-11-25).
    for (const px of [4, 8, 16, 50, 150]) {
      const residual = residualPxPerTexel(px);
      expect(residual).toBeCloseTo(NEAR_TARGET_PX, 6);
      expect(residual).toBeLessThanOrEqual(MAGNIFICATION_FADE_START_PX + 1e-9);
    }
  });

  it("au-delà du plafond de niveaux, la règle d'effacement reprend : pas de « nuage » de 16 km de texel", () => {
    const px = NEAR_TARGET_PX * 2 ** NEAR_CLOUD_MAX_LOD * 4;
    expect(nearCloudLod(px)).toBe(NEAR_CLOUD_MAX_LOD);
    expect(residualPxPerTexel(px)).toBeGreaterThan(MAGNIFICATION_FADE_END_PX);
  });

  it('jamais plus fin que la donnée : le niveau est toujours ≥ 0 et croît avec le grossissement', () => {
    let previous = 0;
    for (let px = 0.1; px < 2000; px *= 1.3) {
      const lod = nearCloudLod(px);
      expect(lod).toBeGreaterThanOrEqual(0);
      expect(lod).toBeGreaterThanOrEqual(previous);
      previous = lod;
    }
  });

  it('le GLSL porte les mêmes constantes que son miroir', () => {
    expect(CLOUD_NEAR_GLSL).toContain(`${NEAR_TARGET_PX}.0`);
    expect(CLOUD_NEAR_GLSL).toContain(`${NEAR_CLOUD_MAX_LOD}.0`);
  });

  it('le prolongement de près est fermé là où MODIS ne voit pas de nuage (neige), ouvert sans couverture MODIS', () => {
    expect(nearModisGate(0, true)).toBe(0);
    expect(nearModisGate(0.02, true)).toBe(0);
    expect(nearModisGate(0.8, true)).toBe(1);
    expect(nearModisGate(0, false)).toBe(1);
  });
});
