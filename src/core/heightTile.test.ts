import { describe, expect, it } from 'vitest';

import {
  decodeHeightTile,
  heightMetresAt,
  HEIGHT_TILE_MAGIC,
} from './heightTile';

/**
 * CE QU'UNE TUILE DE HAUTEURS DOIT REFUSER.
 *
 * Le décodeur est la seule barrière entre des octets et une altitude. Trois refus comptent, et
 * aucun ne se verrait à l'écran : des octets qui ne sont pas une tuile (l'hébergeur réécrit
 * toute adresse inconnue vers la page de l'application, donc un fichier absent revient en
 * HTTP 200 avec du HTML), une tuile d'un autre endroit du corps, et une tuile tronquée.
 */

const SAMPLES = 5;

function encode(params: {
  magic?: string;
  version?: number;
  level?: number;
  row?: number;
  column?: number;
  samples?: number;
  quantumMetres?: number;
  offsetMetres?: number;
  values?: number[];
  extraBytes?: number;
}): ArrayBuffer {
  const samples = params.samples ?? SAMPLES;
  const count = samples * samples;
  const buffer = new ArrayBuffer(32 + count * 2 + (params.extraBytes ?? 0));
  const view = new DataView(buffer);
  const magic = params.magic ?? HEIGHT_TILE_MAGIC;
  for (let i = 0; i < 4; i += 1) view.setUint8(i, magic.charCodeAt(i));
  view.setUint16(4, params.version ?? 1, true);
  view.setUint16(6, 32, true);
  view.setUint16(8, params.level ?? 4, true);
  view.setUint16(10, params.row ?? 7, true);
  view.setUint16(12, params.column ?? 21, true);
  view.setUint16(14, samples, true);
  view.setFloat64(16, params.quantumMetres ?? 0.5, true);
  view.setFloat64(24, params.offsetMetres ?? 0, true);
  const values = new Int16Array(buffer, 32, count);
  for (let i = 0; i < count; i += 1) values[i] = params.values?.[i] ?? i;
  return buffer;
}

describe('décodage d’une tuile de hauteurs', () => {
  it('lit l’en-tête et les valeurs', () => {
    const tile = decodeHeightTile(encode({}));
    expect(tile.level).toBe(4);
    expect(tile.row).toBe(7);
    expect(tile.column).toBe(21);
    expect(tile.samples).toBe(SAMPLES);
    expect(tile.quantumMetres).toBe(0.5);
    expect(tile.values).toHaveLength(SAMPLES * SAMPLES);
  });

  it('convertit en mètres avec le quantum et l’offset DU FICHIER', () => {
    // Le décodeur ne connaît aucune constante : changer le pas de quantification du cuiseur ne
    // doit demander aucune modification de code.
    const tile = decodeHeightTile(
      encode({ quantumMetres: 2, offsetMetres: -100, values: [0, 50] })
    );
    expect(heightMetresAt(tile, 1, 0)).toBe(-100 + 50 * 2);
  });

  it('borne les indices hors tuile au lieu de rendre `undefined`', () => {
    const tile = decodeHeightTile(encode({ values: [7] }));
    expect(heightMetresAt(tile, -3, -3)).toBe(7 * 0.5);
  });

  it('refuse une page HTML servie à la place d’un fichier absent', () => {
    // C'est le cas RÉEL : `firebase.json` réécrit toute adresse inconnue vers `/index.html`,
    // et la réponse porte un 200. Sans la marque de tête, « <!DOCTYPE » deviendrait du relief.
    const html = new TextEncoder().encode(
      '<!DOCTYPE html><html><head></head></html>'
    );
    expect(() => decodeHeightTile(html.buffer as ArrayBuffer)).toThrow(
      /marque/
    );
  });

  it('refuse une version de format inconnue', () => {
    expect(() => decodeHeightTile(encode({ version: 2 }))).toThrow(/version/);
  });

  it('refuse une tuile qui n’est pas celle demandée', () => {
    // Une tuile juste, au mauvais endroit, donne un relief faux que rien ne signale.
    expect(() =>
      decodeHeightTile(encode({ row: 8 }), { level: 4, row: 7, column: 21 })
    ).toThrow(/reçue pour/);
  });

  it('accepte la tuile demandée', () => {
    expect(() =>
      decodeHeightTile(encode({}), { level: 4, row: 7, column: 21 })
    ).not.toThrow();
  });

  it('refuse une tuile dont la taille ne correspond pas à son en-tête', () => {
    expect(() => decodeHeightTile(encode({ extraBytes: 2 }))).toThrow(/octets/);
  });

  it('refuse un quantum nul, qui écraserait tout le relief à zéro', () => {
    expect(() => decodeHeightTile(encode({ quantumMetres: 0 }))).toThrow(
      /quantum/
    );
  });
});
