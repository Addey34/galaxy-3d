import { describe, expect, it } from 'vitest';
import {
  bodyAngularRadiusRad,
  centeringTurnRad,
  freeBandAnchor,
  halfHorizontalFieldRad,
  projectedTangents,
  viewOffsetPixels,
} from './skyCentering';

const DEG = Math.PI / 180;

describe('centeringTurnRad', () => {
  const half = 30 * DEG;

  it('reste entre 30 % et 80 % du demi-champ', () => {
    expect(centeringTurnRad(0, half)).toBeCloseTo(0.3 * half, 12);
    expect(centeringTurnRad(20 * DEG, half)).toBeCloseTo(0.8 * half, 12);
    expect(centeringTurnRad(Math.PI / 2, half)).toBeCloseTo(0.8 * half, 12);
  });

  it('dégage le disque du corps avec une marge quand il y a de la place', () => {
    const r = 6 * DEG;
    const turn = centeringTurnRad(r, half);
    expect(turn).toBeGreaterThan(r);
    expect(turn).toBeCloseTo(1.5 * r + 0.15 * half, 12);
  });

  it('un rayon négatif ou nul ne donne jamais moins que le plancher', () => {
    expect(centeringTurnRad(-1, half)).toBeCloseTo(0.3 * half, 12);
  });
});

describe('halfHorizontalFieldRad', () => {
  const fov = 50 * DEG;

  it('paysage : plus large que le demi-champ vertical', () => {
    const horizontal = halfHorizontalFieldRad(fov, 16 / 9);
    expect(horizontal).toBeCloseTo(
      Math.atan(Math.tan(25 * DEG) * (16 / 9)),
      12
    );
    expect(horizontal).toBeGreaterThan(25 * DEG);
  });

  it('portrait : plus étroit que le demi-champ vertical', () => {
    expect(halfHorizontalFieldRad(fov, 0.5)).toBeLessThan(25 * DEG);
  });

  it('carré : égal au demi-champ vertical', () => {
    expect(halfHorizontalFieldRad(fov, 1)).toBeCloseTo(25 * DEG, 12);
  });
});

describe('bodyAngularRadiusRad', () => {
  it('asin(rayon / distance)', () => {
    expect(bodyAngularRadiusRad(1, 2)).toBeCloseTo(Math.asin(0.5), 12);
  });

  it('un corps dont on est dedans remplit le champ', () => {
    expect(bodyAngularRadiusRad(5, 5)).toBeCloseTo(Math.PI / 2, 12);
    expect(bodyAngularRadiusRad(5, 1)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('une donnée absente ne donne aucun disque', () => {
    expect(bodyAngularRadiusRad(0, 10)).toBe(0);
    expect(bodyAngularRadiusRad(1, 0)).toBe(0);
    expect(bodyAngularRadiusRad(Number.NaN, 10)).toBe(0);
  });
});

describe('projectedTangents', () => {
  it('droit devant : (0, 0)', () => {
    expect(projectedTangents([0, 0, -1])).toEqual({ tx: 0, ty: 0 });
  });

  it('45° à droite et 45° en haut : tangentes de 1', () => {
    const p = projectedTangents([Math.SQRT1_2, 0, -Math.SQRT1_2]);
    expect(p?.tx).toBeCloseTo(1, 12);
    expect(p?.ty).toBeCloseTo(0, 12);
    const q = projectedTangents([0, Math.SQRT1_2, -Math.SQRT1_2]);
    expect(q?.ty).toBeCloseTo(1, 12);
  });

  it('derrière la caméra ou dans son plan : pas de projection', () => {
    expect(projectedTangents([0, 0, 1])).toBeNull();
    expect(projectedTangents([1, 0, 0])).toBeNull();
  });
});

describe('viewOffsetPixels', () => {
  const fov = 60 * DEG;

  it("amène une direction au centre : un objet au bord du champ décale d'une demi-hauteur", () => {
    // À demi-champ vertical (30°), la direction est à ty = tan 30° : décalage = demi-hauteur.
    const { y } = viewOffsetPixels(0, Math.tan(30 * DEG), 800, fov, 1);
    expect(y).toBeCloseTo(-400, 9);
  });

  it('le décalage vertical est négatif vers le haut', () => {
    expect(viewOffsetPixels(0, 0.2, 800, fov, 1).y).toBeLessThan(0);
    expect(viewOffsetPixels(0, -0.2, 800, fov, 1).y).toBeGreaterThan(0);
    expect(viewOffsetPixels(0.2, 0, 800, fov, 1).x).toBeGreaterThan(0);
  });

  it("l'ancre verticale place l'objet plus bas ou plus haut que le centre", () => {
    // Objet déjà au centre (ty = 0) : viser 70 % de la hauteur décale la fenêtre de 20 % vers le haut.
    expect(viewOffsetPixels(0, 0, 1000, fov, 1, 0.7).y).toBeCloseTo(-200, 9);
    expect(viewOffsetPixels(0, 0, 1000, fov, 1, 0.3).y).toBeCloseTo(200, 9);
    expect(viewOffsetPixels(0, 0, 1000, fov, 1, 0.5).y).toBeCloseTo(0, 9);
    expect(viewOffsetPixels(0, 0, 1000, fov, 0.5, 0.7).y).toBeCloseTo(-100, 9);
  });

  it('k = 0 ne décale rien, k = 0,5 décale de moitié', () => {
    const full = viewOffsetPixels(0.3, 0.1, 800, fov, 1);
    const none = viewOffsetPixels(0.3, 0.1, 800, fov, 0);
    const half = viewOffsetPixels(0.3, 0.1, 800, fov, 0.5);
    expect(none.x).toBeCloseTo(0, 12);
    expect(Math.abs(none.y)).toBeCloseTo(0, 12);
    expect(half.x).toBeCloseTo(full.x / 2, 9);
    expect(half.y).toBeCloseTo(full.y / 2, 9);
  });
});

describe('freeBandAnchor', () => {
  it('au bureau, la fiche est un coin : le centre reste libre', () => {
    expect(
      freeBandAnchor({ width: 320, bottom: 360 }, { width: 1280, height: 800 })
    ).toBe(0.5);
  });

  it('sur téléphone, vise le milieu entre le bas de la fiche et la barre de temps', () => {
    // Fiche large (feuille) finissant à 40 % de la hauteur ; barre de temps sur les 12 % du bas.
    const a = freeBandAnchor(
      { width: 350, bottom: 400 },
      { width: 390, height: 1000 }
    );
    expect(a).toBeCloseTo((0.4 + 0.88) / 2, 12);
  });

  it("une fiche qui descend jusqu'à la barre ne laisse aucune zone : le centre", () => {
    expect(
      freeBandAnchor({ width: 350, bottom: 950 }, { width: 390, height: 1000 })
    ).toBe(0.5);
  });

  it('un écran sans hauteur ne plante pas', () => {
    expect(
      freeBandAnchor({ width: 350, bottom: 100 }, { width: 390, height: 0 })
    ).toBe(0.5);
  });
});
