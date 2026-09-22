/**
 * DÉCODAGE D'UNE TUILE DE HAUTEURS — module pur, testé, sans réseau et sans Three.js
 * (lot 9, phase 9D).
 *
 * Ces tuiles ne viennent d'aucun service : elles sont cuites hors ligne par
 * `scripts/bake-surface-height-tiles.mjs` (`pnpm surface:tiles`) depuis un modèle d'élévation
 * PUBLIÉ, parce qu'aucune source de hauteurs tuilée n'est servie en CORS — la seule couche de
 * NASA Trek qui s'appelle « DEM » est une image 8 bits, donc environ 78 m par pas sur la Lune.
 *
 * Le fichier PORTE son quantum et son offset : un décodeur n'a rien à deviner, et une
 * recuisson avec un autre pas ne demande aucune modification de code. Il porte aussi son
 * niveau, sa ligne et sa colonne, et le décodeur les CONFRONTE à ce qui était demandé, comme
 * le générateur d'éphémérides confronte le `Target body name:` d'Horizons : une tuile juste au
 * mauvais endroit est un relief faux que rien ne signale.
 *
 * La marque de tête n'est pas décorative : `firebase.json` réécrit toute adresse inconnue vers
 * `/index.html`, donc un fichier absent revient en **HTTP 200 avec une page HTML**. Sans elle,
 * ces octets seraient lus comme des altitudes.
 */

/** Marque de tête des tuiles produites par le cuiseur. */
export const HEIGHT_TILE_MAGIC = 'GXHT';
/** Version de format que ce décodeur sait lire. */
export const HEIGHT_TILE_VERSION = 1;

/** Une tuile de hauteurs décodée. Les valeurs sont des entiers, en pas de `quantumMetres`. */
export interface HeightTile {
  level: number;
  row: number;
  column: number;
  /** Échantillons par côté : registre GRILLE, donc un sommet exactement sur chaque bord. */
  samples: number;
  quantumMetres: number;
  offsetMetres: number;
  values: Int16Array;
}

/** Position d'une tuile dans la pyramide, pour la confrontation à l'en-tête. */
export interface HeightTileIdentity {
  level: number;
  row: number;
  column: number;
}

/**
 * Décode une tuile, ou explique en une phrase pourquoi elle est refusée.
 *
 * `expected` est l'identité demandée : la fournir transforme une erreur d'adressage silencieuse
 * en refus explicite.
 */
export function decodeHeightTile(
  buffer: ArrayBuffer,
  expected?: HeightTileIdentity
): HeightTile {
  if (buffer.byteLength < 8)
    throw new Error(`tuile de hauteurs tronquée (${buffer.byteLength} octets)`);
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== HEIGHT_TILE_MAGIC)
    throw new Error(
      `tuile de hauteurs : marque « ${magic} » au lieu de « ${HEIGHT_TILE_MAGIC} » ` +
        `(une adresse inconnue revient en HTML, pas en erreur)`
    );
  const version = view.getUint16(4, true);
  if (version !== HEIGHT_TILE_VERSION)
    throw new Error(
      `tuile de hauteurs : format version ${version}, attendu ${HEIGHT_TILE_VERSION}`
    );
  const headerBytes = view.getUint16(6, true);
  const tile: HeightTile = {
    level: view.getUint16(8, true),
    row: view.getUint16(10, true),
    column: view.getUint16(12, true),
    samples: view.getUint16(14, true),
    quantumMetres: view.getFloat64(16, true),
    offsetMetres: view.getFloat64(24, true),
    values: new Int16Array(0),
  };
  if (tile.samples < 2)
    throw new Error(
      `tuile de hauteurs : ${tile.samples} échantillon(s) par côté`
    );
  if (!(tile.quantumMetres > 0))
    throw new Error(
      `tuile de hauteurs : quantum ${tile.quantumMetres} m, il doit être positif`
    );
  const count = tile.samples * tile.samples;
  if (buffer.byteLength !== headerBytes + count * 2)
    throw new Error(
      `tuile de hauteurs : ${buffer.byteLength} octets pour ${tile.samples}² échantillons ` +
        `et ${headerBytes} d'en-tête`
    );
  if (
    expected &&
    (expected.level !== tile.level ||
      expected.row !== tile.row ||
      expected.column !== tile.column)
  )
    throw new Error(
      `tuile de hauteurs ${tile.level}/${tile.row}/${tile.column} reçue pour ` +
        `${expected.level}/${expected.row}/${expected.column} demandée`
    );
  tile.values = new Int16Array(buffer, headerBytes, count);
  return tile;
}

/**
 * Altitude, en mètres, d'un échantillon de la tuile. `x` croît vers l'est, `y` vers le SUD
 * (ligne 0 au nord) : la convention de la pyramide, celle de WMTS et celle d'une image
 * équirectangulaire, déclarée une fois dans `core/tilePyramid.ts`.
 */
export function heightMetresAt(tile: HeightTile, x: number, y: number): number {
  const column = Math.min(tile.samples - 1, Math.max(0, x));
  const row = Math.min(tile.samples - 1, Math.max(0, y));
  return (
    tile.offsetMetres +
    tile.values[row * tile.samples + column]! * tile.quantumMetres
  );
}
