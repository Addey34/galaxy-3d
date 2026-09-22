#!/usr/bin/env node
/* global console, process, fetch, Buffer */
/**
 * CUISEUR DE TUILES DE HAUTEURS — `pnpm surface:tiles` (lot 9, phase 9D).
 *
 * Il lit un modèle numérique d'élévation PUBLIÉ (PDS3 : une étiquette `.lbl` et un tableau brut
 * `.img`) et en écrit des tuiles de hauteurs 16 bits dans la MÊME pyramide équirectangulaire que
 * l'imagerie (`src/core/tilePyramid.ts`). Rien n'est cuit à la construction du site : ces fichiers
 * sont produits ici, une fois, et commités.
 *
 * POURQUOI un cuiseur hors ligne, et pas des tuiles distantes comme pour l'imagerie : la seule
 * couche de NASA Trek qui s'appelle « DEM » est une IMAGE 8 bits (en-tête PNG `bitDepth 8`,
 * `colorType 4`, une trentaine de gris distincts par tuile, alpha constant), donc environ 78 m par
 * pas sur la Lune. L'employer comme géométrie terrasserait le corps. Mesure refaite le 2026-09-21,
 * inchangée depuis le 2026-09-20 : c'est le piège 1 du plan du lot.
 *
 * TROIS RÈGLES QUE CE SCRIPT NE DOIT JAMAIS ENFREINDRE :
 *

 *  1. **le quantum vient de l'étiquette**, jamais d'une constante écrite ici : `SCALING_FACTOR`
 *     est lu puis RÉÉCRIT dans l'en-tête de chaque tuile produite, avec l'offset de nos tuiles
 *     (nul : elles portent des altitudes rapportées au rayon de référence). Ce rayon, l'étiquette
 *     le donne deux fois (`OFFSET` en mètres, `A_AXIS_RADIUS` en kilomètres) : les deux sont lus
 *     et confrontés, et c'est le second que le manifeste déclare. Un décodeur ne devine rien ;
 *  2. **la géométrie de la source est vérifiée, pas supposée** : le nombre de lignes et de
 *     colonnes doit concorder avec l'emprise et la résolution déclarées, sinon on s'arrête. Une
 *     source qui change de découpage ne doit pas produire un relief silencieusement décalé ;
 *  3. **aucun détail inventé** : le rééchantillonnage est bilinéaire (la source est à registre
 *     PIXEL, nos tuiles à registre GRILLE), et rien n'est ajouté entre deux échantillons.
 *
 * Sortie : `<output>/<hachage>/<niveau>/<ligne>/<colonne>.hgt` plus `<output>/manifest.json`.
 * Le répertoire porte le hachage du contenu — même raison que les binaires d'éphémérides, dont le
 * nom porte déjà une empreinte : les octets d'une adresse ne changent jamais, donc le cache d'un an
 * de `/assets/**` est JUSTE pour eux, et une nouvelle cuisson produit de nouvelles adresses. Seul
 * `manifest.json` a un nom stable, et il reçoit sa règle de revalidation dans `firebase.json`.
 *
 * Options : `--only <id>`, `--dry-run` (ne rien écrire), `--cache <répertoire>`.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = join(ROOT, 'scripts', 'surface-height-targets.json');

/** Échantillons par côté d'une tuile : 256 intervalles, donc 257 sommets (registre GRILLE). */
const TILE_SAMPLES = 257;
/** Octets d'en-tête d'une tuile. Doit rester pair : les hauteurs sont des entiers 16 bits. */
const HEADER_BYTES = 32;
/** Version du format, relue et vérifiée par `src/core/heightTile.ts`. */
const FORMAT_VERSION = 1;
/** Marque de format : un fichier absent renvoie la page SPA en 200, et elle ne commence pas par ça. */
const MAGIC = 'GXHT';

// ── Étiquette PDS3 ────────────────────────────────────────────────────────────────────────────

/**
 * Lit les champs dont le cuiseur a besoin dans une étiquette PDS3, puis VÉRIFIE que la grille
 * décrite est cohérente avec son emprise. Les deux étiquettes LOLA employées ici (globale à
 * 64 px/degré, régionale à 1024) ont la même forme, et c'est cette forme qui est vérifiée.
 */
function parseLabel(text, source) {
  const field = (name) => {
    const match = new RegExp(`^\\s*${name}\\s*=\\s*([^\\r\\n]+)`, 'm').exec(
      text
    );
    if (!match) throw new Error(`${source} : champ ${name} absent`);
    return match[1]
      .trim()
      .replace(/<[^>]*>\s*$/, '')
      .trim();
  };
  const number = (name) => {
    const raw = field(name).replace(/"/g, '');
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value))
      throw new Error(`${source} : ${name} illisible (« ${raw} »)`);
    return value;
  };

  const label = {
    productId: field('PRODUCT_ID').replace(/"/g, ''),
    instrument: field('INSTRUMENT_NAME').replace(/"/g, ''),
    mission: field('INSTRUMENT_HOST_NAME').replace(/"/g, ''),
    startTime: field('START_TIME').replace(/"/g, ''),
    stopTime: field('STOP_TIME').replace(/"/g, ''),
    coordinateSystem: field('COORDINATE_SYSTEM_NAME').replace(/"/g, ''),
    lines: number('LINES'),
    lineSamples: number('LINE_SAMPLES'),
    sampleType: field('SAMPLE_TYPE'),
    sampleBits: number('SAMPLE_BITS'),
    quantumMetres: number('SCALING_FACTOR'),
    offsetMetres: number('OFFSET'),
    pixelsPerDegree: number('MAP_RESOLUTION'),
    radiusKm: number('A_AXIS_RADIUS'),
    northDeg: number('MAXIMUM_LATITUDE'),
    southDeg: number('MINIMUM_LATITUDE'),
    westDeg: number('WESTERNMOST_LONGITUDE'),
    eastDeg: number('EASTERNMOST_LONGITUDE'),
  };

  if (label.sampleType !== 'LSB_INTEGER' || label.sampleBits !== 16)
    throw new Error(
      `${source} : échantillons ${label.sampleType}/${label.sampleBits} bits, attendu LSB_INTEGER/16`
    );
  // L'étiquette donne DEUX fois le rayon de référence : `OFFSET` (en mètres, le rayon auquel les
  // hauteurs sont rapportées) et `A_AXIS_RADIUS` (en kilomètres). Nos tuiles portent des
  // altitudes rapportées à ce rayon, donc un offset nul, et le manifeste déclare le rayon. Les
  // deux champs doivent concorder : s'ils divergeaient, le relief serait décalé de leur écart.
  if (Math.abs(label.offsetMetres / 1000 - label.radiusKm) > 1e-6)
    throw new Error(
      `${source} : OFFSET ${label.offsetMetres} m et A_AXIS_RADIUS ${label.radiusKm} km ne concordent pas`
    );
  const expectedLines = Math.round(
    (label.northDeg - label.southDeg) * label.pixelsPerDegree
  );
  const expectedSamples = Math.round(
    (label.eastDeg - label.westDeg) * label.pixelsPerDegree
  );
  if (label.lines !== expectedLines || label.lineSamples !== expectedSamples)
    throw new Error(
      `${source} : grille ${label.lineSamples} x ${label.lines} incohérente avec ` +
        `${label.eastDeg - label.westDeg}° x ${label.northDeg - label.southDeg}° ` +
        `à ${label.pixelsPerDegree} px/degré (attendu ${expectedSamples} x ${expectedLines})`
    );
  return label;
}

// ── Accès aux échantillons de la source ──────────────────────────────────────────────────────

/**
 * Une grille PDS chargée en mémoire, ou une FENÊTRE de grille tirée par requêtes de plage.
 *
 * Le registre est PIXEL (le centre du premier échantillon est à un demi-pas du bord déclaré),
 * celui de nos tuiles est GRILLE (un sommet exactement sur chaque bord), d'où l'interpolation.
 * La longitude s'enroule seulement si la grille fait bien 360° : sur une fenêtre régionale, sortir
 * de l'emprise est une erreur, pas un repli silencieux sur l'autre bord.
 */
class DemGrid {
  /**
   * `samples` reste en entiers BRUTS (comme la source) et la conversion en mètres se fait à la
   * lecture : convertir la grille globale d'avance coûterait un gigaoctet de mémoire pour rien.
   */
  constructor(label, samples, window) {
    this.label = label;
    this.samples = samples;
    this.scale = label.quantumMetres;
    // Fenêtre lue : origine (en échantillons de la grille complète) et dimensions.
    this.window = window ?? {
      column: 0,
      row: 0,
      columns: label.lineSamples,
      rows: label.lines,
    };
    this.wrapsLongitude =
      Math.abs(label.eastDeg - label.westDeg - 360) < 1e-9 &&
      this.window.columns === label.lineSamples;
  }

  /** Hauteur en mètres d'un échantillon de la grille complète, bornée à la fenêtre lue. */
  rawAt(column, row) {
    const { label, window } = this;
    let c = column;
    if (this.wrapsLongitude)
      c = ((c % label.lineSamples) + label.lineSamples) % label.lineSamples;
    const localColumn = c - window.column;
    const localRow = row - window.row;
    if (
      localColumn < 0 ||
      localColumn >= window.columns ||
      localRow < 0 ||
      localRow >= window.rows
    ) {
      const clampedColumn = Math.min(
        window.columns - 1,
        Math.max(0, localColumn)
      );
      const clampedRow = Math.min(window.rows - 1, Math.max(0, localRow));
      // Hors fenêtre : on borne. Le cuiseur lit toujours une marge d'un échantillon autour de
      // ce dont il a besoin, donc ce cas ne se produit qu'aux bords réels de la source.
      return (
        this.samples[clampedRow * window.columns + clampedColumn] * this.scale
      );
    }
    return this.samples[localRow * window.columns + localColumn] * this.scale;
  }

  /** Hauteur en mètres à une position géographique, par interpolation bilinéaire. */
  elevationAt(latitudeDeg, longitudeDeg) {
    const { label } = this;
    const ppd = label.pixelsPerDegree;
    let lon = longitudeDeg;
    // L'emprise d'une étiquette LOLA est exprimée en longitude EST croissante (0 à 360 pour la
    // grille globale, 330 à 360 pour une région) : on ramène la longitude dans cette convention.
    while (lon < label.westDeg) lon += 360;
    while (lon >= label.westDeg + 360) lon -= 360;
    const x = (lon - label.westDeg) * ppd - 0.5;
    const y = (label.northDeg - latitudeDeg) * ppd - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const a = this.rawAt(x0, y0);
    const b = this.rawAt(x0 + 1, y0);
    const c = this.rawAt(x0, y0 + 1);
    const d = this.rawAt(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  /** Moyenne d'une ligne entière de la grille, en mètres : la valeur d'un pôle. */
  rowMean(row) {
    let total = 0;
    for (let column = 0; column < this.window.columns; column += 1)
      total +=
        this.samples[(row - this.window.row) * this.window.columns + column];
    return (total / this.window.columns) * this.scale;
  }
}

// ── Lecture des sources (cache local, requêtes de plage) ─────────────────────────────────────

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
  return response.text();
}

/** Télécharge (ou relit du cache) un fichier entier. */
async function cachedFile(url, cacheDir) {
  const name = url.split('/').pop();
  const path = join(cacheDir, name);
  if (existsSync(path)) return readFileSync(path);
  process.stdout.write(`  téléchargement ${name}…\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path, bytes);
  return bytes;
}

/**
 * Lit une FENÊTRE rectangulaire d'une grille distante par requêtes de plage multiples.
 *
 * Un fichier régional LOLA pèse 944 Mo pour 15° x 30° ; une aire nommée en occupe quelques
 * millièmes. Le serveur PDS annonce `Accept-Ranges: bytes` et répond en `multipart/byteranges`,
 * ce qui permet de ne lire QUE les tronçons de ligne utiles (mesuré le 2026-09-21).
 */
async function fetchWindow(url, label, window, cacheDir, cacheKey) {
  const path = join(cacheDir, `${cacheKey}.bin`);
  if (existsSync(path))
    return new Int16Array(
      readFileSync(path).buffer.slice(0, window.columns * window.rows * 2)
    );

  const bytesPerSample = 2;
  const rowBytes = label.lineSamples * bytesPerSample;
  const out = new Int16Array(window.columns * window.rows);
  const BATCH = 64;
  for (let first = 0; first < window.rows; first += BATCH) {
    const rows = Math.min(BATCH, window.rows - first);
    const ranges = [];
    for (let k = 0; k < rows; k += 1) {
      const start =
        (window.row + first + k) * rowBytes + window.column * bytesPerSample;
      ranges.push(`${start}-${start + window.columns * bytesPerSample - 1}`);
    }
    const response = await fetch(url, {
      headers: { Range: `bytes=${ranges.join(', ')}` },
    });
    if (response.status !== 206)
      throw new Error(
        `${url} : requête de plage refusée (HTTP ${response.status})`
      );
    const body = Buffer.from(await response.arrayBuffer());
    const parts = splitByteRanges(body, response.headers.get('content-type'));
    if (parts.length !== rows)
      throw new Error(
        `${url} : ${parts.length} tronçons reçus pour ${rows} demandés`
      );
    for (let k = 0; k < rows; k += 1) {
      const part = parts[k];
      if (part.length !== window.columns * bytesPerSample)
        throw new Error(`${url} : tronçon de ${part.length} octets inattendu`);
      for (let i = 0; i < window.columns; i += 1)
        out[(first + k) * window.columns + i] = part.readInt16LE(i * 2);
    }
    process.stdout.write(
      `  \r  fenêtre ${Math.min(first + rows, window.rows)}/${window.rows} lignes`
    );
  }
  process.stdout.write('\n');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path, Buffer.from(out.buffer));
  return out;
}

/** Découpe une réponse `multipart/byteranges` en ses tronçons, dans l'ordre demandé. */
function splitByteRanges(body, contentType) {
  const boundary = /boundary=(.+)$/.exec(contentType ?? '')?.[1];
  if (!boundary) return [body];
  const marker = Buffer.from(`--${boundary}`);
  const parts = [];
  let index = body.indexOf(marker);
  while (index >= 0) {
    const headerEnd = body.indexOf('\r\n\r\n', index);
    if (headerEnd < 0) break;
    const next = body.indexOf(marker, headerEnd);
    const end = next < 0 ? body.length : next - 2;
    parts.push(body.subarray(headerEnd + 4, end));
    if (next < 0) break;
    if (
      body
        .subarray(next + marker.length, next + marker.length + 2)
        .toString() === '--'
    )
      break;
    index = next;
  }
  return parts;
}

// ── Cuisson d'une tuile ──────────────────────────────────────────────────────────────────────

function tileBounds(level, row, column) {
  const columns = 2 * 2 ** level;
  const rows = 2 ** level;
  const lonStep = 360 / columns;
  const latStep = 180 / rows;
  const west = -180 + column * lonStep;
  const north = 90 - row * latStep;
  return { west, east: west + lonStep, north, south: north - latStep };
}

/**
 * Cuit une tuile : `TILE_SAMPLES` sommets par côté, du nord-ouest au sud-est, en entiers signés
 * de `quantum` mètres.
 *
 * `poles` porte la hauteur du pôle nord et celle du pôle sud, calculées UNE fois sur la grille
 * entière. Sans cela, chaque tuile polaire donnerait à son sommet dégénéré la moyenne de sa seule
 * portion de longitude, et le pôle deviendrait une étoile à autant de branches qu'il y a de
 * colonnes (piège 4 du plan).
 */
function bakeTile(grid, level, row, column, quantum, poles) {
  const bounds = tileBounds(level, row, column);
  const values = new Int16Array(TILE_SAMPLES * TILE_SAMPLES);
  const latSpan = bounds.north - bounds.south;
  const lonSpan = bounds.east - bounds.west;
  for (let j = 0; j < TILE_SAMPLES; j += 1) {
    const latitude = bounds.north - (latSpan * j) / (TILE_SAMPLES - 1);
    const polar =
      latitude >= 90 ? poles.north : latitude <= -90 ? poles.south : null;
    for (let i = 0; i < TILE_SAMPLES; i += 1) {
      const longitude = bounds.west + (lonSpan * i) / (TILE_SAMPLES - 1);
      const metres = polar ?? grid.elevationAt(latitude, longitude);
      const dn = Math.round(metres / quantum);
      if (dn < -32768 || dn > 32767)
        throw new Error(
          `hauteur ${metres.toFixed(1)} m hors des 16 bits au quantum ${quantum} m`
        );
      values[j * TILE_SAMPLES + i] = dn;
    }
  }
  return values;
}

function encodeTile(level, row, column, values, quantum, offset) {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write(MAGIC, 0, 'latin1');
  header.writeUInt16LE(FORMAT_VERSION, 4);
  header.writeUInt16LE(HEADER_BYTES, 6);
  header.writeUInt16LE(level, 8);
  header.writeUInt16LE(row, 10);
  header.writeUInt16LE(column, 12);
  header.writeUInt16LE(TILE_SAMPLES, 14);
  header.writeDoubleLE(quantum, 16);
  header.writeDoubleLE(offset, 24);
  return Buffer.concat([
    header,
    Buffer.from(values.buffer, values.byteOffset, values.byteLength),
  ]);
}

// ── Choix des tuiles ─────────────────────────────────────────────────────────────────────────

/**
 * Emprise cuite autour d'une aire nommée, en degrés.
 *
 * Elle DÉRIVE du diamètre publié par le répertoire de nomenclature de l'UAI, avec une marge d'un
 * quart, un plancher (un point de mission n'a pas de diamètre) et un plafond (au-delà, une aire
 * coûterait plus que le socle entier).
 *
 * Le demi-côté en LONGITUDE est divisé par le cosinus de la latitude : un degré de longitude
 * couvre moins de sol en s'éloignant de l'équateur, et un carré en degrés laisserait les
 * remparts est et ouest de Tycho (43° sud) HORS de l'aire, c'est-à-dire exactement le morceau
 * qu'on vient y chercher.
 */
function areaSpanDeg(diameterKm, radiusKm, latitudeDeg) {
  const kmPerDegree = (2 * Math.PI * radiusKm) / 360;
  const half = ((diameterKm / 2) * 1.25) / kmPerDegree;
  const latitude = Math.min(2, Math.max(0.5, half));
  const cos = Math.max(0.2, Math.cos((latitudeDeg * Math.PI) / 180));
  return { latitude, longitude: Math.min(3, latitude / cos) };
}

function tilesForBox(level, box) {
  const columns = 2 * 2 ** level;
  const rows = 2 ** level;
  const lonStep = 360 / columns;
  const latStep = 180 / rows;
  const first = {
    column: Math.floor((box.west + 180) / lonStep),
    row: Math.floor((90 - box.north) / latStep),
  };
  const last = {
    column: Math.ceil((box.east + 180) / lonStep) - 1,
    row: Math.ceil((90 - box.south) / latStep) - 1,
  };
  const tiles = [];
  for (
    let row = Math.max(0, first.row);
    row <= Math.min(rows - 1, last.row);
    row += 1
  )
    for (let column = first.column; column <= last.column; column += 1)
      tiles.push({
        level,
        row,
        column: ((column % columns) + columns) % columns,
      });
  return tiles;
}

// ── Programme ────────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only')
    ? args[args.indexOf('--only') + 1]
    : null;
  const dryRun = args.includes('--dry-run');
  const cacheDir = args.includes('--cache')
    ? resolve(args[args.indexOf('--cache') + 1])
    : join(ROOT, '.cache', 'surface-heights');

  const targets = JSON.parse(readFileSync(TARGETS, 'utf8'));
  for (const set of targets.sets) {
    if (only && set.id !== only) continue;
    await bakeSet(set, { cacheDir, dryRun });
  }
}

async function bakeSet(set, { cacheDir, dryRun }) {
  console.log(`\n=== ${set.id} (${set.body}) ===`);
  const baseLabel = parseLabel(
    await fetchText(set.base.label),
    set.base.label.split('/').pop()
  );
  console.log(
    `source ${baseLabel.productId} : ${baseLabel.lineSamples} x ${baseLabel.lines} ` +
      `à ${baseLabel.pixelsPerDegree} px/degré, quantum ${baseLabel.quantumMetres} m, ` +
      `rayon de référence ${baseLabel.radiusKm} km`
  );
  const bytes = await cachedFile(set.base.image, cacheDir);
  const expected = baseLabel.lines * baseLabel.lineSamples * 2;
  if (bytes.length !== expected)
    throw new Error(
      `${set.base.image} : ${bytes.length} octets, attendu ${expected}`
    );
  if (bytes.byteOffset % 2 !== 0)
    throw new Error(
      'tampon désaligné : impossible de lire des entiers 16 bits'
    );
  const samples = new Int16Array(
    bytes.buffer,
    bytes.byteOffset,
    baseLabel.lines * baseLabel.lineSamples
  );
  const baseGrid = new DemGrid(baseLabel, samples);
  const poles = {
    north: baseGrid.rowMean(0),
    south: baseGrid.rowMean(baseLabel.lines - 1),
  };
  console.log(
    `pôles (moyenne de la ligne extrême) : nord ${poles.north.toFixed(1)} m, ` +
      `sud ${poles.south.toFixed(1)} m`
  );

  const quantum = baseLabel.quantumMetres;
  const entries = [];
  const coverage = [];
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;

  const emit = (level, row, column, values) => {
    for (const dn of values) {
      const m = dn * quantum;
      if (m < minElevation) minElevation = m;
      if (m > maxElevation) maxElevation = m;
    }
    entries.push({
      level,
      row,
      column,
      bytes: encodeTile(level, row, column, values, quantum, 0),
    });
  };

  // Socle global.
  const baseTiles = tilesForBox(set.base.level, {
    west: -180,
    east: 180,
    north: 90,
    south: -90,
  });
  console.log(`socle niveau ${set.base.level} : ${baseTiles.length} tuiles`);
  for (const tile of baseTiles)
    emit(
      tile.level,
      tile.row,
      tile.column,
      bakeTile(baseGrid, tile.level, tile.row, tile.column, quantum, poles)
    );
  coverage.push({
    level: set.base.level,
    global: true,
    sourcePixelsPerDegree: baseLabel.pixelsPerDegree,
    sourceProductId: baseLabel.productId,
  });

  // Aires nommées.
  for (const area of set.areas ?? []) {
    const label = parseLabel(
      await fetchText(area.label),
      area.label.split('/').pop()
    );
    const span = areaSpanDeg(
      area.diameterKm,
      baseLabel.radiusKm,
      area.centre.latitudeDeg
    );
    // L'emprise est bornée par celle de la source : le rempart sud de Tycho touche la limite du
    // fichier régional (45° sud), et déborder rendrait des hauteurs recopiées du dernier
    // échantillon sans que rien ne le dise.
    const box = {
      west: Math.max(
        normaliseEast(label.westDeg, -180),
        area.centre.longitudeDeg - span.longitude
      ),
      east: Math.min(
        normaliseEast(label.eastDeg, -180 + 1e-9),
        area.centre.longitudeDeg + span.longitude
      ),
      north: Math.min(label.northDeg, area.centre.latitudeDeg + span.latitude),
      south: Math.max(label.southDeg, area.centre.latitudeDeg - span.latitude),
    };
    const tiles = area.levels.flatMap((level) => tilesForBox(level, box));
    // Emprise RÉELLE : celle des tuiles cuites, pas celle du carré demandé. C'est elle que
    // l'application consultera pour savoir si une tuile d'imagerie est couverte.
    const finest = Math.max(...area.levels);
    const finestTiles = tilesForBox(finest, box);
    const bounds = finestTiles.reduce(
      (acc, tile) => {
        const b = tileBounds(tile.level, tile.row, tile.column);
        return {
          west: Math.min(acc.west, b.west),
          east: Math.max(acc.east, b.east),
          south: Math.min(acc.south, b.south),
          north: Math.max(acc.north, b.north),
        };
      },
      {
        west: Number.POSITIVE_INFINITY,
        east: Number.NEGATIVE_INFINITY,
        south: Number.POSITIVE_INFINITY,
        north: Number.NEGATIVE_INFINITY,
      }
    );
    console.log(
      `aire ${area.id} (${area.name}) : ${tiles.length} tuiles, ` +
        `emprise ${bounds.west.toFixed(3)}…${bounds.east.toFixed(3)}° x ` +
        `${bounds.south.toFixed(3)}…${bounds.north.toFixed(3)}°, source ${label.productId}`
    );

    // Fenêtre de source à lire, avec une marge d'un échantillon pour l'interpolation.
    const ppd = label.pixelsPerDegree;
    const west = normaliseEast(bounds.west, label.westDeg);
    const east = normaliseEast(bounds.east, label.westDeg);
    if (
      west < label.westDeg ||
      east > label.eastDeg ||
      bounds.north > label.northDeg ||
      bounds.south < label.southDeg
    )
      throw new Error(
        `aire ${area.id} : l'emprise déborde la source ${label.productId}`
      );
    // La marge d'un échantillon sert à l'interpolation ; au bord réel de la source elle n'existe
    // pas, et `DemGrid.rawAt` borne alors sur la dernière ligne ou colonne lue.
    const column = Math.max(0, Math.floor((west - label.westDeg) * ppd) - 1);
    const columnEnd = Math.min(
      label.lineSamples,
      Math.ceil((east - label.westDeg) * ppd) + 1
    );
    const row = Math.max(
      0,
      Math.floor((label.northDeg - bounds.north) * ppd) - 1
    );
    const rowEnd = Math.min(
      label.lines,
      Math.ceil((label.northDeg - bounds.south) * ppd) + 1
    );
    const window = {
      column,
      row,
      columns: columnEnd - column,
      rows: rowEnd - row,
    };
    const windowSamples = await fetchWindow(
      area.image,
      label,
      window,
      cacheDir,
      `${set.id}-${area.id}-${window.column}-${window.row}-${window.columns}x${window.rows}`
    );
    const grid = new DemGrid(label, windowSamples, window);
    for (const tile of tiles)
      emit(
        tile.level,
        tile.row,
        tile.column,
        bakeTile(grid, tile.level, tile.row, tile.column, quantum, poles)
      );
    coverage.push({
      level: finest,
      levels: [...area.levels].sort((a, b) => a - b),
      area: {
        id: area.id,
        name: area.name,
        gazetteerFeatureId: area.gazetteerFeatureId,
        centre: area.centre,
        diameterKm: area.diameterKm,
      },
      bounds,
      sourcePixelsPerDegree: label.pixelsPerDegree,
      sourceProductId: label.productId,
    });
  }

  // Hachage du CONTENU : il nomme le répertoire, donc une cuisson différente donne des adresses
  // différentes et le cache long de `/assets/**` reste juste.
  const digest = createHash('sha256');
  for (const entry of entries) {
    digest.update(`${entry.level}/${entry.row}/${entry.column}`);
    digest.update(entry.bytes);
  }
  const hash = digest.digest('hex').slice(0, 12);

  const manifest = {
    $comment:
      'Écrit par pnpm surface:tiles. Ne pas éditer à la main : les tuiles portent le même quantum et le même offset dans leur propre en-tête.',
    id: set.id,
    body: set.body,
    directory: `${set.output.replace(/^public\//, '')}/${hash}`,
    format: { magic: MAGIC, version: FORMAT_VERSION, samples: TILE_SAMPLES },
    quantumMetres: quantum,
    offsetMetres: 0,
    datumRadiusKm: baseLabel.radiusKm,
    coordinateSystem: baseLabel.coordinateSystem,
    baseLevel: set.base.level,
    coverage,
    elevationMetres: {
      minimum: Number(minElevation.toFixed(1)),
      maximum: Number(maxElevation.toFixed(1)),
    },
    tiles: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.bytes.length, 0),
  };

  console.log(
    `${entries.length} tuiles, ${(manifest.bytes / 1e6).toFixed(1)} Mo, ` +
      `altitudes ${manifest.elevationMetres.minimum} à ${manifest.elevationMetres.maximum} m, ` +
      `répertoire ${manifest.directory}`
  );
  if (dryRun) {
    console.log('--dry-run : rien écrit');
    return;
  }

  const outputDir = join(ROOT, set.output);
  // La cuisson précédente vivait dans un répertoire haché différent : la laisser doublerait le
  // poids du dépôt à chaque passage.
  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true });
  for (const entry of entries) {
    const path = join(
      ROOT,
      'public',
      manifest.directory,
      String(entry.level),
      String(entry.row),
      `${entry.column}.hgt`
    );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, entry.bytes);
  }
  writeFileSync(
    join(outputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  console.log(`écrit dans ${set.output}`);
}

/** Ramène une longitude dans la convention est de l'étiquette (`westDeg` … `westDeg + 360`). */
function normaliseEast(longitudeDeg, westDeg) {
  let lon = longitudeDeg;
  while (lon < westDeg) lon += 360;
  while (lon >= westDeg + 360) lon -= 360;
  return lon;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
