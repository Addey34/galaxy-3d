/* global console, process, Buffer */
/**
 * Réduit un modèle de forme scientifique à une taille utilisable sur le web.
 *
 * Usage :
 *   node scripts/decimate-shape-model.mjs <entrée.glb> <sortie.glb> [grille]
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
 */
export function shapeStats(positions, count) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += positions[i * 3];
    cy += positions[i * 3 + 1];
    cz += positions[i * 3 + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;

  const spread = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    spread[0] += (positions[i * 3] - cx) ** 2;
    spread[1] += (positions[i * 3 + 1] - cy) ** 2;
    spread[2] += (positions[i * 3 + 2] - cz) ** 2;
  }
  const sd3 = spread.map((s) => Math.sqrt(s / count));
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
    sum += r;
    const lat = Math.abs(Math.asin([dx, dy, dz][spin] / r)) * (180 / Math.PI);
    if (lat < 15) {
      equator += r;
      equatorN++;
    } else if (lat > 60) {
      polar += r;
      polarN++;
    }
  }
  const mean = sum / count;
  let variance = 0;
  for (let i = 0; i < count; i++) variance += (radii[i] - mean) ** 2;
  return {
    count,
    mean,
    sdPct: (Math.sqrt(variance / count) / mean) * 100,
    equatorOverPolar: equator / equatorN / (polar / polarN),
    spinAxis: 'XYZ'[spin],
  };
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

const [, , input, output, gridArg] = process.argv;
if (!input || !output) {
  console.error(
    'usage : node scripts/decimate-shape-model.mjs <entrée.glb> <sortie.glb> [grille]'
  );
  process.exit(1);
}
const GRID = Number(gridArg ?? 52);

const mesh = await loadFirstMesh(input);
const pos = mesh.geometry.attributes.position.array;
const vertexCount = mesh.geometry.attributes.position.count;
const index = mesh.geometry.index ? mesh.geometry.index.array : null;
const triangleCount = index ? index.length / 3 : vertexCount / 3;
console.log(`entrée : ${vertexCount} sommets, ${triangleCount} triangles`);
const before = shapeStats(pos, vertexCount);

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

const after = shapeStats(outPos, keys.length);
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
if (Math.abs(after.sdPct - before.sdPct) > 1)
  console.warn(
    '  ATTENTION : la décimation a lissé la forme, grille trop grossière.'
  );

const copyright = process.env.MODEL_COPYRIGHT ?? 'source à documenter';
const name = process.env.MODEL_NAME ?? 'shape';
const size = writeGlb(output, outPos, outNrm, outIdx, copyright, name);
console.log(`écrit ${output} — ${(size / 1024).toFixed(0)} Kio`);
