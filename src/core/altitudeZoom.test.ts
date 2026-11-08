import { describe, expect, it } from 'vitest';
import {
  altitudeDistanceFactor,
  altitudeMotionFactor,
  MOTION_FLOOR,
} from './altitudeZoom';

const CRAN = Math.pow(0.95, 1.1);

describe('altitudeDistanceFactor', () => {
  it('sans dégagement, garde le facteur d’OrbitControls', () => {
    expect(altitudeDistanceFactor(100, 0, CRAN, true)).toBeCloseTo(CRAN, 12);
    expect(altitudeDistanceFactor(100, 0, CRAN, false)).toBeCloseTo(
      1 / CRAN,
      12
    );
  });

  it('loin du corps, tend vers le facteur d’origine', () => {
    const f = altitudeDistanceFactor(1e6, 1, CRAN, true);
    expect(f).toBeCloseTo(CRAN, 5);
  });

  it('multiplie l’ALTITUDE par le facteur du cran', () => {
    const c = 2;
    const d = 2.3;
    const f = altitudeDistanceFactor(d, c, CRAN, true);
    expect((d * f - c) / (d - c)).toBeCloseTo(CRAN, 12);
  });

  it('ralentit exponentiellement vers la surface', () => {
    const c = 1;
    let d = 60;
    let dernierPas = Infinity;
    for (let i = 0; i < 80; i += 1) {
      const next = d * altitudeDistanceFactor(d, c, CRAN, true);
      const pas = d - next;
      expect(pas).toBeLessThan(dernierPas);
      expect(next).toBeGreaterThan(c);
      dernierPas = pas;
      d = next;
    }
  });

  it('un cran vers l’intérieur puis vers l’extérieur ramène au point de départ', () => {
    const c = 3;
    const d = 3.4;
    const dedans = d * altitudeDistanceFactor(d, c, CRAN, true);
    const retour = dedans * altitudeDistanceFactor(dedans, c, CRAN, false);
    expect(retour).toBeCloseTo(d, 12);
  });

  it('ne traverse jamais le dégagement, même pour un cran énorme', () => {
    const f = altitudeDistanceFactor(1.01, 1, 0.01, true);
    expect(1.01 * f).toBeGreaterThan(1);
  });

  it('retombe sur le facteur brut si la caméra est déjà sous le dégagement', () => {
    expect(altitudeDistanceFactor(0.5, 1, CRAN, true)).toBeCloseTo(CRAN, 12);
  });
});

describe('altitudeMotionFactor', () => {
  it('vaut 1 sans dégagement (vue d’ensemble)', () => {
    expect(altitudeMotionFactor(100, 0)).toBe(1);
  });

  it('vaut presque 1 loin du corps', () => {
    expect(altitudeMotionFactor(1e6, 1)).toBeGreaterThan(0.999);
  });

  it('vaut altitude / distance entre les deux', () => {
    expect(altitudeMotionFactor(2, 1)).toBeCloseTo(0.5, 12);
    expect(altitudeMotionFactor(10, 1)).toBeCloseTo(0.9, 12);
  });

  it('décroît vers la surface sans jamais passer sous le plancher', () => {
    expect(altitudeMotionFactor(1.0001, 1)).toBe(MOTION_FLOOR);
    expect(altitudeMotionFactor(1, 1)).toBe(MOTION_FLOOR);
    expect(altitudeMotionFactor(0.5, 1)).toBe(MOTION_FLOOR);
  });
});
