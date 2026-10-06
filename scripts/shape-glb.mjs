/* global Buffer */
/**
 * CE QUE PARTAGENT LES SCRIPTS DE MODÈLES DE FORME (2026-10-06) : l'écriture d'un GLB minimal et
 * les contrôles de surface FERMÉE. Extrait de `decimate-shape-model.mjs` quand
 * `unwrap-shape-model.mjs` en a eu besoin à son tour : deux copies de la garde de fermeture
 * finiraient par diverger, et c'est elle qui empêche de livrer un maillage troué.
 */
import { writeFileSync } from 'fs';

/**
 * Écrit un GLB minimal : positions, normales, indices, un matériau, et des coordonnées de
 * texture quand `uvs` est donné (un atlas, cf. `unwrap-shape-model.mjs`).
 */
export function writeGlb(
  path,
  positions,
  normals,
  indices,
  copyright,
  name,
  {
    uvs = null,
    generator = 'galaxy scripts/decimate-shape-model.mjs (meshoptimizer edge collapse)',
  } = {}
) {
  const use32 = positions.length / 3 > 65535;
  const indexArray = use32
    ? new Uint32Array(indices)
    : new Uint16Array(indices);
  const pad4 = (n) => (n + 3) & ~3;
  const parts = [
    Buffer.from(positions.buffer, 0, positions.byteLength),
    Buffer.from(normals.buffer, 0, normals.byteLength),
    Buffer.from(indexArray.buffer, 0, indexArray.byteLength),
    ...(uvs ? [Buffer.from(uvs.buffer, uvs.byteOffset, uvs.byteLength)] : []),
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
      generator,
      copyright,
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [
      {
        name,
        primitives: [
          {
            attributes: {
              POSITION: 0,
              NORMAL: 1,
              ...(uvs ? { TEXCOORD_0: 3 } : {}),
            },
            indices: 2,
            material: 0,
          },
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
      ...(uvs
        ? [
            {
              bufferView: 3,
              componentType: 5126,
              count: uvs.length / 2,
              type: 'VEC2',
            },
          ]
        : []),
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
      ...(uvs
        ? [
            {
              buffer: 0,
              byteOffset: offsets[3],
              byteLength: parts[3].length,
              target: 34962,
            },
          ]
        : []),
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

/**
 * Soude les sommets de MÊME position (une grille répète le pôle à chaque longitude, un glTF
 * drapé duplique sa couture) puis écarte les triangles devenus dégénérés ou répétés. Sans
 * soudure, la simplification verrait des bords là où la surface est fermée.
 */
export function weld(pos, index, triangleCount) {
  const byPosition = new Map();
  const remap = new Uint32Array(pos.length / 3);
  const welded = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const key = `${pos[i * 3]},${pos[i * 3 + 1]},${pos[i * 3 + 2]}`;
    let n = byPosition.get(key);
    if (n === undefined) {
      n = byPosition.size;
      byPosition.set(key, n);
      welded.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    remap[i] = n;
  }
  const seen = new Set();
  const triangles = [];
  for (let t = 0; t < triangleCount; t++) {
    const [a, b, c] = [0, 1, 2].map(
      (k) => remap[index ? index[t * 3 + k] : t * 3 + k]
    );
    if (a === b || b === c || a === c) continue;
    const lo = Math.min(a, b, c);
    const hi = Math.max(a, b, c);
    const sig = `${lo},${a + b + c - lo - hi},${hi}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    triangles.push(a, b, c);
  }
  return {
    pos: Float32Array.from(welded),
    index: Uint32Array.from(triangles),
  };
}

/**
 * Ce qu'un maillage de surface FERMÉE doit être, compté arête par arête : chaque arête bordée
 * par exactement deux triangles (sinon un trou, ou une arête non manifold), et parcourue dans
 * deux sens opposés (sinon une face retournée, que la scène dessine en noir).
 */
export function topologyDefects(index) {
  const edges = new Map();
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index[t + k];
      const b = index[t + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const e = edges.get(key) ?? { n: 0, forward: 0 };
      e.n++;
      if (a < b) e.forward++;
      edges.set(key, e);
    }
  let boundary = 0;
  let nonManifold = 0;
  let flipped = 0;
  for (const e of edges.values()) {
    if (e.n === 1) boundary++;
    else if (e.n > 2) nonManifold++;
    else if (e.forward !== 1) flipped++;
  }
  return { boundary, nonManifold, flipped };
}

export const clean = (d) => d.boundary + d.nonManifold + d.flipped === 0;

/**
 * Retire les NAGEOIRES : deux triangles sur les trois mêmes sommets, de sens opposés. C'est un
 * feuillet d'épaisseur nulle que l'effondrement d'arêtes laisse parfois (662 paires sur Bennu
 * à 60 000 triangles, toutes ses arêtes non manifold) ; il ne porte ni volume ni surface
 * extérieure, et la scène le dessine en noir. Les retirer ferme la surface sans rien inventer.
 */
export function removeFins(index) {
  const byVertices = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const key = [index[t], index[t + 1], index[t + 2]]
      .sort((a, b) => a - b)
      .join();
    const list = byVertices.get(key) ?? [];
    list.push(t);
    byVertices.set(key, list);
  }
  // Même cycle à une rotation près = même sens.
  const cycle = (t) => {
    const v = [index[t], index[t + 1], index[t + 2]];
    const i = v.indexOf(Math.min(...v));
    return `${v[i]},${v[(i + 1) % 3]},${v[(i + 2) % 3]}`;
  };
  const drop = new Set();
  for (const list of byVertices.values()) {
    if (list.length !== 2) continue;
    if (cycle(list[0]) === cycle(list[1]))
      drop.add(list[1]); // doublon : un seul compte
    else for (const t of list) drop.add(t); // nageoire : ni l'un ni l'autre
  }
  if (!drop.size) return index;
  const kept = [];
  for (let t = 0; t < index.length; t += 3)
    if (!drop.has(t)) kept.push(index[t], index[t + 1], index[t + 2]);
  return Uint32Array.from(kept);
}
