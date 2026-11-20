import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  photometryStats,
  readRegionSource,
  resampleTile,
  sourceCoordinates,
} from '../../scripts/pds-region.mjs';

/**
 * LE GÉORÉFÉRENCEMENT D'UNE RÉGION PDS (GAL-IMMERSION-003B-PDS-002, lot C1).
 *
 * Le produit `NAC_ROI_APOLLO11LOA_E004N0235_5M` est HAUT et ÉTROIT : 1 043 échantillons (colonnes) sur
 * 5 734 lignes, soit 5,2 km d'est en ouest sur 28,7 km du nord au sud (pas 20 x 100 km). Un tableau
 * dont on lirait largeur et hauteur à l'envers, un nord posé en bas ou un décalage de quelques
 * pixels donneraient des tuiles plausibles et FAUSSES : ces gardes l'échouent chacune.
 *
 * Deux sources de vérité, aucune lue dans l'autre : une source SYNTHÉTIQUE dont chaque valeur
 * encode sa ligne et son échantillon (toujours exécutée), puis le manifeste et l'inventaire
 * livrés (toujours exécutés), puis l'IMG réel quand `.cache/imagery-bake/` le contient.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const PENDING = resolve(
  ROOT,
  'scripts/pending-publication/moon-lroc-nac-apollo11-5m'
);
const KM_PER_DEG = (Math.PI / 180) * 1737.4;

/** Étiquette PDS3 de même forme que celle du produit, pour une petite grille. */
function synthetic(width: number, height: number): string {
  const res = 6064.6700848299;
  const cos = Math.cos((0.7 * Math.PI) / 180);
  const latTop = 0.91441015314822;
  const lonWest = 23.433405;
  const recordBytes = 4 * width;
  const labelRecords = Math.ceil(2048 / recordBytes);
  const label = `PDS_VERSION_ID = PDS3
RECORD_TYPE = FIXED_LENGTH
RECORD_BYTES = ${recordBytes}
LABEL_RECORDS = ${labelRecords}
^IMAGE = ${labelRecords + 1}
PRODUCT_ID = ESSAI_5M
PRODUCT_VERSION_ID = "v0"
PRODUCT_CREATION_TIME = 2020-01-01T00:00:00
OBJECT = IMAGE_MAP_PROJECTION
  MAP_PROJECTION_TYPE = EQUIRECTANGULAR
  PROJECTION_LATITUDE_TYPE = PLANETOCENTRIC
  A_AXIS_RADIUS = 1737.4 <KM>
  B_AXIS_RADIUS = 1737.4 <KM>
  C_AXIS_RADIUS = 1737.4 <KM>
  POSITIVE_LONGITUDE_DIRECTION = EAST
  CENTER_LATITUDE = 0.7 <DEG>
  CENTER_LONGITUDE = 23.0 <DEG>
  MAP_RESOLUTION = ${res} <PIX/DEG>
  MAXIMUM_LATITUDE = ${latTop}
  MINIMUM_LATITUDE = ${latTop - (height - 1) / res}
  WESTERNMOST_LONGITUDE = ${lonWest}
  EASTERNMOST_LONGITUDE = ${lonWest + (width - 1) / (res * cos)}
  LINE_PROJECTION_OFFSET = ${latTop * res}
  SAMPLE_PROJECTION_OFFSET = ${-(lonWest - 23.0) * res * cos}
END_OBJECT = IMAGE_MAP_PROJECTION
OBJECT = IMAGE
  LINES = ${height}
  LINE_SAMPLES = ${width}
  SAMPLE_TYPE = PC_REAL
  SAMPLE_BITS = 32
  BANDS = 1
END_OBJECT = IMAGE
END
`;
  return label;
}

function writeSynthetic(
  width: number,
  height: number,
  mutate?: (label: string) => string
): string {
  const text = mutate
    ? mutate(synthetic(width, height))
    : synthetic(width, height);
  const recordBytes = 4 * width;
  const labelRecords = Math.ceil(2048 / recordBytes);
  const header = Buffer.alloc(labelRecords * recordBytes, 0x20);
  header.write(text.replace(/\n/g, '\r\n'), 0, 'latin1');
  const body = Buffer.alloc(width * height * 4);
  for (let line = 0; line < height; line += 1)
    for (let sample = 0; sample < width; sample += 1)
      // Réflectance 0,001 x (ligne + échantillon / 1000) : lisible et exacte en 32 bits.
      body.writeFloatLE(
        0.001 * (line + sample / 1000),
        (line * width + sample) * 4
      );
  const file = join(mkdtempSync(join(tmpdir(), 'pds-')), 'essai.IMG');
  writeFileSync(file, Buffer.concat([header, body]));
  return file;
}

const SOURCE = { productId: 'ESSAI_5M', productVersion: 'v0' };

describe('source synthétique : chaque valeur encode sa position', () => {
  const width = 40;
  const height = 120; // haute et étroite, comme le produit
  const src = readRegionSource(writeSynthetic(width, height), SOURCE);

  it('lit 40 échantillons (est-ouest) sur 120 lignes (nord-sud), jamais transposés', () => {
    expect(src.width).toBe(width);
    expect(src.height).toBe(height);
    expect(src.data[3 * width + 7]).toBeCloseTo(0.001 * (3 + 7 / 1000), 9);
  });

  it('la ligne 0 est le NORD, l’échantillon 0 est l’OUEST', () => {
    const northWest = sourceCoordinates(src, src.latTop, src.lonWest);
    expect(northWest.x).toBeCloseTo(0, 9);
    expect(northWest.y).toBeCloseTo(0, 9);
    const southOfIt = sourceCoordinates(
      src,
      src.latTop - 10 / src.pixelsPerDegree,
      src.lonWest
    );
    expect(southOfIt.y).toBeCloseTo(10, 6); // vers le sud : les lignes croissent
    const eastOfIt = sourceCoordinates(
      src,
      src.latTop,
      src.lonWest + 5 / src.pixelsPerDegreeLon
    );
    expect(eastOfIt.x).toBeCloseTo(5, 6); // vers l'est : les échantillons croissent
  });

  it('une tuile rééchantillonnée porte la valeur de SON pixel, pas celle d’un voisin ni du symétrique', () => {
    // Niveau 17 (tuile de 8 pixels source de côté : elle tient dans la source synthétique, suréchantillonnée).
    const level = 17;
    const tileDeg = 180 / 2 ** level;
    // Un pixel de tuile dont le centre tombe PILE sur le pixel (ligne 30, échantillon 20) de la source.
    const lat = src.latTop - 30 / src.pixelsPerDegree;
    const lon = src.lonWest + 20 / src.pixelsPerDegreeLon;
    const row = Math.floor((90 - lat) / tileDeg);
    const column = Math.floor((lon + 180) / tileDeg);
    const north = 90 - row * tileDeg;
    const west = -180 + column * tileDeg;
    const step = tileDeg / 256;
    const px = Math.round((lon - west) / step - 0.5);
    const py = Math.round((north - lat) / step - 0.5);
    // dnPerUnit = 1 000 : la valeur 0,001 x (30 + 0,02) donne 30,02 niveaux.
    const tile = resampleTile(src, level, row, column, 256, 1000);
    if (!tile) throw new Error('tuile hors de la source synthétique');
    const got = tile[py * 256 + px]!;
    // Au pixel visé (arrondi du centre) : ligne 30 +- 0,6 pixel de source.
    expect(got).toBeGreaterThanOrEqual(29);
    expect(got).toBeLessThanOrEqual(31);
    // Si les lignes étaient lues au nord pour le sud, ou transposées, la valeur serait très autre.
    const mirrored = 0.001 * (height - 1 - 30) * 1000;
    expect(Math.abs(got - mirrored)).toBeGreaterThan(40);
  });

  it('refuse une étiquette qui ne cadre plus avec ses propres emprises (décalage de plus de deux pixels)', () => {
    const shifted = writeSynthetic(width, height, (label) =>
      label.replace(/SAMPLE_PROJECTION_OFFSET = (-?[\d.]+)/, (_m, value) => {
        return `SAMPLE_PROJECTION_OFFSET = ${Number(value) - 3}`; // 3 pixels de décalage
      })
    );
    expect(() => readRegionSource(shifted, SOURCE)).toThrow(
      /WESTERNMOST|EASTERNMOST/
    );
    const flipped = writeSynthetic(width, height, (label) =>
      label.replace(/LINE_PROJECTION_OFFSET = ([\d.]+)/, (_m, value) => {
        return `LINE_PROJECTION_OFFSET = ${Number(value) - 5}`; // nord décalé de 5 lignes
      })
    );
    expect(() => readRegionSource(flipped, SOURCE)).toThrow(/LATITUDE/);
  });

  it('refuse une étiquette de mauvaise identité ou de mauvais type', () => {
    expect(() =>
      readRegionSource(writeSynthetic(width, height), {
        productId: 'AUTRE',
        productVersion: 'v0',
      })
    ).toThrow(/PRODUCT_ID/);
    expect(() =>
      readRegionSource(
        writeSynthetic(width, height, (l) =>
          l.replace(
            'POSITIVE_LONGITUDE_DIRECTION = EAST',
            'POSITIVE_LONGITUDE_DIRECTION = WEST'
          )
        ),
        SOURCE
      )
    ).toThrow(/POSITIVE_LONGITUDE_DIRECTION/);
  });
});

describe('manifeste et inventaire livrés : la géographie du produit', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(PENDING, 'manifest.json'), 'utf8')
  ) as {
    source: { width: number; height: number };
    region: { bbox: [number, number, number, number] };
  };
  const [west, south, east, north] = manifest.region.bbox;
  const cos = Math.cos((0.7 * Math.PI) / 180);

  it('mesure 5,2 km d’est en ouest et 28,7 km du nord au sud (haute, pas large)', () => {
    const eastWestKm = (east - west) * KM_PER_DEG * cos;
    const northSouthKm = (north - south) * KM_PER_DEG;
    expect(eastWestKm).toBeGreaterThan(5.1);
    expect(eastWestKm).toBeLessThan(5.3);
    expect(northSouthKm).toBeGreaterThan(28.6);
    expect(northSouthKm).toBeLessThan(28.8);
    // 1 043 échantillons x 5 m = 5,2 km ; 5 734 lignes x 5 m = 28,7 km.
    expect(manifest.source.width * 5).toBeCloseTo(eastWestKm * 1000, -2);
    expect(manifest.source.height * 5).toBeCloseTo(northSouthKm * 1000, -2);
  });

  it('les bornes sont celles du produit : 23,4334 à 23,6054 E, -0,0310 à 0,9145 N (au pixel près)', () => {
    const pixel = 1 / 6064.67;
    expect(Math.abs(west - 23.433388)).toBeLessThan(2 * pixel);
    expect(Math.abs(east - 23.605419)).toBeLessThan(2 * pixel);
    expect(Math.abs(south - -0.031045)).toBeLessThan(2 * pixel);
    expect(Math.abs(north - 0.91441)).toBeLessThan(2 * pixel);
  });

  it('chaque tuile livrée est ENTIÈREMENT dans l’emprise, et celle du module lunaire d’Apollo 11 y est', () => {
    const inventory = JSON.parse(
      readFileSync(resolve(PENDING, 'objects.json'), 'utf8')
    ) as { objects: Array<{ path: string }> };
    const paths = new Set(inventory.objects.map((o) => o.path));
    for (const { path } of inventory.objects) {
      const [level, row, column] = path
        .replace(/^default\/galaxy-eq2x1\//, '')
        .replace(/\.jpg$/, '')
        .split('/')
        .map(Number) as [number, number, number];
      const deg = 180 / 2 ** level;
      const w = -180 + column * deg;
      const n = 90 - row * deg;
      expect(w, path).toBeGreaterThanOrEqual(west - 1e-9);
      expect(w + deg, path).toBeLessThanOrEqual(east + 1e-9);
      expect(n, path).toBeLessThanOrEqual(north + 1e-9);
      expect(n - deg, path).toBeGreaterThanOrEqual(south - 1e-9);
    }
    // Base Tranquillité, mesurée par LRO : 0,67416 N, 23,47314 E.
    for (const level of [11, 12, 13]) {
      const deg = 180 / 2 ** level;
      const row = Math.floor((90 - 0.67416) / deg);
      const column = Math.floor((23.47314 + 180) / deg);
      expect(
        paths.has(`default/galaxy-eq2x1/${level}/${row}/${column}.jpg`),
        `niveau ${level}, ligne ${row}, colonne ${column}`
      ).toBe(true);
    }
  });
});

const IMG = resolve(
  ROOT,
  '.cache/imagery-bake/NAC_ROI_APOLLO11LOA_E004N0235_5M.IMG'
);
describe.skipIf(!existsSync(IMG))('IMG réel (cache local du cuiseur)', () => {
  const src = readRegionSource(IMG, {
    productId: 'NAC_ROI_APOLLO11LOA_E004N0235_5M',
    productVersion: 'v1.3',
  });

  it('1 043 échantillons x 5 734 lignes, bornes dans le pixel de celles de l’étiquette', () => {
    expect(src.width).toBe(1043);
    expect(src.height).toBe(5734);
    for (const deviation of Object.values(src.deviations))
      expect(Math.abs(deviation)).toBeLessThan(1 / 6064.67);
  });

  it('la base Tranquillité tombe dans l’image, au bon endroit, avec des données valides', () => {
    const { x, y } = sourceCoordinates(src, 0.67416, 23.47314);
    expect(x).toBeGreaterThan(238);
    expect(x).toBeLessThan(243);
    expect(y).toBeGreaterThan(1454);
    expect(y).toBeLessThan(1460);
    const v = src.data[Math.round(y) * src.width + Math.round(x)]!;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.06);
  });

  it('la photométrie : écrêtage négligeable, aucun pixel nul encodé', () => {
    const stats = photometryStats(src, 9500);
    expect(stats.clippedHighFraction).toBeLessThan(0.001);
    expect(stats.maxReflectance * 9500).toBeGreaterThan(255); // le maximum dépasse : il est écrêté
    expect(stats.nullSamples).toBe(442835);
  });
});
