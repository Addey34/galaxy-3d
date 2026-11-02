import { describe, expect, it } from 'vitest';

import { RD_ORIGIN, rdToLonLat } from './rijksdriehoek';

/**
 * CE QUE LA CONVERSION DOIT TENIR : l'origine du système (un point dont la réponse est la
 * constante même des polynômes, donc une garde contre une constante mal recopiée), puis l'échelle
 * et l'orientation (un coefficient mal recopié déplace tout sauf l'origine).
 */
describe('rdToLonLat', () => {
  it("rend la tour d'Amersfoort à son origine", () => {
    const [lon, lat] = rdToLonLat(RD_ORIGIN.x, RD_ORIGIN.y);
    expect(lon).toBeCloseTo(5.38720621, 8);
    expect(lat).toBeCloseTo(52.1551744, 8);
  });

  it("garde l'échelle : 1 km vers l'est ou le nord vaut 1 km sur l'ellipsoïde", () => {
    const [lon0, lat0] = rdToLonLat(RD_ORIGIN.x, RD_ORIGIN.y);
    const [lon1] = rdToLonLat(RD_ORIGIN.x + 1000, RD_ORIGIN.y);
    const [, lat1] = rdToLonLat(RD_ORIGIN.x, RD_ORIGIN.y + 1000);
    const metresPerDegreeLat = 111_250; // à 52°, ellipsoïde WGS84
    const metresPerDegreeLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    // La projection RD a une échelle de 0,9999079 : l'écart au kilomètre est de 9 cm.
    expect((lon1 - lon0) * metresPerDegreeLon).toBeGreaterThan(995);
    expect((lon1 - lon0) * metresPerDegreeLon).toBeLessThan(1005);
    expect((lat1 - lat0) * metresPerDegreeLat).toBeGreaterThan(995);
    expect((lat1 - lat0) * metresPerDegreeLat).toBeLessThan(1005);
  });

  it("place Amsterdam au nord-ouest d'Amersfoort, au bon endroit", () => {
    // Centre d'Amsterdam mesuré dans l'API 3DBAG : autour de x 121 000, y 487 000.
    const [lon, lat] = rdToLonLat(121000, 487000);
    expect(lon).toBeGreaterThan(4.85);
    expect(lon).toBeLessThan(4.95);
    expect(lat).toBeGreaterThan(52.35);
    expect(lat).toBeLessThan(52.4);
  });
});
