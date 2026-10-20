/**
 * TUILE DE BÂTIMENTS : format, encodage et décodage — module pur, testé, sans réseau ni Three.js
 * (lot 63, étape C.2).
 *
 * Ces tuiles sont cuites hors ligne par `scripts/bake-building-tiles.mjs` depuis une source
 * ouverte (BD TOPO, Overture…), UN jeu par source et jamais fusionné : l'ODbL interdit d'ajouter
 * à une base dérivée des contenus qui lui sont incompatibles (4.4 d). L'encodeur vit ICI, avec le
 * décodeur, et le cuiseur le charge par `ssrLoadModule` : les deux ne peuvent pas dériver l'un de
 * l'autre.
 *
 * Ce que le format garde : l'emprise EXTÉRIEURE de chaque polygone, une hauteur en décimètres et
 * l'ORIGINE de cette hauteur (mesurée, interpolée, déduite des étages, absente). Il ne garde pas
 * les cours intérieures ni la forme du toit : un bâtiment est un prisme à toit plat, et le dire
 * est le travail de la légende, pas du format.
 *
 * La marque de tête n'est pas décorative : un hébergeur qui réécrit toute adresse inconnue vers
 * la page de l'application rend un fichier absent en HTTP 200 avec du HTML, et ces octets seraient
 * lus comme des bâtiments. La tuile porte aussi son niveau, sa colonne et sa ligne, et le
 * décodeur les CONFRONTE à ce qui était demandé.
 */

/** Marque de tête des tuiles de bâtiments. */
export const BUILDING_TILE_MAGIC = 'GXBD';
/** Version de format que ce décodeur sait lire. */
export const BUILDING_TILE_VERSION = 1;

/** Taille de l'en-tête en octets. */
const HEADER_BYTES = 24;

/**
 * D'où vient la hauteur d'un bâtiment. Une VALEUR, jamais un adjectif : la légende en tire la part
 * de chaque origine. `unspecified` existe pour une méthode que la source nomme sans qu'on sache la
 * classer : ne pas la ranger sous « mesurée » par commodité.
 */
export const HEIGHT_ORIGIN = {
  absent: 0,
  measured: 1,
  interpolated: 2,
  derivedFromFloors: 3,
  unspecified: 4,
} as const;
export type HeightOrigin = (typeof HEIGHT_ORIGIN)[keyof typeof HEIGHT_ORIGIN];
const MAX_HEIGHT_ORIGIN = 4;

/** Plus grande hauteur représentable, en décimètres (uint16). */
export const MAX_HEIGHT_DECIMETRES = 65535;

/**
 * Marge de la tuile de chaque côté, en part de sa largeur : un bâtiment est rangé dans la tuile de
 * son centre et peut déborder sur la voisine. Les coordonnées couvrent donc `1 + 2 × marge` fois
 * la tuile sur 0..65535.
 */
export const TILE_MARGIN = 0.125;
const COORD_MAX = 65535;

/** Un bâtiment décodé : emprise extérieure en coordonnées de tuile (0..65535), hauteur, origine. */
export interface BuildingFootprint {
  /** Sommets `x0, y0, x1, y1, …`, sans point de fermeture. */
  ring: Uint16Array;
  /** Hauteur en décimètres (0 quand l'origine est `absent`). */
  heightDecimetres: number;
  origin: HeightOrigin;
}

export interface BuildingTileIdentity {
  zoom: number;
  column: number;
  row: number;
}

export interface BuildingTile extends BuildingTileIdentity {
  buildings: BuildingFootprint[];
}

// ---------------------------------------------------------------------------------------------
// Géométrie de la tuile (Web Mercator, schéma XYZ : la ligne 0 est au nord)
// ---------------------------------------------------------------------------------------------

const MAX_LATITUDE = 85.0511287798066;

/** Longitude (°) → abscisse de la tuile, fractionnaire, au niveau `zoom`. */
export function lonToTileX(lonDeg: number, zoom: number): number {
  return ((lonDeg + 180) / 360) * 2 ** zoom;
}

/** Latitude (°) → ordonnée de la tuile, fractionnaire, au niveau `zoom` (0 au nord). */
export function latToTileY(latDeg: number, zoom: number): number {
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latDeg));
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    2 ** zoom
  );
}

/** Tuile entière qui contient ce point. */
export function tileOfLonLat(
  lonDeg: number,
  latDeg: number,
  zoom: number
): BuildingTileIdentity {
  const n = 2 ** zoom;
  const column = Math.min(
    n - 1,
    Math.max(0, Math.floor(lonToTileX(lonDeg, zoom)))
  );
  const row = Math.min(
    n - 1,
    Math.max(0, Math.floor(latToTileY(latDeg, zoom)))
  );
  return { zoom, column, row };
}

/** Longitude / latitude (°) → coordonnées 0..65535 de la tuile, bornées. */
export function quantizeToTile(
  lonDeg: number,
  latDeg: number,
  tile: BuildingTileIdentity
): [number, number] {
  const span = 1 + 2 * TILE_MARGIN;
  const fx = (lonToTileX(lonDeg, tile.zoom) - tile.column + TILE_MARGIN) / span;
  const fy = (latToTileY(latDeg, tile.zoom) - tile.row + TILE_MARGIN) / span;
  return [
    Math.max(0, Math.min(COORD_MAX, Math.round(fx * COORD_MAX))),
    Math.max(0, Math.min(COORD_MAX, Math.round(fy * COORD_MAX))),
  ];
}

/** Coordonnées 0..65535 de la tuile → longitude / latitude (°). Inverse de `quantizeToTile`. */
export function dequantizeFromTile(
  qx: number,
  qy: number,
  tile: BuildingTileIdentity
): [number, number] {
  const span = 1 + 2 * TILE_MARGIN;
  const tx = (qx / COORD_MAX) * span - TILE_MARGIN + tile.column;
  const ty = (qy / COORD_MAX) * span - TILE_MARGIN + tile.row;
  const n = 2 ** tile.zoom;
  const lon = (tx / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [lon, lat];
}

// ---------------------------------------------------------------------------------------------
// Encodage
// ---------------------------------------------------------------------------------------------

/**
 * Encode une tuile. Refuse ce que le format ne sait pas dire (hauteur hors de l'uint16, anneau de
 * moins de trois sommets, origine inconnue) plutôt que de le tronquer en silence.
 */
export function encodeBuildingTile(tile: BuildingTile): ArrayBuffer {
  const count = tile.buildings.length;
  let vertices = 0;
  for (const b of tile.buildings) {
    if (b.ring.length % 2 !== 0 || b.ring.length < 6)
      throw new Error('anneau de moins de trois sommets');
    if (
      !Number.isInteger(b.heightDecimetres) ||
      b.heightDecimetres < 0 ||
      b.heightDecimetres > MAX_HEIGHT_DECIMETRES
    )
      throw new Error(`hauteur hors limites (${b.heightDecimetres} dm)`);
    if (
      !Number.isInteger(b.origin) ||
      b.origin < 0 ||
      b.origin > MAX_HEIGHT_ORIGIN
    )
      throw new Error(`origine de hauteur inconnue (${b.origin})`);
    vertices += b.ring.length / 2;
  }
  // En-tête, hauteurs (u16), origines (u8), départs d'anneaux (u32 × (n + 1)), sommets (u16 × 2).
  const bytes =
    HEADER_BYTES + count * 2 + count + (count + 1) * 4 + vertices * 4;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  for (let i = 0; i < 4; i++)
    view.setUint8(i, BUILDING_TILE_MAGIC.charCodeAt(i));
  view.setUint16(4, BUILDING_TILE_VERSION, true);
  view.setUint8(6, tile.zoom);
  view.setUint8(7, 0);
  view.setUint32(8, tile.column, true);
  view.setUint32(12, tile.row, true);
  view.setUint32(16, count, true);
  view.setUint32(20, vertices, true);
  let heightsAt = HEADER_BYTES;
  let originsAt = heightsAt + count * 2;
  let startsAt = originsAt + count;
  let vertsAt = startsAt + (count + 1) * 4;
  let vertexIndex = 0;
  for (const b of tile.buildings) {
    view.setUint16(heightsAt, b.heightDecimetres, true);
    heightsAt += 2;
    view.setUint8(originsAt, b.origin);
    originsAt += 1;
    view.setUint32(startsAt, vertexIndex, true);
    startsAt += 4;
    for (let k = 0; k < b.ring.length; k++) {
      view.setUint16(vertsAt, b.ring[k], true);
      vertsAt += 2;
    }
    vertexIndex += b.ring.length / 2;
  }
  view.setUint32(startsAt, vertexIndex, true);
  return buffer;
}

// ---------------------------------------------------------------------------------------------
// Décodage
// ---------------------------------------------------------------------------------------------

/**
 * Décode une tuile, ou explique en une phrase pourquoi elle est refusée. `expected` est l'identité
 * demandée : la fournir transforme une erreur d'adressage silencieuse en refus explicite.
 */
export function decodeBuildingTile(
  buffer: ArrayBuffer,
  expected?: BuildingTileIdentity
): BuildingTile {
  if (buffer.byteLength < HEADER_BYTES)
    throw new Error(
      `tuile de bâtiments tronquée (${buffer.byteLength} octets)`
    );
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== BUILDING_TILE_MAGIC)
    throw new Error(
      `ce n'est pas une tuile de bâtiments (marque « ${magic.replace(/[^\x20-\x7e]/g, '?')} »)`
    );
  const version = view.getUint16(4, true);
  if (version !== BUILDING_TILE_VERSION)
    throw new Error(
      `version de tuile de bâtiments non prise en charge (${version})`
    );
  const zoom = view.getUint8(6);
  const column = view.getUint32(8, true);
  const row = view.getUint32(12, true);
  if (
    expected &&
    (expected.zoom !== zoom ||
      expected.column !== column ||
      expected.row !== row)
  )
    throw new Error(
      `tuile de bâtiments d'un autre endroit (reçu ${zoom}/${column}/${row}, demandé ${expected.zoom}/${expected.column}/${expected.row})`
    );
  const count = view.getUint32(16, true);
  const vertices = view.getUint32(20, true);
  const expectedBytes =
    HEADER_BYTES + count * 2 + count + (count + 1) * 4 + vertices * 4;
  if (buffer.byteLength !== expectedBytes)
    throw new Error(
      `tuile de bâtiments de taille incohérente (${buffer.byteLength} octets, ${expectedBytes} attendus)`
    );
  let heightsAt = HEADER_BYTES;
  const originsAt = heightsAt + count * 2;
  const startsAt = originsAt + count;
  const vertsAt = startsAt + (count + 1) * 4;
  const buildings: BuildingFootprint[] = [];
  let previous = view.getUint32(startsAt, true);
  if (previous !== 0)
    throw new Error("départs d'anneaux incohérents (le premier n'est pas 0)");
  for (let i = 0; i < count; i++) {
    const end = view.getUint32(startsAt + (i + 1) * 4, true);
    if (end - previous < 3 || end > vertices)
      throw new Error(`départs d'anneaux incohérents (bâtiment ${i})`);
    const origin = view.getUint8(originsAt + i);
    if (origin > MAX_HEIGHT_ORIGIN)
      throw new Error(`origine de hauteur inconnue (${origin}, bâtiment ${i})`);
    const ring = new Uint16Array((end - previous) * 2);
    for (let k = 0; k < ring.length; k++)
      ring[k] = view.getUint16(vertsAt + previous * 4 + k * 2, true);
    buildings.push({
      ring,
      heightDecimetres: view.getUint16(heightsAt, true),
      origin: origin as HeightOrigin,
    });
    heightsAt += 2;
    previous = end;
  }
  if (previous !== vertices)
    throw new Error(
      "départs d'anneaux incohérents (le dernier n'atteint pas le total)"
    );
  return { zoom, column, row, buildings };
}
