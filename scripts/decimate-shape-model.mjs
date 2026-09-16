/* global console, process, Buffer */
/**
 * Réduit un modèle de forme scientifique à une taille utilisable sur le web.
 *
 * Usage :
 *   node scripts/decimate-shape-model.mjs <entrée> <sortie.glb> [grille] [--z-up] [--target N]
 * `--target N` : cherche la grille dont le maillage produit approche N triangles (sans le
 * dépasser de plus de 5 %). C'est ainsi que sont produits les niveaux de détail
 * `{corps}_shape_{1k,2k,4k}.glb` : un budget de triangles par niveau, pas une grille réglée à la
 * main corps par corps. Refuse un budget que la SOURCE ne peut pas atteindre — un niveau plus
 * détaillé que sa source serait une interpolation présentée comme une mesure.
 *
 * Entrées lues : glTF binaire (.glb), Wavefront (.obj), et les deux formats de la PDS Small
 * Bodies Node — table sommets/plaques (`ver128q.tab` : comptes, « id x y z », « id a b c ») et
 * grille latitude/longitude/rayon (`243ida.tab`, planétocentrique, degrés et km).
 *
 * `--z-up` : le fichier porte le PÔLE sur Z, convention des produits PDS en repère lié au
 * corps. La scène fait tourner chaque corps autour de son Y local (convention glTF) : sans
 * cette rotation, le corps tournerait autour d'un axe équatorial. C'est exactement ce qui a été
 * livré pour Bennu, dont le fichier SVS porte son pôle sur Z. `src/config/shapeModels.test.ts`
 * vérifie désormais que l'axe de plus grande inertie de chaque modèle livré est Y.
 *
 * POURQUOI ce script existe. Les modèles de forme publiés par la NASA sont des produits
 * scientifiques : celui de Bennu fait 3,37 millions de triangles et 60 Mo. Inutilisable tel
 * quel. Les versions « légères » qu'on trouve ailleurs ne sont pas des modèles de forme :
 * celle du dépôt NASA-3D-Resources est une sphère bosselée (écart-type du rayon 0,76 %,
 * rapport équateur/pôles 0,999) alors que Bennu est une toupie (6,00 % et 1,118). Elle est
 * d'ailleurs nommée « Fake » dans le fichier. La décimer nous-mêmes est le seul moyen d'avoir
 * à la fois la vraie forme et un poids raisonnable.
 *
 * MÉTHODE : regroupement de sommets. La boîte englobante est découpée en une grille régulière,
 * les sommets d'une même cellule sont remplacés par leur centroïde, les triangles devenus
 * dégénérés ou dupliqués sont supprimés. C'est un filtre passe-bas — la forme d'ensemble
 * survit, les cailloux disparaissent.
 *
 * CE QUI DOIT ÊTRE VÉRIFIÉ, et que le script imprime avant/après : l'écart-type du rayon et le
 * rapport équateur/pôles. Ce sont les deux nombres qui distinguent un modèle de forme d'une
 * patate. S'ils bougent, la décimation a mangé la signature du corps et la grille est trop
 * grossière. Sur Bennu, de 3,37 M à 22,8 k triangles : 6,00 % → 6,03 % et 1,118 → 1,119.
 *
 * Le fichier produit est DÉTERMINISTE : les cellules sont parcourues dans l'ordre de leur
 * indice, jamais dans l'ordre d'insertion, donc deux exécutions donnent les mêmes octets.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { GLTFLoader } = await import(
  pathToFileURL(
    resolve(ROOT, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js')
  ).href
);

/**
 * Statistiques de forme. `sdPct` mesure l'irrégularité, `equatorOverPolar` l'aplatissement
 * autour de l'axe de plus faible extension (l'axe de rotation d'une toupie).
 *
 * `weights` (optionnel) pondère chaque sommet. Sans poids, chaque sommet compte pour un — ce
 * qui mesure AUSSI l'échantillonnage : une grille latitude/longitude, dont la densité croît
 * comme 1/cos φ vers les pôles, sort avec un rapport équateur/pôles de 0,94 quand la même
 * forme, rééchantillonnée uniformément, donne 2,0 (Ida, mesuré). Pondérés par l'aire
 * (`vertexAreaWeights`), ces nombres décrivent la SURFACE et plus la façon dont on l'a tirée.
 */
export function shapeStats(positions, count, weights = null) {
  const w = (i) => (weights ? weights[i] : 1);
  let total = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    total += w(i);
    cx += w(i) * positions[i * 3];
    cy += w(i) * positions[i * 3 + 1];
    cz += w(i) * positions[i * 3 + 2];
  }
  cx /= total;
  cy /= total;
  cz /= total;

  const spread = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    spread[0] += w(i) * (positions[i * 3] - cx) ** 2;
    spread[1] += w(i) * (positions[i * 3 + 1] - cy) ** 2;
    spread[2] += w(i) * (positions[i * 3 + 2] - cz) ** 2;
  }
  const sd3 = spread.map((s) => Math.sqrt(s / total));
  const spin = sd3.indexOf(Math.min(...sd3));

  let sum = 0;
  let equator = 0;
  let equatorN = 0;
  let polar = 0;
  let polarN = 0;
  const radii = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - cx;
    const dy = positions[i * 3 + 1] - cy;
    const dz = positions[i * 3 + 2] - cz;
    const r = Math.hypot(dx, dy, dz);
    radii[i] = r;
    sum += w(i) * r;
    const lat = Math.abs(Math.asin([dx, dy, dz][spin] / r)) * (180 / Math.PI);
    if (lat < 15) {
      equator += w(i) * r;
      equatorN += w(i);
    } else if (lat > 60) {
      polar += w(i) * r;
      polarN += w(i);
    }
  }
  const mean = sum / total;
  let variance = 0;
  for (let i = 0; i < count; i++) variance += w(i) * (radii[i] - mean) ** 2;
  return {
    count,
    mean,
    sdPct: (Math.sqrt(variance / total) / mean) * 100,
    equatorOverPolar: equator / equatorN / (polar / polarN),
    spinAxis: 'XYZ'[spin],
  };
}

/**
 * Charge un modèle de forme en tableaux bruts, quel que soit son format — cf. l'en-tête.
 * Rend `{ pos, index }` (index `null` pour un glTF non indexé).
 */
async function loadShape(path) {
  if (path.toLowerCase().endsWith('.glb')) {
    const mesh = await loadFirstMesh(path);
    return {
      pos: mesh.geometry.attributes.position.array,
      index: mesh.geometry.index ? mesh.geometry.index.array : null,
    };
  }
  const lines = readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (path.toLowerCase().endsWith('.obj')) {
    const pos = [];
    const index = [];
    for (const line of lines) {
      const t = line.split(/\s+/);
      if (t[0] === 'v') pos.push(Number(t[1]), Number(t[2]), Number(t[3]));
      else if (t[0] === 'f') {
        if (t.length !== 4) throw new Error(`${path} : face non triangulaire`);
        index.push(...t.slice(1).map((v) => parseInt(v, 10) - 1));
      }
    }
    return { pos: Float32Array.from(pos), index: Uint32Array.from(index) };
  }
  const first = lines[0].split(/\s+/).map(Number);
  if (first.length === 2 && first.every(Number.isInteger)) {
    // Table sommets/plaques PDS : indices 1-based, coordonnées en km.
    const [vertices, plates] = first;
    const pos = new Float32Array(vertices * 3);
    for (let i = 0; i < vertices; i++) {
      const t = lines[1 + i].split(/\s+/).map(Number);
      pos[i * 3] = t[1];
      pos[i * 3 + 1] = t[2];
      pos[i * 3 + 2] = t[3];
    }
    const index = new Uint32Array(plates * 3);
    for (let i = 0; i < plates; i++) {
      const t = lines[1 + vertices + i].split(/\s+/).map(Number);
      index[i * 3] = t[1] - 1;
      index[i * 3 + 1] = t[2] - 1;
      index[i * 3 + 2] = t[3] - 1;
    }
    return { pos, index };
  }
  // Grille latitude / longitude / rayon. La longitude 360 double la longitude 0 : elle est
  // écartée, et la couture se referme par l'indice modulo.
  const rows = lines.map((line) => line.split(/\s+/).map(Number));
  if (rows.some((r) => r.length !== 3 || !r.every(Number.isFinite)))
    throw new Error(`${path} : format de modèle de forme non reconnu`);
  const lats = [...new Set(rows.map((r) => r[0]))];
  const lons = [...new Set(rows.map((r) => r[1]))].filter((l) => l < 360);
  const radius = new Map(rows.map((r) => [`${r[0]},${r[1] % 360}`, r[2]]));
  const pos = new Float32Array(lats.length * lons.length * 3);
  lats.forEach((lat, i) =>
    lons.forEach((lon, j) => {
      const r = radius.get(`${lat},${lon}`);
      if (r === undefined)
        throw new Error(`${path} : rayon manquant en ${lat}°, ${lon}°`);
      const phi = (lat * Math.PI) / 180;
      const lambda = (lon * Math.PI) / 180;
      const k = (i * lons.length + j) * 3;
      pos[k] = r * Math.cos(phi) * Math.cos(lambda);
      pos[k + 1] = r * Math.cos(phi) * Math.sin(lambda);
      pos[k + 2] = r * Math.sin(phi);
    })
  );
  const index = [];
  const at = (i, j) => i * lons.length + (j % lons.length);
  // Orientation vers l'extérieur : latitudes décroissantes d'une ligne à l'autre.
  for (let i = 0; i + 1 < lats.length; i++)
    for (let j = 0; j < lons.length; j++)
      index.push(
        at(i, j),
        at(i + 1, j),
        at(i, j + 1),
        at(i, j + 1),
        at(i + 1, j),
        at(i + 1, j + 1)
      );
  return { pos, index: Uint32Array.from(index) };
}

/** Volume d'un maillage fermé (divergence) — pour imprimer le rayon équivalent. */
function meshVolume(pos, index, triangleCount) {
  let volume = 0;
  for (let t = 0; t < triangleCount; t++) {
    const [a, b, c] = [0, 1, 2].map(
      (k) => (index ? index[t * 3 + k] : t * 3 + k) * 3
    );
    volume +=
      (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) -
        pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) +
        pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) /
      6;
  }
  return Math.abs(volume);
}

const equivalentRadius = (volume) => Math.cbrt((3 * volume) / (4 * Math.PI));

/** Poids d'aire par sommet : un tiers de l'aire de chaque triangle adjacent. */
function vertexAreaWeights(pos, index, triangleCount, vertexCount) {
  const weights = new Float64Array(vertexCount);
  for (let t = 0; t < triangleCount; t++) {
    const [a, b, c] = [0, 1, 2].map((k) =>
      index ? index[t * 3 + k] : t * 3 + k
    );
    const u = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
    const v = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
    const area =
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0]
      ) / 2;
    for (const k of [a, b, c]) weights[k] += area / 3;
  }
  return weights;
}

function loadFirstMesh(path) {
  const bytes = readFileSync(path);
  return new Promise((ok, ko) => {
    new GLTFLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
      (gltf) => {
        let mesh = null;
        gltf.scene.traverse((o) => {
          if (o.isMesh && !mesh) mesh = o;
        });
        if (!mesh) ko(new Error(`${path} : aucun maillage`));
        else ok(mesh);
      },
      ko
    );
  });
}

/** Écrit un GLB minimal : positions, normales, indices, un matériau. */
function writeGlb(path, positions, normals, indices, copyright, name) {
  const use32 = positions.length / 3 > 65535;
  const indexArray = use32
    ? new Uint32Array(indices)
    : new Uint16Array(indices);
  const pad4 = (n) => (n + 3) & ~3;
  const parts = [
    Buffer.from(positions.buffer, 0, positions.byteLength),
    Buffer.from(normals.buffer, 0, normals.byteLength),
    Buffer.from(indexArray.buffer, 0, indexArray.byteLength),
  ];
  const offsets = [];
  const chunks = [];
  let cursor = 0;
  for (const part of parts) {
    offsets.push(cursor);
    chunks.push(part);
    const padding = pad4(part.length) - part.length;
    if (padding) chunks.push(Buffer.alloc(padding));
    cursor = pad4(cursor + part.length);
  }
  const bin = Buffer.concat(chunks);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const k = i % 3;
    if (positions[i] < min[k]) min[k] = positions[i];
    if (positions[i] > max[k]) max[k] = positions[i];
  }

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'galaxy scripts/decimate-shape-model.mjs (vertex clustering)',
      copyright,
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [
      {
        name,
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
        ],
      },
    ],
    materials: [
      {
        name,
        pbrMetallicRoughness: {
          baseColorFactor: [0.35, 0.33, 0.32, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min,
        max,
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: normals.length / 3,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        componentType: use32 ? 5125 : 5123,
        count: indexArray.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: offsets[0],
        byteLength: parts[0].length,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: offsets[1],
        byteLength: parts[1].length,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: offsets[2],
        byteLength: parts[2].length,
        target: 34963,
      },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonChunk = Buffer.concat([
    json,
    Buffer.alloc(pad4(json.length) - json.length, 0x20),
  ]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin]);
  writeFileSync(path, out);
  return out.length;
}

const args = process.argv.slice(2);
const zUp = args.includes('--z-up');
const targetAt = args.indexOf('--target');
const TARGET = targetAt === -1 ? null : Number(args[targetAt + 1]);
const [input, output, gridArg] = args
  .filter((_a, i) => targetAt === -1 || (i !== targetAt && i !== targetAt + 1))
  .filter((a) => !a.startsWith('--'));
if (!input || !output) {
  console.error(
    'usage : node scripts/decimate-shape-model.mjs <entrée> <sortie.glb> [grille] [--z-up]'
  );
  process.exit(1);
}
let GRID = Number(gridArg ?? 52);

const shape = await loadShape(input);
const pos = Float32Array.from(shape.pos);
const index = shape.index;
const vertexCount = pos.length / 3;
if (zUp) {
  // Pôle Z → Y : rotation de −90° autour de X, (x, y, z) → (x, z, −y). Déterminant +1 : c'est
  // une rotation, pas un miroir — la chiralité du corps et l'orientation des faces survivent.
  for (let i = 0; i < vertexCount; i++) {
    const y = pos[i * 3 + 1];
    pos[i * 3 + 1] = pos[i * 3 + 2];
    pos[i * 3 + 2] = -y;
  }
}
const triangleCount = index ? index.length / 3 : vertexCount / 3;
console.log(
  `entrée : ${vertexCount} sommets, ${triangleCount} triangles${zUp ? ' (pôle Z ramené sur Y)' : ''}`
);
const before = shapeStats(pos, vertexCount);
const beforeArea = shapeStats(
  pos,
  vertexCount,
  vertexAreaWeights(pos, index, triangleCount, vertexCount)
);
const volumeBefore = meshVolume(pos, index, triangleCount);

function cluster(GRID) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    const k = i % 3;
    if (pos[i] < min[k]) min[k] = pos[i];
    if (pos[i] > max[k]) max[k] = pos[i];
  }
  const span = [0, 1, 2].map((k) => max[k] - min[k] || 1);
  const cellOf = (v) => {
    let key = 0;
    for (let k = 0; k < 3; k++)
      key =
        key * GRID +
        Math.min(
          GRID - 1,
          Math.floor(((pos[v * 3 + k] - min[k]) / span[k]) * GRID)
        );
    return key;
  };

  const sums = new Map();
  for (let i = 0; i < vertexCount; i++) {
    const key = cellOf(i);
    let s = sums.get(key);
    if (!s) sums.set(key, (s = [0, 0, 0, 0]));
    s[0] += pos[i * 3];
    s[1] += pos[i * 3 + 1];
    s[2] += pos[i * 3 + 2];
    s[3]++;
  }
  // Ordre stable : par indice de cellule, jamais par ordre d'insertion.
  const keys = [...sums.keys()].sort((a, b) => a - b);
  const remap = new Map();
  const outPos = new Float32Array(keys.length * 3);
  keys.forEach((key, n) => {
    const s = sums.get(key);
    outPos[n * 3] = s[0] / s[3];
    outPos[n * 3 + 1] = s[1] / s[3];
    outPos[n * 3 + 2] = s[2] / s[3];
    remap.set(key, n);
  });

  const seen = new Set();
  const outIdx = [];
  for (let t = 0; t < triangleCount; t++) {
    const a = remap.get(cellOf(index ? index[t * 3] : t * 3));
    const b = remap.get(cellOf(index ? index[t * 3 + 1] : t * 3 + 1));
    const c = remap.get(cellOf(index ? index[t * 3 + 2] : t * 3 + 2));
    if (a === b || b === c || a === c) continue;
    const lo = Math.min(a, b, c);
    const hi = Math.max(a, b, c);
    const sig = `${lo},${a + b + c - lo - hi},${hi}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    outIdx.push(a, b, c);
  }

  const outNrm = new Float32Array(keys.length * 3);
  for (let i = 0; i < outIdx.length; i += 3) {
    const [a, b, c] = [outIdx[i], outIdx[i + 1], outIdx[i + 2]];
    const ux = outPos[b * 3] - outPos[a * 3];
    const uy = outPos[b * 3 + 1] - outPos[a * 3 + 1];
    const uz = outPos[b * 3 + 2] - outPos[a * 3 + 2];
    const vx = outPos[c * 3] - outPos[a * 3];
    const vy = outPos[c * 3 + 1] - outPos[a * 3 + 1];
    const vz = outPos[c * 3 + 2] - outPos[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      outNrm[k * 3] += nx;
      outNrm[k * 3 + 1] += ny;
      outNrm[k * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < keys.length; i++) {
    const len =
      Math.hypot(outNrm[i * 3], outNrm[i * 3 + 1], outNrm[i * 3 + 2]) || 1;
    outNrm[i * 3] /= len;
    outNrm[i * 3 + 1] /= len;
    outNrm[i * 3 + 2] /= len;
  }
  return { keys, outPos, outIdx, outNrm };
}

if (TARGET !== null) {
  // La grille croît avec le nombre de triangles produits : recherche dichotomique.
  if (triangleCount < TARGET * 0.95)
    throw new Error(
      `la source n'a que ${triangleCount} triangles : impossible d'en produire ${TARGET} sans inventer de géométrie`
    );
  let lo = 4;
  let hi = 2048;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const produced = cluster(mid).outIdx.length / 3;
    if (produced <= TARGET * 1.05) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  GRID = best ?? 4;
  console.log(`grille retenue pour ~${TARGET} triangles : ${GRID}`);
}
const { keys, outPos, outIdx, outNrm } = cluster(GRID);

const after = shapeStats(outPos, keys.length);
const afterArea = shapeStats(
  outPos,
  keys.length,
  vertexAreaWeights(outPos, outIdx, outIdx.length / 3, keys.length)
);
console.log(`sortie : ${keys.length} sommets, ${outIdx.length / 3} triangles`);
console.log(
  `  écart-type du rayon  ${before.sdPct.toFixed(2)} %  →  ${after.sdPct.toFixed(2)} %`
);
console.log(
  `  équateur / pôles     ${before.equatorOverPolar.toFixed(3)}  →  ${after.equatorOverPolar.toFixed(3)}`
);
console.log(
  `  rayon moyen          ${before.mean.toFixed(4)}  →  ${after.mean.toFixed(4)}`
);
const volumeAfter = meshVolume(outPos, outIdx, outIdx.length / 3);
console.log(
  `  rayon équiv.-volume  ${equivalentRadius(volumeBefore).toFixed(4)}  →  ${equivalentRadius(volumeAfter).toFixed(4)}`
);
console.log(`  axe de plus faible étendue : ${after.spinAxis}`);
console.log('  pondéré par l’aire (indépendant de l’échantillonnage) :');
console.log(
  `    écart-type du rayon  ${beforeArea.sdPct.toFixed(2)} %  →  ${afterArea.sdPct.toFixed(2)} %`
);
console.log(
  `    équateur / pôles     ${beforeArea.equatorOverPolar.toFixed(3)}  →  ${afterArea.equatorOverPolar.toFixed(3)}`
);
// Critère sur la version pondérée : la version par sommet s'alarme dès que l'échantillonnage
// de la source est non uniforme (grille lat/lon, ICQ), même quand la forme est intacte.
if (Math.abs(afterArea.sdPct - beforeArea.sdPct) > 1)
  console.warn(
    '  ATTENTION : la décimation a lissé la forme, grille trop grossière.'
  );

const copyright = process.env.MODEL_COPYRIGHT ?? 'source à documenter';
const name = process.env.MODEL_NAME ?? 'shape';
const size = writeGlb(output, outPos, outNrm, outIdx, copyright, name);
console.log(`écrit ${output} — ${(size / 1024).toFixed(0)} Kio`);
