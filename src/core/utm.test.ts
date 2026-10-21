import { describe, expect, it } from 'vitest';

import { utmCentralMeridian, utmToLonLat } from './utm';

/**
 * CE QUE LA PROJECTION INVERSE DOIT TENIR. Trois contrôles de nature différente : un point dont la
 * réponse est connue sans passer par la formule (le méridien central, la longueur d'arc de
 * méridien à 45°), puis un aller-retour contre une projection directe écrite ICI et séparément.
 */

const A = 6378137;
const F = 1 / 298.257222101;
const K0 = 0.9996;

/** Projection directe de Krüger, écrite à part pour le seul usage de ce test. */
function forward(zone: number, lon: number, lat: number): [number, number] {
  const n = F / (2 - F);
  const rect = (A / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [
    n / 2 - (2 * n ** 2) / 3 + (5 * n ** 3) / 16 + (41 * n ** 4) / 180,
    (13 * n ** 2) / 48 - (3 * n ** 3) / 5 + (557 * n ** 4) / 1440,
    (61 * n ** 3) / 240 - (103 * n ** 4) / 140,
    (49561 * n ** 4) / 161280,
  ];
  const phi = (lat * Math.PI) / 180;
  const dl = ((lon - utmCentralMeridian(zone)) * Math.PI) / 180;
  const c = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(
    Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi))
  );
  const xi = Math.atan2(t, Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let e = eta;
  let nn = xi;
  alpha.forEach((a, i) => {
    const j = i + 1;
    e += a * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    nn += a * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  });
  return [500000 + K0 * rect * e, K0 * rect * nn];
}

describe('méridien central', () => {
  it('la zone 33 est centrée sur 15° E', () => {
    expect(utmCentralMeridian(33)).toBe(15);
  });
  it("le point de l'axe, sur l'équateur, est le méridien central", () => {
    const [lon, lat] = utmToLonLat(33, 500000, 0);
    expect(lon).toBeCloseTo(15, 12);
    expect(lat).toBeCloseTo(0, 12);
  });
});

describe('longueur du méridien', () => {
  it('à 45° de latitude, N = k0 × 4 984 944,38 m (arc de méridien GRS80)', () => {
    const [lon, lat] = utmToLonLat(33, 500000, K0 * 4984944.378);
    expect(lon).toBeCloseTo(15, 9);
    expect(lat).toBeCloseTo(45, 7);
  });
});

describe('aller-retour contre la projection directe', () => {
  const places: [string, number, number][] = [
    ['Berlin, Porte de Brandebourg', 13.3777, 52.5163],
    ['Berlin, périphérie nord-est', 13.7701, 52.6877],
    ['Berlin, périphérie sud-ouest', 13.079, 52.3284],
    ['hors zone, à 4° du méridien central', 11, 48.1],
  ];
  it.each(places)('%s revient à moins de 1 mm', (_name, lon, lat) => {
    const [e, n] = forward(33, lon, lat);
    const [lon2, lat2] = utmToLonLat(33, e, n);
    // 1 mm vaut environ 9e-9 degré de latitude.
    expect(Math.abs(lat2 - lat)).toBeLessThan(1e-8);
    expect(Math.abs(lon2 - lon)).toBeLessThan(1.5e-8);
  });
  it('la Porte de Brandebourg tombe dans la tuile LoD2_389_5819 du flux de Berlin', () => {
    const [e, n] = forward(33, 13.3777, 52.5163);
    expect(e).toBeGreaterThan(389000);
    expect(e).toBeLessThan(390000);
    expect(n).toBeGreaterThan(5819000);
    expect(n).toBeLessThan(5820000);
  });
});
