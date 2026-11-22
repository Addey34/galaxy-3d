import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * MODE RÉGION (GAL-IMMERSION-003B-PDS-001) : la source est un produit PDS3 ISIS (mosaïque ROI de
 * LROC) à UN canal flottant 32 bits, équirectangulaire, qui ne couvre qu'une petite emprise. La
 * pyramide n'est PAS globale : seules les tuiles de la grille 2 x 1 (même grille que la base) dont
 * TOUS les échantillons viennent de pixels valides sont écrites, aux niveaux listés par la recette.
 * Les autres restent absentes (le service répond 404, le moteur retombe sur la base). La géométrie
 * est LUE à l'étiquette de l'IMG (jamais recopiée de la recette), puis confrontée à ses emprises.
 */
export function parsePds3Header(buffer) {
  const text = buffer.subarray(0, 65536).toString('latin1');
  const end = text.search(/\r?\nEND\r?\n/);
  if (end < 0) throw new Error('étiquette PDS3 sans END');
  const header = text.slice(0, end);
  const value = (key) => {
    // `^IMAGE` : le chapeau est un caractère d'ancrage d'expression régulière, à échapper.
    const escaped = key.replaceAll('^', '\\^');
    const match = new RegExp(`^\\s*${escaped}\\s*=\\s*([^\\r\\n]+)`, 'm').exec(
      header
    );
    if (!match) throw new Error(`étiquette : ${key} absent`);
    return match[1]
      .replace(/<[^>]*>/g, '')
      .replace(/"/g, '')
      .trim();
  };
  return { value, number: (key) => Number(value(key)) };
}

export function readRegionSource(file, source) {
  const buffer = readFileSync(file);
  const label = parsePds3Header(buffer);
  const need = (key, expected) => {
    if (label.value(key) !== expected)
      throw new Error(`${key} = ${label.value(key)}, attendu ${expected}`);
  };
  need('PRODUCT_ID', source.productId);
  need('PRODUCT_VERSION_ID', source.productVersion);
  need('MAP_PROJECTION_TYPE', 'EQUIRECTANGULAR');
  need('SAMPLE_TYPE', 'PC_REAL');
  need('SAMPLE_BITS', '32');
  need('BANDS', '1');
  need('POSITIVE_LONGITUDE_DIRECTION', 'EAST');
  need('PROJECTION_LATITUDE_TYPE', 'PLANETOCENTRIC');
  const radiusKm = label.number('A_AXIS_RADIUS');
  if (
    radiusKm !== label.number('B_AXIS_RADIUS') ||
    radiusKm !== label.number('C_AXIS_RADIUS')
  )
    throw new Error('la source ne tourne pas sur une sphère');
  const width = label.number('LINE_SAMPLES');
  const height = label.number('LINES');
  const recordBytes = label.number('RECORD_BYTES');
  const offset = (label.number('^IMAGE') - 1) * recordBytes;
  if (buffer.length !== offset + width * height * 4)
    throw new Error(
      `${buffer.length} octets pour ${offset + width * height * 4} attendus`
    );
  const pixelsPerDegree = label.number('MAP_RESOLUTION');
  // Conventions ISIS : le centre du pixel supérieur gauche est (ligne 1, échantillon 1), les
  // décalages de projection sont comptés depuis lui jusqu'à l'ORIGINE (latitude 0, longitude
  // CENTER_LONGITUDE) ; CENTER_LATITUDE est le parallèle d'échelle vraie : la longueur d'un degré
  // de longitude y est celle de la latitude, multipliée par son cosinus.
  const standardParallel = label.number('CENTER_LATITUDE');
  const centerLongitude = label.number('CENTER_LONGITUDE');
  const pixelsPerDegreeLon =
    pixelsPerDegree * Math.cos((standardParallel * Math.PI) / 180);
  const latTop = label.number('LINE_PROJECTION_OFFSET') / pixelsPerDegree;
  const lonWest =
    centerLongitude -
    label.number('SAMPLE_PROJECTION_OFFSET') / pixelsPerDegreeLon;
  // Confrontation aux emprises que l'étiquette publie : un écart de plus de deux pixels est une
  // lecture fausse de la géoréférence, jamais une tolérance à élargir.
  const twoPixels = 2 / pixelsPerDegree;
  const checks = [
    ['MAXIMUM_LATITUDE', latTop],
    ['MINIMUM_LATITUDE', latTop - (height - 1) / pixelsPerDegree],
    ['WESTERNMOST_LONGITUDE', lonWest],
    ['EASTERNMOST_LONGITUDE', lonWest + (width - 1) / pixelsPerDegreeLon],
  ];
  const deviations = {};
  for (const [key, computed] of checks) {
    deviations[key] = computed - label.number(key);
    if (Math.abs(deviations[key]) > twoPixels)
      throw new Error(
        `${key} : ${computed} calculé, ${label.number(key)} publié`
      );
  }
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++)
    data[i] = buffer.readFloatLE(offset + i * 4);
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.length,
    width,
    height,
    radiusKm,
    pixelsPerDegree,
    pixelsPerDegreeLon,
    latTop,
    lonWest,
    data,
    deviations,
    label: {
      productId: label.value('PRODUCT_ID'),
      version: label.value('PRODUCT_VERSION_ID'),
      created: label.value('PRODUCT_CREATION_TIME'),
      standardParallel,
      centerLongitude,
    },
  };
}

export const isNull = (v) => !(v > -1e30);

/**
 * Où tombe un point (latitude, longitude planétocentriques, degrés) dans la source : `x` est
 * l'ÉCHANTILLON (colonne, vers l'est) et `y` la LIGNE (vers le sud), au centre du pixel (0, 0)
 * pour (0, 0). C'est la seule fonction qui relie la géographie aux indices du tableau.
 */
export function sourceCoordinates(src, lat, lon) {
  return {
    x: (lon - src.lonWest) * src.pixelsPerDegreeLon,
    y: (src.latTop - lat) * src.pixelsPerDegree,
  };
}

/** Une tuile de la grille 2 x 1 rééchantillonnée en 8 bits ; `null` si un échantillon n'est pas valide. */
export function resampleTile(src, level, row, column, tileSizePx, dnPerUnit) {
  const tileDeg = 180 / 2 ** level;
  const west = -180 + column * tileDeg;
  const north = 90 - row * tileDeg;
  const step = tileDeg / tileSizePx;
  // Pas de la tuile en pixels source : > 1,25 = réduction (suréchantillonnage 3 x 3 pour moyenner).
  const footprint = step * src.pixelsPerDegree;
  const sub = footprint > 1.25 ? 3 : 1;
  const out = Buffer.allocUnsafe(tileSizePx * tileSizePx);
  for (let py = 0; py < tileSizePx; py++) {
    for (let px = 0; px < tileSizePx; px++) {
      let sum = 0;
      for (let sy = 0; sy < sub; sy++)
        for (let sx = 0; sx < sub; sx++) {
          const lon = west + (px + (sx + 0.5) / sub) * step;
          const lat = north - (py + (sy + 0.5) / sub) * step;
          const { x, y } = sourceCoordinates(src, lat, lon);
          if (x < 0 || y < 0 || x > src.width - 1 || y > src.height - 1)
            return null;
          const x0 = Math.min(Math.floor(x), src.width - 2);
          const y0 = Math.min(Math.floor(y), src.height - 2);
          const fx = x - x0;
          const fy = y - y0;
          const a = src.data[y0 * src.width + x0];
          const b = src.data[y0 * src.width + x0 + 1];
          const c = src.data[(y0 + 1) * src.width + x0];
          const d = src.data[(y0 + 1) * src.width + x0 + 1];
          if (isNull(a) || isNull(b) || isNull(c) || isNull(d)) return null;
          sum +=
            (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
        }
      out[py * tileSizePx + px] = Math.max(
        0,
        Math.min(255, Math.round((sum / (sub * sub)) * dnPerUnit))
      );
    }
  }
  return out;
}

/**
 * Photométrie de la conversion 8 bits, mesurée sur les échantillons VALIDES de la source :
 * part écrêtée en haut (niveau >= 254,5), part à zéro (réflectance <= 0 : bruit ou ombre profonde),
 * valeur maximale. Les pixels nuls ne sont jamais encodés (une tuile qui en contient est omise).
 */
export function photometryStats(src, dnPerUnit) {
  let valid = 0;
  let clipped = 0;
  let zero = 0;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < src.data.length; i++) {
    const v = src.data[i];
    if (isNull(v)) continue;
    valid += 1;
    sum += v;
    if (v > max) max = v;
    const dn = v * dnPerUnit;
    if (dn >= 254.5) clipped += 1;
    if (dn <= 0.5) zero += 1;
  }
  return {
    validSamples: valid,
    nullSamples: src.data.length - valid,
    meanReflectance: sum / valid,
    maxReflectance: max,
    clippedHighFraction: clipped / valid,
    zeroFraction: zero / valid,
  };
}
