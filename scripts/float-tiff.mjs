/* global Buffer */
/**
 * UN TIFF FLOTTANT À UNE BANDE, écrit à la main (2026-10-05).
 *
 * `sharp` ne sait pas l'écrire ici : un `Float32Array` en entrée brute sort en TIFF 8 bits à TROIS
 * canaux, valeurs perdues, sans erreur (mesuré). Ce TIFF minimal (petit-boutiste, non compressé,
 * une seule bande de données, `SampleFormat` = 3) est relu par `sharp` comme « float, 1 canal »,
 * ce qu'exige `scripts/compose-albedo-texture.mjs`. NoData = 0.
 */
import { writeFileSync } from 'node:fs';

export function writeFloatTiff(path, data, width, height) {
  // [étiquette, type (3 = SHORT, 4 = LONG), nombre, valeur]
  const entries = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 1, 32], // BitsPerSample
    [259, 3, 1, 1], // pas de compression
    [262, 3, 1, 1], // noir = 0
    [273, 4, 1, 0], // StripOffsets, renseigné plus bas
    [277, 3, 1, 1], // SamplesPerPixel
    [278, 4, 1, height], // RowsPerStrip : une seule bande
    [279, 4, 1, width * height * 4],
    [339, 3, 1, 3], // SampleFormat : flottant IEEE
  ];
  const dataOffset = 8 + 2 + entries.length * 12 + 4;
  const buf = Buffer.alloc(dataOffset + width * height * 4);
  buf.write('II', 0);
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);
  buf.writeUInt16LE(entries.length, 8);
  entries.forEach(([tag, type, count, value], i) => {
    const o = 10 + i * 12;
    buf.writeUInt16LE(tag, o);
    buf.writeUInt16LE(type, o + 2);
    buf.writeUInt32LE(count, o + 4);
    const v = tag === 273 ? dataOffset : value;
    if (type === 3) buf.writeUInt16LE(v, o + 8);
    else buf.writeUInt32LE(v, o + 8);
  });
  buf.writeUInt32LE(0, 10 + entries.length * 12);
  for (let i = 0; i < data.length; i++)
    buf.writeFloatLE(data[i], dataOffset + i * 4);
  writeFileSync(path, buf);
}
