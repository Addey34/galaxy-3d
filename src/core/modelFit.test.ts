import { describe, expect, it } from 'vitest';
import {
  boundingRadius,
  fitScale,
  maxInertiaAxis,
  meshVolume,
  volumeEquivalentRadius,
} from './modelFit';

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

/** Boîte fermée [0,a]×[0,b]×[0,c] décalée de `o`, 12 triangles orientés vers l'extérieur. */
function box(a: number, b: number, c: number, o = [0, 0, 0]) {
  const p = [
    [0, 0, 0],
    [a, 0, 0],
    [a, b, 0],
    [0, b, 0],
    [0, 0, c],
    [a, 0, c],
    [a, b, c],
    [0, b, c],
  ].flatMap((q) => q.map((x, k) => x + o[k]!));
  const index = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2,
    3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ];
  return { positions: p, index };
}

describe('meshVolume', () => {
  it('rend le volume et le centre de masse d’un solide fermé', () => {
    const { positions, index } = box(4, 2, 1, [10, -3, 5]);
    const { volume, centroid } = meshVolume(positions, index);
    expect(volume).toBeCloseTo(8, 9);
    expect(centroid[0]).toBeCloseTo(12, 9);
    expect(centroid[1]).toBeCloseTo(-2, 9);
    expect(centroid[2]).toBeCloseTo(5.5, 9);
  });

  it('ne dépend pas de l’orientation des triangles du fichier', () => {
    const { positions, index } = box(4, 2, 1);
    const flipped = index.map((_, i) => index[i - (i % 3) + (2 - (i % 3))]!);
    expect(meshVolume(positions, flipped).volume).toBeCloseTo(8, 9);
    expect(meshVolume(positions, flipped).centroid[0]).toBeCloseTo(2, 9);
  });

  it('lit aussi un maillage non indexé', () => {
    const { positions, index } = box(1, 1, 1);
    const flat = index.flatMap((k) => positions.slice(k * 3, k * 3 + 3));
    expect(meshVolume(flat, null).volume).toBeCloseTo(1, 9);
  });
});

describe('volumeEquivalentRadius', () => {
  it('rend le rayon de la sphère de même volume', () => {
    expect(volumeEquivalentRadius((4 / 3) * Math.PI * 8)).toBeCloseTo(2, 12);
  });

  it('ne se confond pas avec le rayon maximal d’un corps allongé', () => {
    // Boîte 34 × 11 × 11 (les proportions d'Éros) : le sommet le plus lointain est à 18,7
    // du centre, la sphère de même volume a un rayon de 9,9. Ajuster le premier sur un rayon
    // moyen afficherait le corps 1,9 fois trop petit.
    const { positions, index } = box(34, 11, 11, [-17, -5.5, -5.5]);
    const { volume } = meshVolume(positions, index);
    const equivalent = volumeEquivalentRadius(volume);
    expect(boundingRadius(positions, [0, 0, 0]) / equivalent).toBeGreaterThan(
      1.8
    );
  });
});

describe('maxInertiaAxis', () => {
  it('trouve l’axe court d’un corps aplati — celui autour duquel il tourne', () => {
    // Boîte 4 × 1 × 3 : l'inertie est maximale autour de l'axe du plus PETIT côté (Y ici).
    const { positions, index } = box(4, 1, 3, [-2, -0.5, -1.5]);
    const axis = maxInertiaAxis(positions, index);
    expect(Math.abs(axis[1])).toBeCloseTo(1, 6);
  });

  it('suit le corps quand on le tourne', () => {
    // Même boîte, axe court porté par Z : l'axe trouvé doit suivre.
    const { positions, index } = box(4, 3, 1, [-2, -1.5, -0.5]);
    expect(Math.abs(maxInertiaAxis(positions, index)[2])).toBeCloseTo(1, 6);
  });
});
