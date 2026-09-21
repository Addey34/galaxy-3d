import { describe, expect, it } from 'vitest';

import {
  coverageTileCount,
  degreesPerPixel,
  groundResolutionKm,
  isWithinMatrix,
  levelForGroundResolution,
  oversamplingFactor,
  pixelsPerDegree,
  pyramidWidthPx,
  tileBounds,
  tileIndexAt,
  tileMatrix,
  tilesCovering,
  WMTS_EQUIRECTANGULAR_2x1,
} from './tilePyramid';
import { QUALITY_PROFILES } from './qualityTier';
import {
  approachFloorRadiusFactor,
  altitudeKmForRadiusFactor,
} from './surfaceApproach';

/** Rayon lunaire du datum que Trek déclare pour cette couche (`SPHEROID["Moon",1737400,0]`). */
const MOON_RADIUS_KM = 1737.4;

/**
 * LA PYRAMIDE EST CELLE DES CAPACITÉS WMTS, PAS UNE SUPPOSITION.
 *
 * Les dimensions ci-dessous sont RECOPIÉES du document de capacités de la couche
 * `LRO_WAC_Mosaic_Global_303ppd_v02`, relu le 2026-09-21 : le niveau 0 y déclare
 * `MatrixWidth 2` / `MatrixHeight 1`, le niveau 8 `512` / `256`, et chaque tuile 256 px.
 * Un test qui recalculerait la même formule des deux côtés ne prouverait rien.
 */
describe('matrice de la pyramide', () => {
  it('reproduit les dimensions publiées aux niveaux 0 et 8', () => {
    expect(tileMatrix(0)).toEqual({ level: 0, columns: 2, rows: 1 });
    expect(tileMatrix(8)).toEqual({ level: 8, columns: 512, rows: 256 });
  });

  it('donne 131 072 pixels sur 360° au niveau 8', () => {
    expect(pyramidWidthPx(8)).toBe(131072);
    expect(pixelsPerDegree(8)).toBeCloseTo(364.0889, 4);
    expect(degreesPerPixel(8)).toBeCloseTo(2.7466e-3, 7);
  });

  it('vaut 83 m par pixel au sol sur la Lune, comme le plan l’annonce', () => {
    expect(groundResolutionKm(8, MOON_RADIUS_KM) * 1000).toBeCloseTo(83.286, 3);
    // Et 1,3 km/px au niveau 4, le socle grossier dont la phase 9D discute le poids.
    expect(groundResolutionKm(4, MOON_RADIUS_KM) * 1000).toBeCloseTo(1332.6, 1);
  });

  it('dit que le niveau 8 SUR-ÉCHANTILLONNE la mosaïque publiée à 303 px/degré', () => {
    expect(oversamplingFactor(8, 303)).toBeCloseTo(1.2016, 4);
    // Le niveau 7, lui, reste plus grossier que la source : rien à déclarer.
    expect(oversamplingFactor(7, 303)).toBeCloseTo(0.6008, 4);
  });
});

describe('emprise et indice d’une tuile', () => {
  it('découpe le globe entier au niveau 0', () => {
    expect(tileBounds({ level: 0, row: 0, column: 0 })).toEqual({
      west: -180,
      east: 0,
      south: -90,
      north: 90,
    });
    expect(tileBounds({ level: 0, row: 0, column: 1 })).toEqual({
      west: 0,
      east: 180,
      south: -90,
      north: 90,
    });
  });

  it('met la ligne 0 au NORD et la colonne 0 à −180°', () => {
    // C'est la convention WMTS, et l'inverser donnerait des adresses valides montrant
    // l'hémisphère opposé, sans aucune erreur.
    expect(tileIndexAt(3, 89, -179)).toEqual({ level: 3, row: 0, column: 0 });
    expect(tileIndexAt(3, -89, 179)).toEqual({ level: 3, row: 7, column: 15 });
  });

  it('enroule la longitude et borne la latitude', () => {
    expect(tileIndexAt(2, 0, 180).column).toBe(0);
    expect(tileIndexAt(2, 0, -180).column).toBe(0);
    expect(tileIndexAt(2, 0, 540).column).toBe(0);
    // Le pôle exact tomberait sur `rows`, qui n'existe pas.
    expect(tileIndexAt(2, 90, 0).row).toBe(0);
    expect(tileIndexAt(2, -90, 0).row).toBe(3);
    expect(isWithinMatrix(tileIndexAt(2, -90, 0))).toBe(true);
  });

  it('refuse un indice hors matrice, et un indice non entier', () => {
    expect(isWithinMatrix({ level: 8, row: 300, column: 0 })).toBe(false);
    expect(isWithinMatrix({ level: 8, row: 0, column: 512 })).toBe(false);
    expect(isWithinMatrix({ level: 8, row: -1, column: 0 })).toBe(false);
    expect(isWithinMatrix({ level: 8, row: 1.5, column: 0 })).toBe(false);
    expect(isWithinMatrix({ level: 8, row: 255, column: 511 })).toBe(true);
  });

  it('couvre un carreau entier : son emprise contient tous ses points', () => {
    const index = { level: 5, row: 12, column: 40 };
    const bounds = tileBounds(index);
    const centre = tileIndexAt(
      5,
      (bounds.north + bounds.south) / 2,
      (bounds.east + bounds.west) / 2
    );
    expect(centre).toEqual(index);
  });
});

describe('couverture autour du point visé', () => {
  const centre = { latitudeDeg: 0, longitudeDeg: 0 };

  it('rend le centre en premier et respecte le plafond', () => {
    const tiles = tilesCovering(6, centre, 5, 9);
    expect(tiles).toHaveLength(9);
    expect(tiles[0]).toEqual(tileIndexAt(6, 0, 0));
  });

  it('compte AVANT de construire, et les deux concordent sous le plafond', () => {
    const count = coverageTileCount(6, centre, 3);
    expect(tilesCovering(6, centre, 3, 10_000)).toHaveLength(count);
  });

  it('élargit la fenêtre en longitude près des pôles', () => {
    const equator = coverageTileCount(
      6,
      { latitudeDeg: 0, longitudeDeg: 0 },
      4
    );
    const polar = coverageTileCount(6, { latitudeDeg: 85, longitudeDeg: 0 }, 4);
    expect(polar).toBeGreaterThan(equator);
  });

  it('enroule les colonnes à l’antiméridien plutôt que de s’y arrêter', () => {
    const tiles = tilesCovering(
      4,
      { latitudeDeg: 0, longitudeDeg: 179.9 },
      20,
      64
    );
    const columns = new Set(tiles.map((t) => t.column));
    // La matrice a 32 colonnes au niveau 4 : la fenêtre doit contenir la 31 ET la 0.
    expect(columns.has(31)).toBe(true);
    expect(columns.has(0)).toBe(true);
    for (const tile of tiles) expect(isWithinMatrix(tile)).toBe(true);
  });

  it('ne rend rien pour un budget nul', () => {
    expect(tilesCovering(6, centre, 5, 0)).toEqual([]);
  });

  /**
   * DÉFAUT TROUVÉ À L'ÉCRAN, pas à la relecture, le 2026-09-21 à 390 px de large : la Lune
   * était servie à 5,3 km/px au lieu de 83 m/px, soit 540 pixels d'écran par texel, sans que
   * rien ne le dise. Cause : le budget du profil mobile valait 24, or la fenêtre de couverture
   * ne descend JAMAIS sous 5 x 5 = 25 carreaux (le carreau visé, une couronne, et une seconde
   * parce que le point visé peut tomber au bord du sien). Aucun niveau ne tenait donc dans le
   * budget, et le moteur retombait au plus grossier.
   */
  it('demande 25 carreaux dès que l’angle visé est non nul, à TOUS les niveaux', () => {
    // Les niveaux 0 à 2 sont écartés : leur matrice a si peu de lignes que la fenêtre est
    // rognée par les pôles (20 carreaux au niveau 2), ce qui n'est pas le cas mesuré.
    for (const level of [3, 5, 8]) {
      // Un angle strictement positif mais plus petit qu'un carreau : c'est le cas d'une
      // descente au ras du sol, et c'est exactement là que le budget doit suffire.
      const latStep = 180 / tileMatrix(level).rows;
      expect(
        coverageTileCount(level, centre, latStep / 2),
        `niveau ${level}`
      ).toBe(25);
      // Descendre d'un niveau ne réduit donc RIEN : c'est pourquoi le moteur s'arrête de
      // descendre quand le compte cesse de diminuer, au lieu de dégringoler au plus grossier.
      expect(
        coverageTileCount(level - 1, centre, latStep / 2),
        `niveau ${level - 1}`
      ).toBeGreaterThanOrEqual(9);
    }
  });

  it('donne à chaque profil de qualité un budget au moins égal à ce plancher', () => {
    for (const [tier, profile] of Object.entries(QUALITY_PROFILES)) {
      expect(
        profile.surfaceTiles.maxTiles,
        `profil ${tier} : un budget sous 25 ne permet AUCUN niveau`
      ).toBeGreaterThanOrEqual(25);
    }
  });
});

describe('choix du niveau', () => {
  const bounds = { minLevel: 2, maxLevel: 8 };

  it('prend le niveau le plus grossier qui atteint la finesse visée', () => {
    // 83 m visés sur la Lune : c'est exactement le niveau 8.
    expect(levelForGroundResolution(MOON_RADIUS_KM, 0.084, bounds)).toBe(8);
    // 1,4 km visés : le niveau 4 suffit (1,332 km), le 5 serait du gaspillage.
    expect(levelForGroundResolution(MOON_RADIUS_KM, 1.4, bounds)).toBe(4);
  });

  it('reste dans les bornes déclarées par la fiche, des deux côtés', () => {
    expect(levelForGroundResolution(MOON_RADIUS_KM, 1e-6, bounds)).toBe(8);
    expect(levelForGroundResolution(MOON_RADIUS_KM, 1e6, bounds)).toBe(2);
    expect(levelForGroundResolution(MOON_RADIUS_KM, Number.NaN, bounds)).toBe(
      2
    );
  });
});

/**
 * LA PRÉDICTION CHIFFRÉE DE LA PHASE 9B, VÉRIFIÉE ICI.
 *
 * Le relevé de 9B annonce que la même formule de plancher, nourrie par l'imagerie tuilée,
 * ferait tomber le plancher d'approche de la Lune « à environ 8 km, sans être modifiée ».
 * C'est l'affirmation publiée par cette phase, donc elle est tenue par un test plutôt que par
 * la confiance : 128,0 km avec la texture 8k livrée, 8,0 km avec le niveau 8 de la mosaïque.
 */
describe('plancher d’approche nourri par l’imagerie tuilée', () => {
  it('tombe de 128 km à 8 km sur la Lune', () => {
    const shipped = altitudeKmForRadiusFactor(
      MOON_RADIUS_KM,
      approachFloorRadiusFactor(8192)
    );
    const streamed = altitudeKmForRadiusFactor(
      MOON_RADIUS_KM,
      approachFloorRadiusFactor(pyramidWidthPx(8))
    );
    expect(shipped).toBeCloseTo(128.0, 1);
    expect(streamed).toBeCloseTo(8.0, 1);
    expect(shipped / streamed).toBeCloseTo(16, 5);
  });
});

describe('forme de matrice déclarée par une autre fiche', () => {
  it('n’est pas codée en dur : une pyramide 1×1 se décrit aussi', () => {
    const square = {
      ...WMTS_EQUIRECTANGULAR_2x1,
      columnsAtLevelZero: 1,
      rowsAtLevelZero: 1,
    };
    expect(tileMatrix(3, square)).toEqual({ level: 3, columns: 8, rows: 8 });
    expect(tileBounds({ level: 0, row: 0, column: 0 }, square)).toEqual({
      west: -180,
      east: 180,
      south: -90,
      north: 90,
    });
  });
});
