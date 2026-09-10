import { describe, expect, it } from 'vitest';
import { boundingRadius, fitScale } from './modelFit';

/** Nuage de points régulier sur une sphère de rayon `r` centrée à l'origine. */
function sphereCloud(r: number, steps = 24): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const lat = (i / steps) * Math.PI - Math.PI / 2;
    for (let j = 0; j < steps; j++) {
      const lon = (j / steps) * Math.PI * 2;
      out.push(
        r * Math.cos(lat) * Math.cos(lon),
        r * Math.sin(lat),
        r * Math.cos(lat) * Math.sin(lon)
      );
    }
  }
  return out;
}

describe('boundingRadius', () => {
  it('mesure le rayon RÉEL, pas la demi-diagonale de la boîte', () => {
    // LE défaut que cette fonction existe pour empêcher. `Box3.getBoundingSphere()` circonscrit
    // la BOÎTE : pour une sphère de rayon 1 elle renvoie √3 ≈ 1,732. Un modèle mis à l'échelle
    // avec cette valeur sort 42 % trop petit — et n'a l'air de rien, tant qu'on ne le compare
    // pas à la sphère qu'il remplace.
    const cloud = sphereCloud(1);
    expect(boundingRadius(cloud, [0, 0, 0])).toBeCloseTo(1, 6);
    expect(boundingRadius(cloud, [0, 0, 0])).toBeLessThan(Math.SQRT2);
  });

  it('suit le centre qu’on lui donne', () => {
    // Le modèle est recentré avant d'être mesuré : mesurer depuis l'origine d'un corps décentré
    // gonflerait le rayon et rétrécirait le corps d'autant.
    const cloud = sphereCloud(1).map((v, i) => (i % 3 === 0 ? v + 10 : v));
    expect(boundingRadius(cloud, [10, 0, 0])).toBeCloseTo(1, 6);
    expect(boundingRadius(cloud, [0, 0, 0])).toBeCloseTo(11, 6);
  });

  it('rend le sommet le plus lointain d’une forme irrégulière', () => {
    // Une pointe isolée doit dicter le rayon : c'est elle qui sortirait du cadre.
    const cloud = [...sphereCloud(1), 0, 3, 0];
    expect(boundingRadius(cloud, [0, 0, 0])).toBeCloseTo(3, 6);
  });

  it('rend 0 sur un nuage vide plutôt que de lever', () => {
    expect(boundingRadius([], [0, 0, 0])).toBe(0);
  });
});

describe('fitScale', () => {
  it('ramène un modèle au rayon voulu quelle que soit son unité', () => {
    // Le fichier de Bennu est en kilomètres (rayon ≈ 0,25) ; la scène veut 0,1 unité.
    expect(fitScale(0.2458, 0.1)).toBeCloseTo(0.4068, 4);
    expect(fitScale(700, 0.1)).toBeCloseTo(0.00014286, 8);
  });

  it('refuse une échelle absurde au lieu d’afficher n’importe quoi', () => {
    // Un modèle vide, un rayon catalogue à zéro, un NaN venu d'un fichier tordu : le corps doit
    // rester la sphère de repli, pas devenir un point ou un objet de taille infinie.
    expect(fitScale(0, 0.1)).toBe(null);
    expect(fitScale(1, 0)).toBe(null);
    expect(fitScale(Number.NaN, 0.1)).toBe(null);
    expect(fitScale(1, Number.POSITIVE_INFINITY)).toBe(null);
  });
});
