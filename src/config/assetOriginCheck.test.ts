import { describe, expect, it } from 'vitest';
// @ts-expect-error : script .mjs sans déclaration de types
import { compareFiles } from '../../scripts/check-asset-origin.mjs';

describe('garde de l’origine des gros fichiers', () => {
  const local = new Map([
    ['assets/textures/a.jpg', 10],
    ['assets/ephemerides/b.bin', 20],
  ]);

  it('ne dit rien quand tout est là avec la même taille', () => {
    expect(compareFiles(local, new Map(local))).toEqual([]);
  });

  it('nomme un fichier absent de l’origine', () => {
    const remote = new Map([['assets/textures/a.jpg', 10]]);
    expect(compareFiles(local, remote)).toEqual([
      "absent de l'origine : assets/ephemerides/b.bin",
    ]);
  });

  it('nomme une texture réécrite sous le même nom mais pas recopiée', () => {
    const remote = new Map([
      ['assets/textures/a.jpg', 9],
      ['assets/ephemerides/b.bin', 20],
    ]);
    expect(compareFiles(local, remote)).toEqual([
      "taille 9 sur l'origine, 10 dans la build : assets/textures/a.jpg",
    ]);
  });
});
