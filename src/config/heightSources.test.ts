import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * LES DEUX LECTEURS DE RELIEF AJOUTÉS (GAL-PLANETARY-RELIEF-001), sur des entrées SYNTHÉTIQUES : le GeoTIFF
 * projeté de Mercure (emprise et méridien central lus dans les balises) et les trames sinusoïdales du GTDR de
 * Vénus, plus le comblement déclaré des trous. Les octets RÉELLEMENT cuits sont gardés sur leurs témoins
 * publiés (`surfaceHeights.test.ts`).
 */
const ROOT = resolve(import.meta.dirname, '../..');
const load = async () =>
  import(pathToFileURL(join(ROOT, 'scripts', 'height-sources.mjs')).href);

/** Les balises d'un GeoTIFF projeté équirectangulaire de Mercure, telles que `readTiffTags` les rend. */
function mercuryTags(centerLong: number): Map<number, unknown> {
  const radius = 2439400;
  const metresPerDegree = (radius * Math.PI) / 180;
  const width = 23040;
  const height = 11520;
  const scale = (360 * metresPerDegree) / width;
  return new Map<number, unknown>([
    [256, [width]],
    [257, [height]],
    [258, [16]],
    [259, [1]],
    [273, [0]],
    [277, [1]],
    [278, [1]],
    [279, [width * 2]],
    [339, [2]],
    [33550, [scale, scale, 0]],
    [33922, [0, 0, 0, -180 * metresPerDegree, 90 * metresPerDegree, 0]],
    // ModelType, RasterType = cellule, demi-axes (doubles 5 et 6), transformation 17, parallèle, méridien central.
    [
      34735,
      [
        1, 1, 0, 7, 1024, 0, 1, 1, 1025, 0, 1, 1, 2057, 34736, 1, 5, 2058,
        34736, 1, 6, 3075, 0, 1, 17, 3078, 34736, 1, 0, 3088, 34736, 1, 1,
      ],
    ],
    [34736, [0, centerLong, 0, 0, 0, radius, radius, 0]],
    [
      42112,
      '<GDALMetadata><Item name="OFFSET" sample="0" role="offset">0</Item><Item name="SCALE" sample="0" role="scale">0.5</Item></GDALMetadata>',
    ],
    [42113, '-32768'],
  ]);
}

describe('le GeoTIFF projeté de Mercure', () => {
  it('lit l’emprise par le méridien central : 180° met la première colonne à 0° (0 → 360° Est)', async () => {
    const { projectedEquirectangularGrid } = await load();
    const grid = projectedEquirectangularGrid(mercuryTags(180), 'mercure');
    expect(grid.westDeg).toBeCloseTo(0, 9);
    expect(grid.eastDeg).toBeCloseTo(360, 9);
    expect(grid.pixelsPerDegree).toBeCloseTo(64, 9);
    expect(grid.radiusKm).toBe(2439.4);
    expect(grid.quantumMetres).toBe(0.5);
    expect(grid.noData).toBe(-32768);
    // Le même fichier, méridien central à 0 : la grille commencerait à −180°. Un demi-tour de relief plausible.
    expect(
      projectedEquirectangularGrid(mercuryTags(0), 'mercure').westDeg
    ).toBeCloseTo(-180, 9);
  });

  it('refuse une emprise qui n’est pas le globe, un décalage GDAL non nul, une autre projection', async () => {
    const { projectedEquirectangularGrid } = await load();
    const narrow = mercuryTags(180);
    narrow.set(257, [11519]);
    expect(() => projectedEquirectangularGrid(narrow, 'mercure')).toThrow(
      /pas le globe/
    );
    const offset = mercuryTags(180);
    offset.set(
      42112,
      '<GDALMetadata><Item name="OFFSET" sample="0" role="offset">12</Item></GDALMetadata>'
    );
    expect(() => projectedEquirectangularGrid(offset, 'mercure')).toThrow(
      /décalage/
    );
    const other = mercuryTags(180);
    const keys = [...(other.get(34735) as number[])];
    keys[keys.indexOf(3075) + 3] = 8;
    other.set(34735, keys);
    expect(() => projectedEquirectangularGrid(other, 'mercure')).toThrow(
      /équirectangulaire/
    );
  });
});

/** Une étiquette de trame GTDR minimale, aux paramètres de MG_3002 (sinusoïdale, 6 051 km). */
const gtdrLabel = (specline: number, projsamp: number, size: number) => ({
  dataSetId: 'MGN-V-RDRS-5-GDR-TOPOGRAPHIC-V1.0',
  recordBytes: size * 2,
  imageRecord: 2,
  lines: size,
  lineSamples: size,
  sampleType: 'LSB_UNSIGNED_INTEGER',
  sampleBits: 16,
  scalingMetres: 1,
  offsetMetres: 6039999,
  missing: 0,
  projection: 'SINUSOIDAL',
  pixelsPerDegree: size / 45,
  metresPerPixel: (6051000 * Math.PI) / 180 / (size / 45),
  specline,
  projsamp,
  radiusKm: 6051,
  bRadiusKm: 6051,
  cRadiusKm: 6051,
  centerLongitudeDeg: 0,
  eastPositive: true,
  scalePerRadian: (180 / Math.PI) * (size / 45),
});

describe('les trames sinusoïdales du GTDR de Vénus', () => {
  // Une mosaïque de 2 lignes de 4 trames de 8 x 8 : 32 x 16 pixels, 8/45 px par degré, comme MG_3002 en petit.
  const size = 8;
  const columns = 4;
  const rows = 2;
  const make = (valueAt: (line: number, sample: number) => number) =>
    Array.from({ length: rows * columns }, (_, k) => {
      const r = Math.floor(k / columns);
      const c = k % columns;
      const label = gtdrLabel(
        (rows * size) / 2 - size * r,
        (columns * size) / 2 - size * c,
        size
      );
      const samples = new Uint16Array(size * size);
      for (let y = 0; y < size; y += 1)
        for (let x = 0; x < size; x += 1)
          samples[y * size + x] = valueAt(r * size + y, c * size + x);
      return { label, samples };
    });

  it('place l’Est à droite et le Nord en haut, aux équations de dsmap.lbl', async () => {
    const { reprojectGtdrSinusoidal } = await load();
    // Rayon = DN + 6 039 999 m ; DN croît vers l'Est (colonnes) : l'Est doit rester plus haut que l'Ouest.
    const east = reprojectGtdrSinusoidal(
      make((_line, sample) => 1000 + sample * 100),
      { columns, datumKm: 6051 }
    );
    const mid = Math.floor(east.height / 2);
    const west = east.values[mid * east.width + 1]!;
    const eastValue = east.values[mid * east.width + east.width - 2]!;
    expect(eastValue).toBeGreaterThan(west);
    // DN croît vers le Sud (lignes) : le Nord doit rester plus bas.
    const south = reprojectGtdrSinusoidal(
      make((line) => 1000 + line * 100),
      { columns, datumKm: 6051 }
    );
    const column = Math.floor(south.width / 2);
    expect(south.values[1 * south.width + column]!).toBeLessThan(
      south.values[(south.height - 2) * south.width + column]!
    );
    // Hauteurs au-dessus de la sphère : DN 1000 + 6 039 999 m − 6 051 000 m.
    expect(east.values[mid * east.width + east.width / 2]!).toBeCloseTo(
      1000 + (columns * size * 100) / 2 + 6039999 - 6051000,
      -2
    );
  });

  it('marque les cellules sans mesure (valeur 0), et refuse une trame hors de la mosaïque', async () => {
    const { reprojectGtdrSinusoidal } = await load();
    const grid = reprojectGtdrSinusoidal(
      make(() => 0),
      { columns, datumKm: 6051 }
    );
    expect(grid.missing.every((m: number) => m === 1)).toBe(true);
    const broken = make(() => 1000);
    broken[3]!.label.projsamp += 1;
    expect(() =>
      reprojectGtdrSinusoidal(broken, { columns, datumKm: 6051 })
    ).toThrow(/hors de la mosaïque/);
  });
});

describe('le comblement déclaré des trous', () => {
  it('tend une surface lisse entre les bords mesurés, sans rien ajouter, et rend la part de l’aire', async () => {
    const { fillHoles } = await load();
    const width = 64;
    const height = 32;
    const values = new Float32Array(width * height);
    const missing = new Uint8Array(width * height);
    for (let row = 0; row < height; row += 1)
      for (let col = 0; col < width; col += 1) {
        values[row * width + col] = 100 + row;
        if (row >= 12 && row < 20 && col >= 20 && col < 40) {
          missing[row * width + col] = 1;
          values[row * width + col] = 0;
        }
      }
    const { holes, filledFraction } = fillHoles(values, missing, width, height);
    expect(holes).toBe(8 * 20);
    // Près de l'équateur (lignes 12 à 19 sur 32), la part de l'aire dépasse un peu la part des cellules.
    expect(filledFraction).toBeGreaterThan(160 / (width * height));
    // Aucun détail ajouté : chaque valeur comblée reste entre les valeurs mesurées qui bordent le trou.
    for (let row = 12; row < 20; row += 1)
      for (let col = 20; col < 40; col += 1) {
        const v = values[row * width + col]!;
        expect(v).toBeGreaterThanOrEqual(100 + 10);
        expect(v).toBeLessThanOrEqual(100 + 21);
      }
    // Un champ sans trou ne change pas.
    const intact = Float32Array.from({ length: 16 }, (_, k) => k);
    expect(fillHoles(intact, new Uint8Array(16), 4, 4)).toEqual({
      holes: 0,
      filledFraction: 0,
    });
  });
});
