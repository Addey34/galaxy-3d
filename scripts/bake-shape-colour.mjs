#!/usr/bin/env node
/* global console, process, Buffer */
/**
 * Donne à un modèle de forme la COULEUR de sa vraie surface, à tous ses niveaux de détail.
 *
 *   node scripts/bake-shape-colour.mjs <corps> --albedo <pV>
 *        [--map <carte.tif> [--lon0 0]]
 *        [--rgb <rouge.tif>,<vert.tif>,<bleu.tif> [--lon0 0]]
 *
 * Réécrit `public/assets/models/<corps>/<corps>_shape_*.glb` avec un attribut de couleur par
 * sommet (`COLOR_0`). Pas de coordonnées de texture, donc pas de couture, et chaque niveau de
 * détail reçoit exactement la même information.
 *
 * D'OÙ VIENT CHAQUE NOMBRE — rien n'est choisi à l'œil :
 *
 * - La CARTE est un produit de mission en projection cylindrique simple, latitude
 *   planétocentrique, longitudes positives vers l'est à partir de `--lon0` au bord gauche
 *   (Bennu : mosaïque d'albédo OSIRIS-REx ; Ryugu : albédo normal en bande v, Hayabusa2 ;
 *   Éros : albédos NEAR MSI à 760, 550 et 450 nm pour une vraie couleur).
 * - La LUMINOSITÉ MOYENNE vient de l'albédo géométrique publié (`--albedo`), converti à la
 *   convention d'affichage des textures de l'application, MESURÉE sur la Lune : sa texture
 *   s'affiche à une luminance linéaire moyenne de 0,312 pour un albédo de 0,12, soit 2,6.
 *   Les autres textures s'étalent de 1,6 (Mercure) à 3,8 (Phobos) : la Lune est retenue parce
 *   qu'elle est la mieux mesurée, pas parce que l'écart n'existe pas.
 * - La carte ne fournit que des CONTRASTES et des RAPPORTS de couleur : la luminance moyenne des
 *   sommets est ramenée à la valeur ci-dessus par UN facteur commun aux trois bandes, qui
 *   gardent donc leurs rapports mesurés.
 * - Sans carte, le corps reçoit une couleur UNIFORME à cette luminosité, neutre : on ne connaît
 *   que son albédo, on n'invente ni tache ni teinte.
 *
 * Repère : les niveaux ont été produits avec `--z-up` (x, y, z) → (x, z, −y). On revient donc au
 * repère du corps, pôle sur Z, avant de calculer longitude et latitude.
 */
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Luminance linéaire affichée par unité d'albédo géométrique, mesurée sur la texture lunaire. */
export const DISPLAY_PER_ALBEDO = 0.312 / 0.12;
const SAMPLE_WIDTH = 2048;

const args = process.argv.slice(2);
const option = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const body = args[0];
const albedo = Number(option('--albedo'));
if (!body || !(albedo > 0)) {
  console.error(
    'usage : node scripts/bake-shape-colour.mjs <corps> --albedo <pV> [--map carte.tif | --rgb r.tif,v.tif,b.tif] [--lon0 0]'
  );
  process.exit(1);
}
const lon0 = Number(option('--lon0') ?? 0);
const mapPaths =
  option('--rgb')?.split(',') ?? (option('--map') ? [option('--map')] : []);

/**
 * Valeur exploitable : un albédo ou une réflectance positive et plausible. Les cartes 8 bits
 * valent jusqu'à 255, les flottantes quelques dixièmes ; au-delà de 1000, c'est un NoData
 * déguisé ou un artefact, jamais une mesure.
 */
const isValid = (v) => Number.isFinite(v) && v > 0 && v < 1000;

/** Une bande de carte, réduite pour l'échantillonnage, avec sa moyenne pondérée par l'aire. */
async function loadBand(path) {
  const image = sharp(path, { limitInputPixels: false });
  const meta = await image.metadata();
  const height = Math.round((SAMPLE_WIDTH * meta.height) / meta.width);
  // Les produits flottants portent un NoData très négatif. Un noyau cubique le mélange à ses
  // voisins et produit des valeurs ÉNORMES près des trous : elles faisaient exploser la moyenne,
  // assombrissaient tout le corps et sortaient en taches saturées (Éros, constaté à l'écran).
  // Plus proche voisin : aucune valeur inventée, seulement échantillonnée.
  const { data, info } = await image
    .resize(SAMPLE_WIDTH, height, { fit: 'fill', kernel: 'nearest' })
    .raw({ depth: 'float' })
    .toBuffer({ resolveWithObject: true });
  const values = new Float32Array(
    data.buffer,
    data.byteOffset,
    data.byteLength / 4
  );
  let sum = 0;
  let weight = 0;
  for (let y = 0; y < info.height; y++) {
    const w = Math.cos(((y + 0.5) / info.height - 0.5) * Math.PI);
    for (let x = 0; x < info.width; x++) {
      const v = values[y * info.width + x];
      if (!isValid(v)) continue;
      sum += v * w;
      weight += w;
    }
  }
  const mean = sum / weight;
  if (!(mean > 0)) throw new Error(`${path} : carte vide ou illisible`);
  return { values, width: info.width, height: info.height, mean };
}

/**
 * Valeur BRUTE de la bande au point (longitude est, latitude), interpolée ; la moyenne de la
 * bande si le point tombe dans un trou. Surtout pas divisée par la moyenne de SA bande : en
 * couleur, cela ramènerait chaque bande à 1 et effacerait les rapports entre bandes — Éros
 * sortait gris. La normalisation se fait une seule fois, sur la luminance de l'ensemble.
 */
function sampleRelative(band, lonDeg, latDeg) {
  const u = ((((lonDeg - lon0) % 360) + 360) % 360) / 360;
  const v = (90 - latDeg) / 180;
  const fx = u * band.width - 0.5;
  const fy = Math.min(Math.max(v * band.height - 0.5, 0), band.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  let sum = 0;
  let weight = 0;
  for (const [dx, dy, w] of [
    [0, 0, (1 - tx) * (1 - ty)],
    [1, 0, tx * (1 - ty)],
    [0, 1, (1 - tx) * ty],
    [1, 1, tx * ty],
  ]) {
    const xx = (((x0 + dx) % band.width) + band.width) % band.width;
    const yy = Math.min(y0 + dy, band.height - 1);
    const value = band.values[yy * band.width + xx];
    if (!isValid(value)) continue; // trou de la carte
    sum += value * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : band.mean;
}

/** Lecture d'un niveau livré (géométrie du premier maillage + métadonnées). */
function readGlb(path) {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binStart = 20 + jsonLength + 8;
  const view = (index, Ctor, per) => {
    const accessor = gltf.accessors[index];
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const start = bytes.byteOffset + binStart + (bufferView.byteOffset ?? 0);
    return new Ctor(
      bytes.buffer.slice(
        start,
        start + accessor.count * per * Ctor.BYTES_PER_ELEMENT
      )
    );
  };
  const primitive = gltf.meshes[0].primitives[0];
  const indexAccessor = gltf.accessors[primitive.indices];
  return {
    positions: view(primitive.attributes.POSITION, Float32Array, 3),
    normals: view(primitive.attributes.NORMAL, Float32Array, 3),
    indices: view(
      primitive.indices,
      indexAccessor.componentType === 5125 ? Uint32Array : Uint16Array,
      1
    ),
    asset: gltf.asset,
    name: gltf.meshes[0].name,
  };
}

/** Écrit un niveau avec couleurs par sommet (VEC4 entiers 16 bits normalisés, alignés sur 4 octets). */
function writeGlb(
  path,
  { positions, normals, indices, colours, uniform, asset, name }
) {
  const pad4 = (n) => (n + 3) & ~3;
  // Sans carte, la couleur est UNIFORME : un facteur de matériau suffit, les sommets n'en
  // portent pas (+20 % de poids pour rien sinon).
  const parts = [
    Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
    Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength),
    ...(colours
      ? [Buffer.from(colours.buffer, colours.byteOffset, colours.byteLength)]
      : []),
    Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength),
  ];
  const indexView = parts.length - 1;
  const chunks = [];
  const views = [];
  let cursor = 0;
  parts.forEach((part, i) => {
    views.push({
      buffer: 0,
      byteOffset: cursor,
      byteLength: part.length,
      target: i < indexView ? 34962 : 34963,
    });
    chunks.push(part);
    const padding = pad4(part.length) - part.length;
    if (padding) chunks.push(Buffer.alloc(padding));
    cursor = pad4(cursor + part.length);
  });
  const bin = Buffer.concat(chunks);
  const count = positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const k = i % 3;
    min[k] = Math.min(min[k], positions[i]);
    max[k] = Math.max(max[k], positions[i]);
  }
  const gltf = {
    asset: {
      ...asset,
      generator:
        `${asset.generator ?? ''} + scripts/bake-shape-colour.mjs`.trim(),
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [
      {
        name,
        primitives: [
          {
            attributes: colours
              ? { POSITION: 0, NORMAL: 1, COLOR_0: 2 }
              : { POSITION: 0, NORMAL: 1 },
            indices: indexView,
            material: 0,
          },
        ],
      },
    ],
    // Avec couleurs par sommet : blanc (toute la couleur est portée par les sommets). Sinon le
    // facteur (linéaire, convention glTF) porte la couleur uniforme.
    materials: [
      {
        name,
        pbrMetallicRoughness: {
          baseColorFactor: colours ? [1, 1, 1, 1] : [...uniform, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      ...(colours
        ? [
            {
              bufferView: 2,
              componentType: 5123,
              normalized: true,
              count,
              type: 'VEC4',
            },
          ]
        : []),
      {
        bufferView: indexView,
        componentType: indices instanceof Uint32Array ? 5125 : 5123,
        count: indices.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([
    json,
    Buffer.alloc(pad4(json.length) - json.length, 0x20),
  ]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jsonHeader, json, binHeader, bin]);
  writeFileSync(path, out);
  return out.length;
}

const bands = [];
for (const path of mapPaths) bands.push(await loadBand(path));
const display = albedo * DISPLAY_PER_ALBEDO;
console.log(
  `${body} : albédo ${albedo} → luminance affichée moyenne ${display.toFixed(3)} ; ${bands.length ? `${bands.length} bande(s) de carte` : 'aucune carte, couleur uniforme neutre'}`
);

const dir = join(ROOT, 'public/assets/models', body);
for (const file of readdirSync(dir)
  .filter((f) => /_shape_\w+\.glb$/.test(f))
  .sort()) {
  const glb = readGlb(join(dir, file));
  const count = glb.positions.length / 3;
  const linear = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Repère du corps : on défait (x, y, z) → (x, z, −y) de `--z-up`.
    const x = glb.positions[i * 3];
    const y = -glb.positions[i * 3 + 2];
    const z = glb.positions[i * 3 + 1];
    const r = Math.hypot(x, y, z) || 1;
    const lon = (Math.atan2(y, x) * 180) / Math.PI;
    const lat = (Math.asin(z / r) * 180) / Math.PI;
    let rgb;
    if (bands.length === 3)
      rgb = bands.map((band) => sampleRelative(band, lon, lat));
    else if (bands.length === 1)
      rgb = Array(3).fill(sampleRelative(bands[0], lon, lat));
    else rgb = [1, 1, 1];
    for (let k = 0; k < 3; k++) linear[i * 3 + k] = rgb[k];
  }
  // Moyenne de LUMINANCE des sommets ramenée exactement à la valeur visée (les contrastes et les
  // rapports de couleur restent ceux de la carte).
  let lum = 0;
  for (let i = 0; i < count; i++)
    lum +=
      0.2126 * linear[i * 3] +
      0.7152 * linear[i * 3 + 1] +
      0.0722 * linear[i * 3 + 2];
  const scale = display / (lum / count);
  const colours = new Uint16Array(count * 4);
  let clipped = 0;
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = linear[i * 3 + k] * scale;
      if (v > 1) clipped++;
      colours[i * 4 + k] = Math.round(Math.min(1, Math.max(0, v)) * 65535);
    }
    colours[i * 4 + 3] = 65535;
  }
  const size = writeGlb(
    join(dir, file),
    bands.length
      ? { ...glb, colours }
      : { ...glb, colours: null, uniform: [display, display, display] }
  );
  console.log(
    `  ${file} : ${count} sommets colorés, ${(size / 1024).toFixed(0)} Kio${clipped ? `, ${clipped} composantes écrêtées` : ''}`
  );
}
