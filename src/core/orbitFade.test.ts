import { describe, expect, it } from 'vitest';
import {
  ORBIT_FADE_FAR_RADII,
  ORBIT_FADE_NEAR_RADII,
  orbitLineOpacity,
} from './orbitFade';

const BASE = 0.25;
const asDeg = (radii: number): number =>
  (Math.asin(Math.min(1, 1 / radii)) * 180) / Math.PI;

describe('orbitLineOpacity', () => {
  it('efface complètement la ligne quand on est arrivé sur le corps', () => {
    // LE défaut à ne pas réintroduire : un trait d'orbite en travers d'un globe opaque, qui
    // se lit comme un globe transparent. La sonde de terminateur cadre à 4,2 rayons et c'est
    // là qu'il a été constaté — donc à 4,2 rayons il ne doit plus rien rester.
    expect(orbitLineOpacity(4.2, 1, BASE)).toBe(0);
    expect(orbitLineOpacity(ORBIT_FADE_NEAR_RADII, 1, BASE)).toBe(0);
    expect(orbitLineOpacity(0, 1, BASE)).toBe(0);
  });

  it('rend la ligne pleine dès que le corps n’est plus qu’un point', () => {
    expect(orbitLineOpacity(ORBIT_FADE_FAR_RADII, 1, BASE)).toBeCloseTo(
      BASE,
      12
    );
    expect(orbitLineOpacity(1e6, 1, BASE)).toBeCloseTo(BASE, 12);
  });

  it('exprime ses deux bornes en tailles angulaires défendables', () => {
    // Les bornes ne valent que si on peut dire ce qu'elles représentent. En rayons apparents :
    // près de 4° au seuil bas (le corps occupe la vue), moins de 1° au seuil haut (environ la
    // Lune vue de la Terre, soit un point sur sa trajectoire).
    expect(asDeg(ORBIT_FADE_NEAR_RADII)).toBeGreaterThan(3);
    expect(asDeg(ORBIT_FADE_NEAR_RADII)).toBeLessThan(5);
    expect(asDeg(ORBIT_FADE_FAR_RADII)).toBeLessThan(1);
  });

  it('ne dépend que du RAPPORT distance/rayon, pas des unités', () => {
    // C'est ce qui la rend valable pour Mercure comme pour Jupiter, et invariante au
    // changement d'échelle éduc↔explo qui recomprime toutes les distances.
    for (const radius of [0.03, 1, 17, 4200]) {
      for (const radii of [5, 20, 35, 50, 80]) {
        expect(orbitLineOpacity(radii * radius, radius, BASE)).toBeCloseTo(
          orbitLineOpacity(radii, 1, BASE),
          12
        );
      }
    }
  });

  it('monte sans à-coup, et sans jamais dépasser l’opacité de base', () => {
    // Une discontinuité de pente se verrait comme un instant où la ligne « saute ».
    let previous = 0;
    let maxStep = 0;
    for (let radii = 0; radii <= 80; radii += 0.05) {
      const value = orbitLineOpacity(radii, 1, BASE);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(value).toBeLessThanOrEqual(BASE + 1e-12);
      maxStep = Math.max(maxStep, value - previous);
      previous = value;
    }
    // Sur un pas de 0,05 rayon, aucune marche perceptible.
    expect(maxStep).toBeLessThan(BASE / 100);
  });

  it('garde la ligne visible quand le rayon est inconnu', () => {
    // Faire disparaître un trait sur une donnée manquante serait le pire des deux
    // comportements : rien à l'écran ne dirait que c'est une absence de donnée.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(orbitLineOpacity(10, bad, BASE)).toBe(BASE);
    expect(orbitLineOpacity(Number.NaN, 1, BASE)).toBe(BASE);
  });
});
