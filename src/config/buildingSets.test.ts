import { describe, expect, it } from 'vitest';

import {
  parseBuildingSetIndex,
  parseBuildingSetManifest,
  setCovering,
} from './buildingSets';

/**
 * CE QU'UN INDEX DE BÂTIMENTS DOIT REFUSER, ET QUEL JEU COUVRE UN POINT.
 *
 * L'hébergeur réécrit toute adresse inconnue vers la page de l'application : un index absent
 * revient en HTTP 200 avec du HTML, qui doit être refusé et non lu comme « aucun jeu ». Et la
 * priorité est celle de l'ordre de l'index : un jeu national placé avant le mondial gagne.
 */

const PARIS = {
  id: 'paris-bdtopo',
  body: 'earth',
  bboxLonLat: [2.32, 48.85, 2.36, 48.87] as [number, number, number, number],
  manifest: 'assets/buildings/paris-bdtopo/manifest.json',
};
const FRANCE = {
  id: 'monde-overture',
  body: 'earth',
  bboxLonLat: [-180, -85, 180, 85] as [number, number, number, number],
  manifest: 'assets/buildings/monde-overture/manifest.json',
};

describe('index', () => {
  it('lit un index bien formé', () => {
    expect(parseBuildingSetIndex({ sets: [PARIS] }).sets).toEqual([PARIS]);
  });
  it("refuse ce qui n'est pas un index (page HTML parsée à tort, objet vide)", () => {
    expect(() => parseBuildingSetIndex(null)).toThrow(/sans « sets »/);
    expect(() => parseBuildingSetIndex({})).toThrow(/sans « sets »/);
    expect(() => parseBuildingSetIndex('<html>')).toThrow(/sans « sets »/);
  });
  it('refuse une entrée incomplète ou une emprise à l’envers', () => {
    expect(() => parseBuildingSetIndex({ sets: [{ id: 'x' }] })).toThrow(
      /incomplète/
    );
    expect(() =>
      parseBuildingSetIndex({
        sets: [{ ...PARIS, bboxLonLat: [2.36, 48.85, 2.32, 48.87] }],
      })
    ).toThrow(/incomplète/);
  });
});

describe('manifeste', () => {
  it('refuse un manifeste sans attribution ni licence', () => {
    expect(() =>
      parseBuildingSetManifest({
        id: 'x',
        body: 'earth',
        title: 'x',
        zoom: 14,
        directory: 'd',
        bboxLonLat: PARIS.bboxLonLat,
        source: {},
      })
    ).toThrow(/incomplet/);
  });
});

describe('jeu qui couvre un point', () => {
  const index = { sets: [PARIS, FRANCE] };
  it('rend le premier jeu qui couvre : le national avant le mondial', () => {
    expect(setCovering(index, 'earth', 2.3499, 48.853)?.id).toBe(
      'paris-bdtopo'
    );
  });
  it('retombe sur le suivant hors du premier', () => {
    expect(setCovering(index, 'earth', 151.2, -33.9)?.id).toBe(
      'monde-overture'
    );
  });
  it('ne rend jamais le jeu d’un autre corps, même aux mêmes coordonnées', () => {
    expect(setCovering({ sets: [PARIS] }, 'moon', 2.3499, 48.853)).toBeNull();
  });
  it('rend null quand aucun jeu ne couvre', () => {
    expect(setCovering({ sets: [PARIS] }, 'earth', 151.2, -33.9)).toBeNull();
  });
  it('élargit par la marge, et seulement par elle', () => {
    const lonJustWest = 2.319;
    expect(
      setCovering({ sets: [PARIS] }, 'earth', lonJustWest, 48.86)
    ).toBeNull();
    expect(
      setCovering({ sets: [PARIS] }, 'earth', lonJustWest, 48.86, 0.01)?.id
    ).toBe('paris-bdtopo');
  });
});
