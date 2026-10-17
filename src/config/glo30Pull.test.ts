import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readFloatCog } from '../../scripts/cog-reader.mjs';
import {
  GLO30_NO_DATA,
  GLO30_REDUCED_PER_DEGREE,
  cellName,
  plannedCells,
  reduceCell,
} from '../../scripts/pull-glo30.mjs';

/**
 * LE RELIEF À 30 M, TIRÉ ET RÉDUIT (lot 53, pas 3). Le lecteur COG est confronté à un COG
 * SYNTHÉTIQUE encodé ici même (déflation, prédicteur flottant 3, tuiles), donc sans réseau ; il
 * a été validé sur les vraies tuiles le 2026-10-16 (Mont-Blanc 4 811 m, 4 808 publiés).
 */

/** Encode une grille en COG minimal : une tuile, prédicteur 3, géoréférencement point. */
function encodeCog(
  width: number,
  height: number,
  values: Float32Array
): Buffer {
  const rowBytes = width * 4;
  const raw = Buffer.alloc(rowBytes * height);
  const be = Buffer.alloc(4);
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < width; x += 1) {
      be.writeFloatBE(values[y * width + x]!, 0);
      for (let p = 0; p < 4; p += 1) row[p * width + x] = be[p]!;
    }
    // Différence horizontale octet par octet, l'inverse de ce que le lecteur défait.
    for (let i = rowBytes - 1; i > 0; i -= 1)
      row[i] = (row[i]! - row[i - 1]!) & 0xff;
    row.copy(raw, y * rowBytes);
  }
  const tile = deflateSync(raw);
  // En-tête, IFD de 13 balises, puis les tableaux et la tuile.
  const entries: [number, number, number, number[]][] = [
    [256, 3, 1, [width]],
    [257, 3, 1, [height]],
    [258, 3, 1, [32]],
    [259, 3, 1, [8]],
    [317, 3, 1, [3]],
    [322, 3, 1, [width]],
    [323, 3, 1, [height]],
    [324, 4, 1, [0]],
    [325, 4, 1, [tile.length]],
    [339, 3, 1, [3]],
  ];
  const doubles: [number, number[]][] = [
    [33550, [0.5, 0.25, 0]],
    [33922, [0, 0, 0, 6, 46, 0]],
  ];
  const keys = [1, 1, 0, 1, 1025, 0, 1, 2];
  const count = entries.length + doubles.length + 1;
  const ifdSize = 2 + count * 12 + 4;
  let extra = 8 + ifdSize;
  const out = Buffer.alloc(extra + 8 * 9 + keys.length * 2 + tile.length + 16);
  out.write('II', 0, 'latin1');
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(8, 4);
  out.writeUInt16LE(count, 8);
  let at = 10;
  const tileOffsetEntry: number[] = [];
  for (const [tag, type, n, v] of entries) {
    out.writeUInt16LE(tag, at);
    out.writeUInt16LE(type, at + 2);
    out.writeUInt32LE(n, at + 4);
    if (type === 3) out.writeUInt16LE(v[0]!, at + 8);
    else out.writeUInt32LE(v[0]!, at + 8);
    if (tag === 324) tileOffsetEntry.push(at + 8);
    at += 12;
  }
  for (const [tag, v] of doubles) {
    out.writeUInt16LE(tag, at);
    out.writeUInt16LE(12, at + 2);
    out.writeUInt32LE(v.length, at + 4);
    out.writeUInt32LE(extra, at + 8);
    v.forEach((d, k) => out.writeDoubleLE(d, extra + k * 8));
    extra += v.length * 8;
    at += 12;
  }
  out.writeUInt16LE(34735, at);
  out.writeUInt16LE(3, at + 2);
  out.writeUInt32LE(keys.length, at + 4);
  out.writeUInt32LE(extra, at + 8);
  keys.forEach((k, i) => out.writeUInt16LE(k, extra + i * 2));
  extra += keys.length * 2;
  at += 12;
  out.writeUInt32LE(0, at);
  tile.copy(out, extra);
  out.writeUInt32LE(extra, tileOffsetEntry[0]!);
  return out;
}

describe('lecteur COG flottant (lot 53)', () => {
  it('défait la déflation et le prédicteur 3, et rend le géoréférencement', () => {
    const w = 8;
    const h = 4;
    const values = Float32Array.from(
      { length: w * h },
      (_, i) => 4808 - i * 13.25
    );
    const cog = readFloatCog(encodeCog(w, h, values), 'synthétique');
    expect(Array.from(cog.values)).toEqual(Array.from(values));
    expect(cog.width).toBe(w);
    expect(cog.stepLonDeg).toBe(0.5);
    expect(cog.stepLatDeg).toBe(0.25);
    expect([cog.westDeg, cog.northDeg]).toEqual([6, 46]);
    expect(cog.pixelIsPoint).toBe(true);
  });
});

describe('réduction d’un degré à 5″ (lot 53)', () => {
  const n = GLO30_REDUCED_PER_DEGREE;
  it('moyenne de surface : chaque case prend les échantillons dont le centre y tombe', () => {
    // Une source à 2,5″ (deux par deux dans chaque case de 5″), point-registered.
    const per = 2 * n;
    const values = new Float32Array(per * per);
    for (let y = 0; y < per; y += 1)
      for (let x = 0; x < per; x += 1)
        values[y * per + x] = x % 2 === 0 ? 100 : 200;
    const reduced = reduceCell(
      {
        width: per,
        height: per,
        stepLonDeg: 1 / per,
        stepLatDeg: 1 / per,
        westDeg: 6 + 0.25 / per,
        northDeg: 46 - 0.25 / per,
        pixelIsPoint: true,
        noData: undefined,
        values,
      },
      45,
      6
    );
    expect(reduced.length).toBe(n * n);
    expect(reduced[0]).toBe(150);
    expect(reduced[n * n - 1]).toBe(150);
  });

  it('une case sans valeur valide dit « sans donnée », jamais zéro', () => {
    const reduced = reduceCell(
      {
        width: 1,
        height: 1,
        stepLonDeg: 1,
        stepLatDeg: 1,
        westDeg: 6.5,
        northDeg: 45.5,
        pixelIsPoint: true,
        noData: undefined,
        values: Float32Array.from([-32767]),
      },
      45,
      6
    );
    expect(reduced.every((v) => v === GLO30_NO_DATA)).toBe(true);
  });
});

describe('les degrés à tirer se dérivent du manifeste livré (lot 53)', () => {
  it('seulement les boîtes de montagne du niveau 7, nommées par leur coin sud-ouest', () => {
    const cells = plannedCells({
      coverage: [
        { levels: [5, 6] },
        { levels: [7], bounds: { west: 5.5, east: 7, north: 46, south: 45 } },
        { levels: [6], bounds: { west: 100, east: 101, north: 1, south: 0 } },
      ],
    });
    expect(cells.map(([name]) => name)).toEqual(['N45E005', 'N45E006']);
    expect(cellName(-1, -79)).toBe('S01W079');
  });
});
