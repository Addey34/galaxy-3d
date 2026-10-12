import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * LES DEUX MODULES PURS DU RELIEF DE LA TERRE (lot 48), sur des entrées SYNTHÉTIQUES : la lecture
 * des balises GeoTIFF (registre, emprise) et la règle du niveau de l'eau. Les octets RÉELLEMENT
 * cuits sont gardés à part, sur leurs témoins (`surfaceHeights.test.ts`).
 */
const ROOT = resolve(import.meta.dirname, '../..');
const load = async (name: string) =>
  import(pathToFileURL(join(ROOT, 'scripts', name)).href);

describe('balises géographiques d’un GeoTIFF', () => {
  it('lit le coin d’une grille attachée au coin, et le ramène d’un demi-pas pour une grille attachée au centre', async () => {
    const { geoTiffGrid, tiffHeaderForTest } = await load('geotiff-grid.mjs');
    const step = 1 / 60;
    const corner = geoTiffGrid(
      tiffHeaderForTest({
        width: 21600,
        height: 10800,
        scale: step,
        tieX: -180,
        tieY: 90,
        rasterType: 1,
      }),
      'surface'
    );
    const centre = geoTiffGrid(
      tiffHeaderForTest({
        width: 21600,
        height: 10800,
        scale: step,
        tieX: -180 + step / 2,
        tieY: 90 - step / 2,
        rasterType: 2,
      }),
      'géoïde'
    );
    // Les deux fichiers d'ETOPO 2022 tels qu'ils sont publiés : mêmes centres, deux registres.
    for (const grid of [corner, centre]) {
      expect(grid.westDeg).toBeCloseTo(-180, 9);
      expect(grid.northDeg).toBeCloseTo(90, 9);
      expect(grid.pixelsPerDegree).toBeCloseTo(60, 9);
    }
    expect(corner.attachedTo).toBe('corner');
    expect(centre.attachedTo).toBe('centre');
  });

  it('refuse une grille décalée d’un demi-pas, qui serait plausible à l’œil', async () => {
    const { geoTiffGrid, tiffHeaderForTest } = await load('geotiff-grid.mjs');
    const step = 1 / 60;
    // Attachée au centre mais déclarée au coin : tout le relief glisserait de 926 m.
    expect(() =>
      geoTiffGrid(
        tiffHeaderForTest({
          width: 21600,
          height: 10800,
          scale: step,
          tieX: -180 + step / 2,
          tieY: 90 - step / 2,
          rasterType: 1,
        }),
        'décalée'
      )
    ).toThrow(/pas le globe/);
    expect(() =>
      geoTiffGrid(
        tiffHeaderForTest({
          width: 21600,
          height: 10800,
          scale: step,
          tieX: -180,
          tieY: 90,
          rasterType: 1,
          crs: 4269,
        }),
        'autre datum'
      )
    ).toThrow(/EPSG:4326/);
  });
});

describe('le niveau de l’eau', () => {
  /** Une grille de 40 x 20 : un océan à l'ouest, un lac « à fond » et un lac « à surface ». */
  function world() {
    const width = 40;
    const height = 20;
    const elevation = new Float32Array(width * height).fill(300);
    const water = new Uint8Array(width * height);
    const at = (x: number, y: number) => y * width + x;
    // Océan : colonnes 0 à 14, fond à −4 000 m.
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < 15; x += 1) {
        elevation[at(x, y)] = -4000;
        water[at(x, y)] = 1;
      }
    // Une rive que le masque dit « terre » mais où la source donne encore le fond.
    for (let y = 0; y < height; y += 1) elevation[at(15, y)] = -30;
    // Lac à fond : 6 x 6, rive à 200 m, fond à −100 m (non plat).
    for (let y = 2; y < 8; y += 1)
      for (let x = 20; x < 26; x += 1) {
        elevation[at(x, y)] = -100 + (x - 20) * 7 + (y - 2) * 3;
        water[at(x, y)] = 1;
      }
    for (let y = 1; y < 9; y += 1)
      for (let x = 19; x < 27; x += 1)
        if (!water[at(x, y)]) elevation[at(x, y)] = 200;
    // Lac à surface, plat à −500 m (une « mer Morte ») : la source y donne déjà la surface.
    for (let y = 12; y < 18; y += 1)
      for (let x = 30; x < 36; x += 1) {
        elevation[at(x, y)] = -500;
        water[at(x, y)] = 1;
      }
    return { width, height, elevation, water, at };
  }
  const RULE = {
    minimumCells: 10,
    flatShare: 0.5,
    seaArmFloorMetres: -150,
    greatLakeCells: 30,
    submergedMetres: 50,
    shoreCells: 3,
  };

  it('met l’océan au zéro du géoïde, le lac à fond au niveau de sa rive, et laisse le lac plat', async () => {
    const { levelWater } = await load('earth-water-level.mjs');
    const { width, height, elevation, water, at } = world();
    const { bodies } = levelWater(elevation, water, width, height, RULE);
    expect(bodies.map((b: { kind: string }) => b.kind)).toEqual([
      'ocean',
      'great-lake',
    ]);
    expect(elevation[at(3, 3)]).toBe(0);
    expect(elevation[at(22, 4)]).toBe(200);
    expect(elevation[at(32, 14)]).toBe(-500);
    // La terre sèche n'est pas touchée.
    expect(elevation[at(28, 10)]).toBe(300);
  });

  it('inonde la rive que le masque manque, et elle seule', async () => {
    const { levelWater } = await load('earth-water-level.mjs');
    const { width, height, elevation, water, at } = world();
    const { dryLand } = levelWater(elevation, water, width, height, RULE);
    expect(elevation[at(15, 5)]).toBe(0);
    expect(dryLand.shoreCellsFlooded).toBe(height);
  });

  it('borne la terre sèche par la plus basse surface d’eau plate, et rend à l’eau ce qui est plus bas', async () => {
    const { levelWater } = await load('earth-water-level.mjs');
    const { width, height, elevation, water, at } = world();
    // Une cellule « terre » à −5 000 m isolée dans les terres : un trou du masque.
    elevation[at(38, 2)] = -5000;
    const { dryLand } = levelWater(elevation, water, width, height, RULE);
    expect(dryLand.lowestFlatWaterMetres).toBe(-500);
    expect(dryLand.cellsTurnedToWater).toBe(1);
    expect(elevation[at(38, 2)]).toBe(-5000);
  });
});
