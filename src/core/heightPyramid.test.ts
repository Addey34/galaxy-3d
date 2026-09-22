import { describe, expect, it } from 'vitest';

import {
  heightTileFor,
  heightWindow,
  patchSegments,
  type HeightCoverageEntry,
} from './heightPyramid';
import { tileBounds } from './tilePyramid';

/**
 * QUELLE TUILE DE HAUTEURS, ET QUEL MORCEAU DE CETTE TUILE.
 *
 * Deux erreurs possibles, aucune visible : demander une tuile qui n'a pas été cuite (elle
 * reviendrait en page HTML avec un 200), et lire le mauvais sous-rectangle d'une tuile juste —
 * le relief d'un autre endroit, à la bonne échelle, ce qui ne ressemble pas à un défaut.
 */

const GLOBAL: HeightCoverageEntry = { levels: [4] };
/** Une aire nommée, alignée sur des carreaux du niveau 8 comme le cuiseur les produit. */
const AREA: HeightCoverageEntry = {
  levels: [7, 8],
  areaName: 'Tycho',
  bounds: { west: -14.0625, east: -8.4375, south: -45, north: -41.484375 },
};

describe('choix de la tuile de hauteurs', () => {
  it('prend le socle global quand rien de plus fin ne couvre', () => {
    const source = heightTileFor({ level: 8, row: 100, column: 300 }, [GLOBAL]);
    expect(source?.index).toEqual({ level: 4, row: 6, column: 18 });
    expect(source?.entry.areaName).toBeUndefined();
  });

  it('préfère l’aire nommée là où elle couvre, et la nomme', () => {
    // Un carreau du niveau 8 au centre de Tycho : 43,3° sud, 11,2° ouest.
    const index = { level: 8, row: 189, column: 240 };
    expect(tileBounds(index).south).toBeLessThan(-43);
    const source = heightTileFor(index, [GLOBAL, AREA]);
    expect(source?.index.level).toBe(8);
    expect(source?.entry.areaName).toBe('Tycho');
  });

  it('retombe sur le socle pour un carreau à cheval sur le bord de l’aire', () => {
    // Le carreau déborde l'emprise cuite : la moitié de ses hauteurs n'existe pas, donc on
    // préfère le socle complet à un relief tronqué.
    const index = { level: 8, row: 189, column: 235 };
    const source = heightTileFor(index, [GLOBAL, AREA]);
    expect(source?.index.level).toBe(4);
  });

  it('n’emploie jamais un niveau de hauteurs plus fin que l’imagerie', () => {
    // Un carreau d'imagerie du niveau 6 dans Tycho : l'aire est cuite aux niveaux 7 et 8, donc
    // il faudrait quatre tuiles. On prend le socle.
    const source = heightTileFor({ level: 6, row: 47, column: 60 }, [
      GLOBAL,
      AREA,
    ]);
    expect(source?.index.level).toBe(4);
  });

  it('ne rend rien quand l’imagerie est plus grossière que le socle', () => {
    expect(heightTileFor({ level: 3, row: 1, column: 1 }, [GLOBAL])).toBeNull();
  });
});

describe('fenêtre d’échantillons', () => {
  it('découpe la tuile de hauteurs en carreaux qui se touchent exactement', () => {
    const height = { level: 4, row: 6, column: 18 };
    const a = heightWindow({ level: 6, row: 24, column: 72 }, height, 257);
    const b = heightWindow({ level: 6, row: 24, column: 73 }, height, 257);
    expect(a).toEqual({ x0: 0, y0: 0, span: 64 });
    // Le bord est de l'un est le bord ouest de l'autre : même colonne d'échantillons, donc
    // mêmes hauteurs, donc aucune fissure entre deux carreaux voisins.
    expect(b?.x0).toBe(a!.x0 + a!.span);
  });

  it('rend le carreau entier quand les deux niveaux coïncident', () => {
    const index = { level: 8, row: 189, column: 240 };
    expect(heightWindow(index, index, 257)).toEqual({
      x0: 0,
      y0: 0,
      span: 256,
    });
  });

  it('refuse un carreau trop fin pour la tuile de hauteurs', () => {
    // 2^9 = 512 découpes pour 256 intervalles : il faudrait interpoler, donc inventer.
    expect(
      heightWindow(
        { level: 13, row: 0, column: 0 },
        { level: 4, row: 0, column: 0 },
        257
      )
    ).toBeNull();
  });
});

describe('densité du maillage', () => {
  it('reste sous le plafond en divisant par deux', () => {
    expect(patchSegments(256, 32)).toBe(32);
    expect(patchSegments(64, 32)).toBe(32);
    expect(patchSegments(16, 32)).toBe(16);
  });

  it('ne descend jamais sous un segment', () => {
    expect(patchSegments(1, 32)).toBe(1);
    expect(patchSegments(0, 32)).toBe(1);
  });
});
