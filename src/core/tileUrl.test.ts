import { describe, expect, it } from 'vitest';

import { tileServiceHost, tileUrl, type TileService } from './tileUrl';

/**
 * LE GABARIT EST CELUI DES CAPACITÉS, LE DOUBLE `/` COMPRIS.
 *
 * Recopié le 2026-09-21 depuis
 * `https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml`,
 * élément `ResourceURL`. L'adresse attendue plus bas est celle d'une tuile RÉELLEMENT demandée
 * ce jour-là, qui a répondu `200`, `image/jpeg`, 36 670 octets, avec
 * `Access-Control-Allow-Origin: *` pour un en-tête `Origin` de production.
 */
const TREK: TileService = {
  template:
    'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0//{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
  style: 'default',
  tileMatrixSet: 'default028mm',
};

describe('adresse d’une tuile', () => {
  it('reproduit exactement une adresse mesurée', () => {
    expect(tileUrl(TREK, { level: 2, row: 1, column: 2 })).toBe(
      'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0//default/default028mm/2/1/2.jpg'
    );
  });

  it('écrit la LIGNE avant la COLONNE', () => {
    // Les inverser donnerait une adresse valide montrant un autre endroit du corps, ce
    // qu'aucune erreur ne signalerait jamais.
    const url = tileUrl(TREK, { level: 3, row: 2, column: 7 });
    expect(url.endsWith('/3/2/7.jpg')).toBe(true);
  });

  it('décale la colonne d’une demi-matrice pour une carte servie centrée sur 180°', () => {
    // Enceladus_Cassini_mosaic_global_110m est centrée sur 180° (CENTER_LONGITUDE de son étiquette
    // PDS3) : mesuré le 2026-10-21, ses tuiles recouvrent la texture livrée à r = 0,970 avec un
    // décalage de 180°, et à r = 0,028 sans décalage. La colonne 0 de l'application (−180°) est
    // donc la colonne du service à mi-matrice.
    const centred: TileService = { ...TREK, centerLongitude: 180 };
    const col = (level: number, column: number) =>
      tileUrl(centred, { level, row: 0, column }).split('/').pop();
    expect(col(0, 0)).toBe('1.jpg');
    expect(col(0, 1)).toBe('0.jpg');
    expect(col(2, 0)).toBe('4.jpg');
    expect(col(2, 5)).toBe('1.jpg');
    // Sans la déclaration, la colonne passe telle quelle.
    expect(tileUrl(TREK, { level: 2, row: 0, column: 5 })).toMatch(/\/5\.jpg$/);
  });

  it('garde le double « / » du gabarit publié', () => {
    expect(tileUrl(TREK, { level: 0, row: 0, column: 0 })).toContain(
      '/1.0.0//default/'
    );
  });
});

/**
 * PIÈGE 2 DU PLAN, MESURÉ : une tuile hors bornes fait répondre Trek 404 SANS en-tête
 * `Access-Control-Allow-Origin`. Le navigateur rapporte alors ce qui ressemble mot pour mot à
 * un refus CORS, pour un simple calcul de ligne faux. On refuse donc avant d'émettre.
 */
describe('refus avant émission', () => {
  it('refuse une ligne hors de la matrice de son niveau', () => {
    // Le niveau 8 a 256 lignes : la 300 est celle qui a produit le 404 mesuré.
    expect(() => tileUrl(TREK, { level: 8, row: 300, column: 0 })).toThrow(
      RangeError
    );
    expect(() => tileUrl(TREK, { level: 8, row: 300, column: 0 })).toThrow(
      /256 lignes/
    );
  });

  it('refuse une colonne hors bornes, un indice négatif, un indice fractionnaire', () => {
    expect(() => tileUrl(TREK, { level: 8, row: 0, column: 512 })).toThrow();
    expect(() => tileUrl(TREK, { level: 4, row: -1, column: 0 })).toThrow();
    expect(() => tileUrl(TREK, { level: 4, row: 0.5, column: 0 })).toThrow();
  });

  it('accepte le dernier indice valide de la matrice', () => {
    expect(() =>
      tileUrl(TREK, { level: 8, row: 255, column: 511 })
    ).not.toThrow();
  });

  it('refuse un gabarit qui garde un jeton inconnu', () => {
    expect(() =>
      tileUrl(
        { ...TREK, template: `${TREK.template}?t={Time}` },
        { level: 0, row: 0, column: 0 }
      )
    ).toThrow(/\{Time\}/);
  });

  it('refuse un gabarit qui n’est pas une adresse https absolue', () => {
    expect(() =>
      tileUrl(
        { ...TREK, template: TREK.template.replace('https://', 'http://') },
        { level: 0, row: 0, column: 0 }
      )
    ).toThrow(/https/);
  });
});

describe('hôte d’un service', () => {
  it('rend ce qui doit figurer dans la CSP', () => {
    expect(tileServiceHost(TREK)).toBe('trek.nasa.gov');
  });
});
