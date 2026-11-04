import { describe, expect, it } from 'vitest';
import {
  angularToleranceRad,
  directionAt,
  nearestDirection,
  searchNames,
} from './skyPick';

const DEG = Math.PI / 180;
const dir = (lonDeg: number, latDeg: number): [number, number, number] => [
  Math.cos(latDeg * DEG) * Math.cos(lonDeg * DEG),
  Math.sin(latDeg * DEG),
  Math.cos(latDeg * DEG) * Math.sin(lonDeg * DEG),
];

describe('nearestDirection', () => {
  const points = [dir(0, 0), dir(10, 0), dir(0, 10)].flat();

  it('rend le point le plus proche du rayon, quelle que soit la longueur du vecteur', () => {
    const scaled = points.map((v) => v * 2600);
    expect(nearestDirection(scaled, 3, dir(9, 1), 3 * DEG)).toBe(1);
    expect(nearestDirection(scaled, 3, dir(1, 9), 3 * DEG)).toBe(2);
  });

  it('rend -1 hors tolérance, et départage deux candidats par le plus proche', () => {
    expect(nearestDirection(points, 3, dir(5, 5), 3 * DEG)).toBe(-1);
    expect(nearestDirection(points, 3, dir(6, 0), 8 * DEG)).toBe(1);
  });

  it('ignore un vecteur nul au lieu de produire NaN', () => {
    expect(nearestDirection([0, 0, 0, ...dir(0, 0)], 2, dir(0, 0), DEG)).toBe(
      1
    );
  });
});

describe('angularToleranceRad', () => {
  it('convertit des pixels en angle selon le champ vertical', () => {
    // 60° sur 600 px : 0,1° par pixel.
    expect(angularToleranceRad(60, 600, 10) / DEG).toBeCloseTo(1, 6);
    expect(angularToleranceRad(60, 0, 10)).toBe(0);
  });
});

describe('searchNames', () => {
  const names = [
    'TRAPPIST-1',
    'Kepler-90',
    'HD 10180',
    'Kepler-22',
    'kepler-9',
    'Proxima Cen',
  ];

  it('classe les débuts de nom avant les inclusions, sans casse', () => {
    expect(searchNames(names, 'kep', 10)).toEqual([
      'Kepler-90',
      'Kepler-22',
      'kepler-9',
    ]);
    expect(searchNames(names, 'cen', 10)).toEqual(['Proxima Cen']);
    expect(searchNames(['A Kepler', 'Kepler-1'], 'kepler', 10)).toEqual([
      'Kepler-1',
      'A Kepler',
    ]);
  });

  it('borne le nombre de résultats, écarte les doublons et refuse une requête trop courte', () => {
    expect(searchNames(names, 'kepler', 2)).toHaveLength(2);
    expect(searchNames(['X1', 'X1', 'X12'], 'x1', 10)).toEqual(['X1', 'X12']);
    expect(searchNames(names, 'k', 10)).toEqual([]);
    expect(searchNames(names, '  ', 10)).toEqual([]);
  });
});

describe('directionAt', () => {
  it('lit le point demandé et le ramène à une direction unitaire', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(directionAt([0, 0, 0, 3, 0, 4, 0, 0, 9], 1, out)).toBe(true);
    expect(out[0]).toBeCloseTo(0.6, 12);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeCloseTo(0.8, 12);
    expect(Math.hypot(...out)).toBeCloseTo(1, 12);
  });

  it("refuse l'origine et un indice hors du tampon, sans toucher à la sortie", () => {
    const out: [number, number, number] = [7, 7, 7];
    expect(directionAt([0, 0, 0, 1, 0, 0], 0, out)).toBe(false);
    expect(directionAt([0, 0, 0, 1, 0, 0], 2, out)).toBe(false);
    expect(out).toEqual([7, 7, 7]);
  });
});
