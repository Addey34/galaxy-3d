/* global Buffer */
/**
 * LECTEUR DE COG FLOTTANT, minimal et sans dépendance (lot 53, pas 3).
 *
 * Le Copernicus DEM GLO-30 est servi en GeoTIFF « optimisé pour le nuage » : TIFF classique,
 * TUILÉ, compressé par déflation (8), prédicteur FLOTTANT (3), un canal float32. Le lecteur du
 * dépôt (`geotiff-grid.mjs`) ne lit que des bandes non compressées ; celui-ci ne lit que ce cas,
 * et refuse tout autre plutôt que de rendre des valeurs fausses d'apparence juste.
 *
 * Le prédicteur 3 (spécification Adobe, TIFF Technical Note 3) range chaque ligne de tuile en
 * PLANS d'octets (tous les octets de poids fort, puis les suivants), puis différencie
 * horizontalement octet par octet. Le décodage fait l'inverse : somme cumulée sur la ligne,
 * modulo 256, puis remise des quatre plans en flottants grand-boutiens. Prototype validé le
 * 2026-10-16 : le Mont-Blanc sort à 4 811 m de sa tuile (4 808 publiés).
 *
 * Le pas en longitude peut différer du pas en latitude : au-dessus de 50° de latitude, GLO-30
 * passe à 2″ puis davantage en longitude (1 800 colonnes à 61° N, mesuré). Les deux sont rendus.
 */
import { inflateSync } from 'node:zlib';

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  predictor: 317,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  sampleFormat: 339,
  pixelScale: 33550,
  tiepoint: 33922,
  geoKeys: 34735,
  noData: 42113,
};
const TYPE_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };

/** Les balises du premier IFD (la pleine résolution ; les aperçus suivent et sont ignorés). */
function readTags(bytes) {
  const order = bytes.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') throw new Error('pas un TIFF');
  const le = order === 'II';
  const u16 = (o) => (le ? bytes.readUInt16LE(o) : bytes.readUInt16BE(o));
  const u32 = (o) => (le ? bytes.readUInt32LE(o) : bytes.readUInt32BE(o));
  if (u16(2) !== 42) throw new Error('BigTIFF non lu');
  const ifd = u32(4);
  const count = u16(ifd);
  const tags = new Map();
  for (let i = 0; i < count; i += 1) {
    const at = ifd + 2 + i * 12;
    const tag = u16(at);
    const type = u16(at + 2);
    const n = u32(at + 4);
    const size = (TYPE_BYTES[type] ?? 0) * n;
    const offset = size <= 4 ? at + 8 : u32(at + 8);
    const values = [];
    for (let k = 0; k < n; k += 1) {
      const o = offset + k * (TYPE_BYTES[type] ?? 0);
      if (type === 3) values.push(u16(o));
      else if (type === 4) values.push(u32(o));
      else if (type === 12)
        values.push(le ? bytes.readDoubleLE(o) : bytes.readDoubleBE(o));
      else if (type === 2) values.push(bytes[o]);
      else if (type === 1) values.push(bytes[o]);
    }
    tags.set(
      tag,
      type === 2
        ? Buffer.from(values).toString('latin1').replace(/\0+$/, '')
        : values
    );
  }
  return { tags, le };
}

/** Décode une tuile prédite (prédicteur 3) en flottants. */
function undoFloatPredictor(raw, tileWidth, tileHeight) {
  const rowBytes = tileWidth * 4;
  const out = new Float32Array(tileWidth * tileHeight);
  const be = Buffer.alloc(4);
  for (let y = 0; y < tileHeight; y += 1) {
    const row = raw.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let i = 1; i < rowBytes; i += 1) row[i] = (row[i] + row[i - 1]) & 0xff;
    for (let x = 0; x < tileWidth; x += 1) {
      for (let p = 0; p < 4; p += 1) be[p] = row[p * tileWidth + x];
      out[y * tileWidth + x] = be.readFloatBE(0);
    }
  }
  return out;
}

/**
 * Lit un COG flottant tuilé. Rend la grille et son géoréférencement : coin nord-ouest du premier
 * échantillon (centre, `pixelIsPoint`, ou bord, sinon) et pas en longitude ET en latitude.
 */
export function readFloatCog(bytes, source = 'COG') {
  const { tags, le } = readTags(bytes);
  const one = (tag, name) => {
    const v = tags.get(tag);
    if (v === undefined) throw new Error(`${source} : balise ${name} absente`);
    return v;
  };
  const width = one(TAG.width, 'ImageWidth')[0];
  const height = one(TAG.height, 'ImageLength')[0];
  const compression = one(TAG.compression, 'Compression')[0];
  const predictor = (tags.get(TAG.predictor) ?? [1])[0];
  const bits = one(TAG.bitsPerSample, 'BitsPerSample')[0];
  const format = (tags.get(TAG.sampleFormat) ?? [1])[0];
  if (
    compression !== 8 ||
    bits !== 32 ||
    format !== 3 ||
    ![1, 3].includes(predictor)
  )
    throw new Error(
      `${source} : compression ${compression}, ${bits} bits, format ${format}, prédicteur ${predictor} ; attendu déflation, float32, prédicteur 1 ou 3`
    );
  const tw = one(TAG.tileWidth, 'TileWidth')[0];
  const th = one(TAG.tileLength, 'TileLength')[0];
  const offsets = one(TAG.tileOffsets, 'TileOffsets');
  const counts = one(TAG.tileByteCounts, 'TileByteCounts');
  const across = Math.ceil(width / tw);
  const values = new Float32Array(width * height);
  for (let k = 0; k < offsets.length; k += 1) {
    const raw = inflateSync(bytes.subarray(offsets[k], offsets[k] + counts[k]));
    let tile;
    if (predictor === 3) tile = undoFloatPredictor(raw, tw, th);
    else {
      tile = new Float32Array(tw * th);
      for (let i = 0; i < tw * th; i += 1)
        tile[i] = le ? raw.readFloatLE(i * 4) : raw.readFloatBE(i * 4);
    }
    const y0 = Math.floor(k / across) * th;
    const x0 = (k % across) * tw;
    for (let y = 0; y < th && y0 + y < height; y += 1)
      for (let x = 0; x < tw && x0 + x < width; x += 1)
        values[(y0 + y) * width + x0 + x] = tile[y * tw + x];
  }
  const [stepLon, stepLat] = one(TAG.pixelScale, 'ModelPixelScale');
  const [i, j, , west, north] = one(TAG.tiepoint, 'ModelTiepoint');
  if (i !== 0 || j !== 0)
    throw new Error(`${source} : point d'attache en (${i}, ${j})`);
  const keys = tags.get(TAG.geoKeys) ?? [];
  let rasterType;
  for (let k = 4; k + 3 < keys.length; k += 4)
    if (keys[k] === 1025) rasterType = keys[k + 3];
  const noData = tags.get(TAG.noData);
  return {
    width,
    height,
    stepLonDeg: stepLon,
    stepLatDeg: stepLat,
    westDeg: west,
    northDeg: north,
    // RasterPixelIsPoint (2) : le point d'attache est le CENTRE du premier échantillon.
    pixelIsPoint: rasterType === 2,
    noData: noData === undefined ? undefined : Number(noData),
    values,
  };
}
