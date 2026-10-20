import { describe, expect, it } from 'vitest';

import {
  BUILDING_TILE_MAGIC,
  decodeBuildingTile,
  dequantizeFromTile,
  encodeBuildingTile,
  HEIGHT_ORIGIN,
  latToTileY,
  lonToTileX,
  quantizeToTile,
  tileOfLonLat,
  type BuildingTile,
} from './buildingTile';

/**
 * CE QU'UNE TUILE DE BÂTIMENTS DOIT REFUSER, ET CE QU'ELLE DOIT GARDER.
 *
 * Le décodeur est la seule barrière entre des octets et un bâtiment. Quatre refus comptent et
 * aucun ne se verrait à l'écran : des octets qui ne sont pas une tuile (un hébergeur qui réécrit
 * toute adresse inconnue rend du HTML en HTTP 200), une tuile d'un autre endroit, une tuile
 * tronquée ou incohérente, et une origine de hauteur inconnue (la légende en tire des parts : une
 * valeur hors liste fausserait la part « mesurée »).
 */

const TILE = { zoom: 14, column: 8298, row: 5636 };

function sample(): BuildingTile {
  return {
    ...TILE,
    buildings: [
      {
        ring: new Uint16Array([100, 200, 900, 200, 900, 800, 100, 800]),
        heightDecimetres: 187,
        origin: HEIGHT_ORIGIN.interpolated,
      },
      {
        ring: new Uint16Array([5000, 5000, 6000, 5000, 5500, 6200]),
        heightDecimetres: 0,
        origin: HEIGHT_ORIGIN.absent,
      },
      {
        ring: new Uint16Array([65535, 0, 65000, 100, 65535, 400]),
        heightDecimetres: 65535,
        origin: HEIGHT_ORIGIN.measured,
      },
    ],
  };
}

describe('aller-retour', () => {
  it('rend exactement ce qui a été encodé', () => {
    const decoded = decodeBuildingTile(encodeBuildingTile(sample()), TILE);
    const expected = sample();
    expect(decoded.zoom).toBe(TILE.zoom);
    expect(decoded.column).toBe(TILE.column);
    expect(decoded.row).toBe(TILE.row);
    expect(decoded.buildings).toHaveLength(3);
    decoded.buildings.forEach((b, i) => {
      expect(Array.from(b.ring)).toEqual(
        Array.from(expected.buildings[i].ring)
      );
      expect(b.heightDecimetres).toBe(expected.buildings[i].heightDecimetres);
      expect(b.origin).toBe(expected.buildings[i].origin);
    });
  });

  it('accepte une tuile vide', () => {
    const empty: BuildingTile = { ...TILE, buildings: [] };
    expect(
      decodeBuildingTile(encodeBuildingTile(empty), TILE).buildings
    ).toEqual([]);
  });

  it("pèse le nombre d'octets que son format annonce", () => {
    // En-tête 24 + (2 + 1 + 4) par bâtiment + 4 de fin + 4 par sommet : 10 sommets, 3 bâtiments.
    expect(encodeBuildingTile(sample()).byteLength).toBe(
      24 + 3 * 7 + 4 + 10 * 4
    );
  });
});

describe('refus du décodeur', () => {
  it('refuse des octets qui ne sont pas une tuile (page HTML en HTTP 200)', () => {
    const html = new TextEncoder().encode(
      '<!doctype html><html><body>Galaxy</body></html>'
    );
    expect(() => decodeBuildingTile(html.buffer as ArrayBuffer)).toThrow(
      /pas une tuile de bâtiments/
    );
  });

  it("refuse une tuile d'un autre endroit", () => {
    const bytes = encodeBuildingTile(sample());
    expect(() =>
      decodeBuildingTile(bytes, { ...TILE, column: TILE.column + 1 })
    ).toThrow(/autre endroit/);
    expect(() => decodeBuildingTile(bytes, { ...TILE, zoom: 13 })).toThrow(
      /autre endroit/
    );
  });

  it('refuse une tuile tronquée', () => {
    const bytes = encodeBuildingTile(sample());
    expect(() => decodeBuildingTile(bytes.slice(0, 10))).toThrow(/tronquée/);
    expect(() =>
      decodeBuildingTile(bytes.slice(0, bytes.byteLength - 4))
    ).toThrow(/incohérente/);
  });

  it('refuse une version inconnue', () => {
    const bytes = encodeBuildingTile(sample());
    new DataView(bytes).setUint16(4, 99, true);
    expect(() => decodeBuildingTile(bytes)).toThrow(/version/);
  });

  it("refuse des départs d'anneaux qui ne se suivent pas", () => {
    const bytes = encodeBuildingTile(sample());
    const view = new DataView(bytes);
    const startsAt = 24 + 3 * 2 + 3;
    // Le deuxième départ passe AVANT le premier anneau fini : le bâtiment 0 aurait 0 sommet.
    view.setUint32(startsAt + 4, 0, true);
    expect(() => decodeBuildingTile(bytes)).toThrow(/départs d'anneaux/);
  });

  it('refuse une origine de hauteur inconnue', () => {
    const bytes = encodeBuildingTile(sample());
    new DataView(bytes).setUint8(24 + 3 * 2, 9);
    expect(() => decodeBuildingTile(bytes)).toThrow(/origine de hauteur/);
  });

  it('a une marque de tête qui est bien celle du format', () => {
    const bytes = encodeBuildingTile(sample());
    const head = String.fromCharCode(...new Uint8Array(bytes, 0, 4));
    expect(head).toBe(BUILDING_TILE_MAGIC);
  });
});

describe("refus de l'encodeur", () => {
  const tileWith = (b: Partial<BuildingTile['buildings'][number]>) => ({
    ...TILE,
    buildings: [
      {
        ring: new Uint16Array([0, 0, 10, 0, 5, 9]),
        heightDecimetres: 100,
        origin: HEIGHT_ORIGIN.measured,
        ...b,
      },
    ],
  });

  it('refuse un anneau de moins de trois sommets', () => {
    expect(() =>
      encodeBuildingTile(tileWith({ ring: new Uint16Array([0, 0, 1, 1]) }))
    ).toThrow(/trois sommets/);
  });

  it("refuse une hauteur qu'il ne sait pas dire au lieu de la tronquer", () => {
    expect(() =>
      encodeBuildingTile(tileWith({ heightDecimetres: 65536 }))
    ).toThrow(/hauteur hors limites/);
    expect(() =>
      encodeBuildingTile(tileWith({ heightDecimetres: -1 }))
    ).toThrow(/hauteur hors limites/);
    expect(() =>
      encodeBuildingTile(tileWith({ heightDecimetres: 1.5 }))
    ).toThrow(/hauteur hors limites/);
  });

  it('refuse une origine de hauteur inconnue', () => {
    expect(() => encodeBuildingTile(tileWith({ origin: 7 as never }))).toThrow(
      /origine/
    );
  });
});

describe('géométrie de la tuile', () => {
  it("place le méridien d'origine à la moitié, et l'antiméridien au bord", () => {
    expect(lonToTileX(0, 1)).toBe(1);
    expect(lonToTileX(-180, 5)).toBe(0);
    expect(latToTileY(0, 1)).toBeCloseTo(1, 12);
  });

  it('numérote les lignes depuis le nord', () => {
    expect(latToTileY(60, 4)).toBeLessThan(latToTileY(-60, 4));
  });

  it('retrouve la tuile de Paris et un point dans sa propre tuile', () => {
    const t = tileOfLonLat(2.3499, 48.853, 14);
    expect(t).toEqual({ zoom: 14, column: 8298, row: 5636 });
    const [qx, qy] = quantizeToTile(2.3499, 48.853, t);
    // Entre la marge et la fin de la tuile : jamais dans la marge pour un point que la tuile contient.
    expect(qx).toBeGreaterThan(65535 * (0.125 / 1.25));
    expect(qx).toBeLessThan(65535 * (1.125 / 1.25));
    expect(qy).toBeGreaterThan(65535 * (0.125 / 1.25));
    expect(qy).toBeLessThan(65535 * (1.125 / 1.25));
  });

  it('quantifie sans perdre plus de quelques centimètres', () => {
    const points: [number, number][] = [
      [2.3499, 48.853],
      [2.3302, 48.8606],
      [2.3523, 48.8719],
    ];
    for (const [lon, lat] of points) {
      const tile = tileOfLonLat(lon, lat, 14);
      const [qx, qy] = quantizeToTile(lon, lat, tile);
      const [lon2, lat2] = dequantizeFromTile(qx, qy, tile);
      // 4e-7 degré vaut environ 4,5 cm : la précision que le format annonce à ce niveau.
      expect(Math.abs(lon2 - lon)).toBeLessThan(4e-7);
      expect(Math.abs(lat2 - lat)).toBeLessThan(4e-7);
    }
  });

  it('couvre un bâtiment qui déborde sur la voisine, sans le tronquer', () => {
    const tile = { zoom: 14, column: 8298, row: 5636 };
    // Un point à 5 % de la largeur de tuile AU-DELÀ du bord ouest : dans la marge de 12,5 %.
    const lon = ((tile.column - 0.05) / 2 ** tile.zoom) * 360 - 180;
    const [qx] = quantizeToTile(lon, 48.853, tile);
    expect(qx).toBeGreaterThan(0);
    const [lonBack] = dequantizeFromTile(qx, 30000, tile);
    expect(Math.abs(lonBack - lon)).toBeLessThan(4e-7);
  });

  it("borne un point hors de la marge au lieu de déborder de l'uint16", () => {
    const tile = { zoom: 14, column: 8298, row: 5636 };
    const farWest = ((tile.column - 3) / 2 ** tile.zoom) * 360 - 180;
    expect(quantizeToTile(farWest, 48.853, tile)[0]).toBe(0);
  });
});
