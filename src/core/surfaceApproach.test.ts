import { describe, expect, it } from 'vitest';
import {
  APPROACH_REFERENCE,
  altitudeKmForRadiusFactor,
  approachFloorRadiusFactor,
  approachTexelBudget,
  depthResolutionKm,
  facetDeviationKm,
  followNearPlane,
  groundTexelKm,
  radiusFactorForAltitudeKm,
  screenPixelsPerKm,
  texelMagnification,
} from './surfaceApproach';

/** Rayon publié de la Lune (NSSDCA), le corps du lot 9. */
const MOON_RADIUS_KM = 1737.4;

describe('résolution du tampon de profondeur', () => {
  it('vaut z² (1/n − 1/f) / (2^B − 1)', () => {
    // Valeur indépendante de l'implémentation, calculée à la main :
    // 100² × (1/1 − 1/1000) / (2^24 − 1) = 9990 / 16777215.
    const expected = (100 * 100 * (1 - 1 / 1000)) / (Math.pow(2, 24) - 1);
    expect(
      depthResolutionKm({
        nearKm: 1,
        farKm: 1000,
        distanceKm: 100,
        depthBits: 24,
      })
    ).toBeCloseTo(expected, 12);
  });

  it('se dégrade avec le CARRÉ de la distance, pas linéairement', () => {
    const base = { nearKm: 1, farKm: 1e6, depthBits: 24 };
    const near = depthResolutionKm({ ...base, distanceKm: 10 });
    const far = depthResolutionKm({ ...base, distanceKm: 100 });
    expect(far / near).toBeCloseTo(100, 6);
  });

  it('un near dix fois plus serré rend la profondeur dix fois plus grossière', () => {
    // 1/n domine dès que f ≫ n : c'est pourquoi resserrer le near au ras de la surface
    // (ce que fait `_updateExploClipPlanes`) COÛTE de la précision au loin, et en gagne
    // seulement parce que le far se resserre en même temps.
    const serre = depthResolutionKm({
      nearKm: 0.1,
      farKm: 1e6,
      distanceKm: 100,
      depthBits: 24,
    });
    const large = depthResolutionKm({
      nearKm: 1,
      farKm: 1e6,
      distanceKm: 100,
      depthBits: 24,
    });
    expect(serre / large).toBeCloseTo(10, 3);
  });

  it('refuse une configuration impossible plutôt que de rendre un nombre', () => {
    expect(
      depthResolutionKm({
        nearKm: 0,
        farKm: 10,
        distanceKm: 1,
        depthBits: 24,
      })
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      depthResolutionKm({
        nearKm: 10,
        farKm: 10,
        distanceKm: 1,
        depthBits: 24,
      })
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('silhouette facettée', () => {
  it('la Lune à 64 segments rentre de 2,09 km sous sa vraie surface', () => {
    // r (1 − cos(π/64)) : c'est la dentelure visible au limbe, indépendante de la distance.
    expect(facetDeviationKm(MOON_RADIUS_KM, 64)).toBeCloseTo(2.093, 3);
  });

  it('quadrupler les segments divise l’écart par environ quatre', () => {
    const a = facetDeviationKm(MOON_RADIUS_KM, 64);
    const b = facetDeviationKm(MOON_RADIUS_KM, 256);
    // L'écart varie en 1/N² : 4 fois plus de segments → 16 fois moins d'écart.
    expect(a / b).toBeCloseTo(16, 1);
  });

  it('rend zéro pour une géométrie absurde au lieu de NaN', () => {
    expect(facetDeviationKm(0, 64)).toBe(0);
    expect(facetDeviationKm(MOON_RADIUS_KM, 0)).toBe(0);
  });
});

describe('texel au sol et agrandissement', () => {
  it('la surface 8k de la Lune vaut 1,33 km par texel', () => {
    expect(groundTexelKm(8192, MOON_RADIUS_KM)).toBeCloseTo(1.33257, 4);
  });

  it('un agrandissement de 1 est la résolution native de la source', () => {
    // Altitude choisie pour que le texel couvre exactement un pixel : l'étendue visible
    // vaut alors (hauteur du viewport) texels.
    const texelKm = groundTexelKm(8192, MOON_RADIUS_KM);
    const fovDeg = 65;
    const viewportHeightPx = 800;
    const altitudeKm =
      (texelKm * viewportHeightPx) /
      (2 * Math.tan((fovDeg * Math.PI) / 180 / 2));
    expect(
      texelMagnification({
        textureWidthPx: 8192,
        radiusKm: MOON_RADIUS_KM,
        altitudeKm,
        fovDeg,
        viewportHeightPx,
      })
    ).toBeCloseTo(1, 6);
  });

  it('descendre deux fois plus bas agrandit deux fois plus', () => {
    const at = (altitudeKm: number): number =>
      texelMagnification({
        textureWidthPx: 8192,
        radiusKm: MOON_RADIUS_KM,
        altitudeKm,
        fovDeg: 65,
        viewportHeightPx: 800,
      });
    expect(at(50) / at(100)).toBeCloseTo(2, 6);
  });

  it('les pixels par kilomètre ne dépendent que de l’altitude, du champ et de la hauteur', () => {
    // 2 h tan(fov/2) au dénominateur : vérifié contre un calcul à la main.
    const span = 2 * 10 * Math.tan((65 * Math.PI) / 180 / 2);
    expect(
      screenPixelsPerKm({ altitudeKm: 10, fovDeg: 65, viewportHeightPx: 800 })
    ).toBeCloseTo(800 / span, 9);
  });
});

describe('plan proche en suivi rapproché', () => {
  it('ne dépasse JAMAIS l’altitude, si basse soit-elle', () => {
    // La garde qui manquait : sous 1 % du rayon, l'ancien plancher (r × 0,01) passait
    // devant la surface et faisait disparaître le corps entier.
    const r = 1;
    for (const altitude of [0.5, 0.1, 0.01, 0.005, 0.001, 1e-4, 1e-5]) {
      const near = followNearPlane(r + altitude, r, 1e-9);
      expect(near).toBeLessThan(altitude);
    }
  });

  it('vaut exactement la moitié de l’altitude tant que le minimum ne mord pas', () => {
    expect(followNearPlane(1.2, 1, 1e-9)).toBeCloseTo(0.1, 12);
  });

  it('reste strictement positif quand la caméra touche la sphère de dégagement', () => {
    expect(followNearPlane(1, 1, 1e-9)).toBe(1e-9);
    expect(followNearPlane(0.9, 1, 1e-9)).toBe(1e-9);
  });

  it('l’ancienne règle coupait le corps, et c’est reproductible', () => {
    // Confrontation explicite : plancher à 1 % du rayon, altitude de 0,5 % → le plan proche
    // est DEVANT la surface. Mesuré à l'écran le 2026-09-20 (Lune invisible sous 17,4 km).
    const ancienne = (d: number, r: number): number =>
      Math.max((d - r) * 0.5, r * 0.01);
    const r = 1737.4;
    const altitude = 0.005 * r;
    expect(ancienne(r + altitude, r)).toBeGreaterThan(altitude);
    expect(followNearPlane(r + altitude, r, 1e-9)).toBeLessThan(altitude);
  });
});

describe('plancher dérivé de la finesse de l’image', () => {
  it('ne dépend pas du rayon du corps, par construction', () => {
    // L'altitude visée vaut budget × 2πr / W et le facteur 1 + altitude / r : r disparaît.
    // C'est ce qui permet d'exprimer le plancher en rayons sans mentir sur les petits corps.
    const factor = approachFloorRadiusFactor(8192);
    for (const radiusKm of [252.1, 1737.4, 6371, 69911]) {
      const altitudeKm = altitudeKmForRadiusFactor(radiusKm, factor);
      const texels = altitudeKm / groundTexelKm(8192, radiusKm);
      expect(texels).toBeCloseTo(approachTexelBudget(), 6);
    }
  });

  it('tient l’agrandissement visé sur l’écran de référence, quelle que soit la texture', () => {
    for (const widthPx of [1024, 2048, 4096, 8192]) {
      const radiusKm = 1737.4;
      const altitudeKm = altitudeKmForRadiusFactor(
        radiusKm,
        approachFloorRadiusFactor(widthPx)
      );
      expect(
        texelMagnification({
          textureWidthPx: widthPx,
          radiusKm,
          altitudeKm,
          fovDeg: APPROACH_REFERENCE.fovDeg,
          viewportHeightPx: APPROACH_REFERENCE.viewportHeightPx,
        })
      ).toBeCloseTo(APPROACH_REFERENCE.magnificationPxPerTexel, 6);
    }
  });

  it('descend pour une image fine et remonte pour une image grossière', () => {
    // Le défaut que cette règle corrige : une constante unique laissait approcher un corps
    // 1k aussi près qu'un corps 8k, huit fois au-delà de ce que sa source montre.
    const fine = approachFloorRadiusFactor(8192);
    const grossiere = approachFloorRadiusFactor(1024);
    expect(fine).toBeLessThan(1.15);
    expect(grossiere).toBeGreaterThan(1.15);
    expect(altitudeKmForRadiusFactor(1737.4, fine)).toBeCloseTo(128.0, 1);
    expect(altitudeKmForRadiusFactor(252.1, grossiere)).toBeCloseTo(148.6, 1);
  });

  it('reste au-dessus de la coque d’atmosphère la plus haute du dépôt (1,02 rayon)', () => {
    // Entrer dans les coques concentriques les fait voir de l'INTÉRIEUR, ce pour quoi elles
    // ne sont pas faites, et double le coût de rendu (mesuré : Terre 10,4 → 5,2 img/s).
    expect(approachFloorRadiusFactor(8192)).toBeGreaterThan(1.02);
  });

  it('rend 1 plutôt qu’un nombre absurde sans image', () => {
    expect(approachFloorRadiusFactor(0)).toBe(1);
    expect(approachFloorRadiusFactor(8192, 0)).toBe(1);
  });
});

describe('plancher d’approche', () => {
  it('1,15 rayon vaut 260,6 km au-dessus de la Lune', () => {
    expect(altitudeKmForRadiusFactor(MOON_RADIUS_KM, 1.15)).toBeCloseTo(
      260.61,
      2
    );
  });

  it('facteur et altitude sont réciproques', () => {
    const factor = radiusFactorForAltitudeKm(MOON_RADIUS_KM, 1);
    expect(altitudeKmForRadiusFactor(MOON_RADIUS_KM, factor)).toBeCloseTo(1, 9);
    expect(factor).toBeCloseTo(1.0005756, 7);
  });
});
