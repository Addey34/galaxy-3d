#!/usr/bin/env node
/* global console, process */
/**
 * UN ATLAS DE TEXTURE POUR UN CORPS QUE LA DIRECTION NE DÉCRIT PAS (2026-10-06).
 *
 * L'application drape une carte équirectangulaire sur un modèle de forme par la DIRECTION de
 * chaque sommet vu du centre (`core/modelUv.ts`). Sur 67P, 13,5 % de la surface partage sa
 * direction avec une autre (le cou, les surplombs) : deux endroits reçoivent alors le même
 * pixel. Un ATLAS donne à chaque point de surface son propre texel, quelle que soit sa direction.
 *
 *   node scripts/unwrap-shape-model.mjs <corps> --levels 4k,2k,1k --budgets 60000,15000,4000
 *
 * Le niveau le plus FIN, déjà écrit par `decimate-shape-model.mjs`, est déplié par xatlas
 * (`xatlasjs`, MIT, la bibliothèque de référence compilée en WebAssembly, déterministe : deux
 * dépliages du même maillage rendent les mêmes octets). Les niveaux plus grossiers sont ensuite
 * simplifiés DEPUIS ce maillage déplié, et non depuis la source : l'effondrement d'arêtes de
 * meshoptimizer garde les coutures de l'atlas (des sommets de même position aux coordonnées
 * différentes), si bien que les trois niveaux partagent UN atlas. C'est ce que le moteur exige :
 * le niveau du modèle et celui de la texture se choisissent séparément, sur un même matériau.
 *
 * Chaque niveau passe la garde de surface FERMÉE de `shape-glb.mjs` après soudure des
 * coutures ; un niveau qui ne la passe pas n'est pas écrit.
 */
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { clean, removeFins, topologyDefects, writeGlb } from './shape-glb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR =
  'galaxy scripts/unwrap-shape-model.mjs (xatlas atlas, meshoptimizer edge collapse)';
/**
 * Les îles de l'atlas occupent v ∈ [0, CHART_TOP] ; la bande au-dessus est la PASTILLE, que la cuisson
 * remplit de l'albédo moyen mesuré. La sphère qui tient lieu du modèle avant son chargement (ou
 * s'il échoue) y lit sa couleur, au lieu d'un atlas plaqué en équirectangulaire. Même valeur que
 * `ATLAS_CHART_TOP` de `src/core/modelUv.ts`, croisée par `src/config/shapeModels.test.ts`.
 */
const CHART_TOP = 0.98;
const { MeshoptSimplifier } = await import('meshoptimizer');
await MeshoptSimplifier.ready;

const args = process.argv.slice(2);
const body = args[0];
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};
const levels = option('--levels')?.split(',');
const budgets = option('--budgets')?.split(',').map(Number);
if (!body || !levels || !budgets || levels.length !== budgets.length)
  throw new Error(
    'usage : node scripts/unwrap-shape-model.mjs <corps> --levels 4k,2k,1k --budgets 60000,15000,4000'
  );
const dir = join(ROOT, 'public/assets/models', body);
const fileOf = (level) => join(dir, `${body}_shape_${level}.glb`);

/** Lit le premier maillage d'un GLB écrit par `writeGlb` : positions, indices, crédit, nom. */
function readGlb(path) {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const bin = bytes.subarray(20 + jsonLength + 8);
  const primitive = gltf.meshes[0].primitives[0];
  const read = (accessorIndex, Type, width) => {
    const accessor = gltf.accessors[accessorIndex];
    const view = gltf.bufferViews[accessor.bufferView];
    const start =
      bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    return new Type(
      bin.buffer.slice(
        start,
        start + accessor.count * width * Type.BYTES_PER_ELEMENT
      )
    );
  };
  const indexType =
    gltf.accessors[primitive.indices].componentType === 5125
      ? Uint32Array
      : Uint16Array;
  return {
    pos: read(primitive.attributes.POSITION, Float32Array, 3),
    index: Uint32Array.from(read(primitive.indices, indexType, 1)),
    copyright: gltf.asset.copyright,
    name: gltf.nodes[0].name,
  };
}

/** Dépliage xatlas : sommets dédoublés aux coutures, coordonnées ramenées sur [0, 1]. */
async function unwrap(pos, index) {
  if (pos.length / 3 > 65535)
    throw new Error(
      `${pos.length / 3} sommets : xatlasjs n'accepte que des indices 16 bits`
    );
  const require = createRequire(import.meta.url);
  const libDir = dirname(require.resolve('xatlasjs/package.json'));
  const createXAtlasModule = require(join(libDir, 'dist/node/xatlas.js'));
  const { Api } = await import(
    pathToFileURL(join(libDir, 'dist/node/api.mjs')).href
  );
  const api = await new Promise((done) => {
    const instance = new (Api(createXAtlasModule))(
      () => done(instance),
      (file) => join(libDir, 'dist/node', file)
    );
  });
  api.createAtlas();
  api.addMesh(Uint16Array.from(index), pos, null, null, body, false, false, 1);
  // Une marge de 4 texels à la résolution de référence : assez pour le filtrage bilinéaire et
  // les premiers niveaux de mipmap sans qu'une île déborde sur sa voisine.
  const atlas = api.generateAtlas(
    {},
    { resolution: 2048, padding: 4, bilinear: true },
    true
  );
  if (atlas.atlasCount !== 1)
    throw new Error(`${atlas.atlasCount} pages d'atlas, une seule attendue`);
  const out = atlas.meshes[0];
  const uvs = new Float32Array(out.vertexCount * 2);
  for (let i = 0; i < out.vertexCount; i++) {
    // xatlasjs rend des coordonnées DÉJÀ ramenées sur [0, 1] (mesuré : les diviser par la taille
    // de l'atlas tassait tout l'atlas dans un coin de 0,0004).
    uvs[i * 2] = out.vertex.coords1[i * 2];
    // Origine en BAS à gauche (convention de la scène) : la ligne d'image est (1 − v) × hauteur.
    // Les îles sont ramenées sous `CHART_TOP` : la bande du haut reste libre pour la PASTILLE.
    uvs[i * 2 + 1] = (1 - out.vertex.coords1[i * 2 + 1]) * CHART_TOP;
  }
  const result = {
    pos: out.vertex.vertices,
    index: Uint32Array.from(out.index),
    uvs,
    width: atlas.width,
    height: atlas.height,
  };
  api.destroyAtlas();
  return result;
}

/** Index soudé (les coutures refermées), pour juger la surface et lisser les normales. */
function weldedIndex(pos) {
  // Même clé que `weld` de `shape-glb.mjs` (position exacte), mais on garde la correspondance
  // sommet → sommet soudé, que `weld` ne rend pas.
  const byPosition = new Map();
  const remap = new Uint32Array(pos.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const key = `${pos[i * 3]},${pos[i * 3 + 1]},${pos[i * 3 + 2]}`;
    let n = byPosition.get(key);
    if (n === undefined) byPosition.set(key, (n = byPosition.size));
    remap[i] = n;
  }
  return { remap, count: byPosition.size };
}

/** Normales lisses calculées sur la surface SOUDÉE : aucune arête visible le long d'une couture. */
function smoothNormals(pos, index, remap, weldedCount) {
  const acc = new Float64Array(weldedCount * 3);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const u = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
    const v = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    for (const vertex of [a, b, c])
      for (let k = 0; k < 3; k++) acc[remap[vertex] * 3 + k] += n[k];
  }
  const normals = new Float32Array(pos.length);
  for (let i = 0; i < pos.length / 3; i++) {
    const w = remap[i];
    const len = Math.hypot(acc[w * 3], acc[w * 3 + 1], acc[w * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[i * 3 + k] = acc[w * 3 + k] / len;
  }
  return normals;
}

/** Garde de fermeture sur la surface soudée, nageoires retirées des DEUX indices à la fois. */
function closeOrRefuse(pos, index, label) {
  const { remap } = weldedIndex(pos);
  const welded = Uint32Array.from(index, (v) => remap[v]);
  const kept = removeFins(welded);
  let out = index;
  if (kept.length !== welded.length) {
    // `removeFins` garde l'ordre des triangles : on retrouve lesquels sont partis.
    const keys = new Set();
    for (let t = 0; t < kept.length; t += 3)
      keys.add(`${kept[t]},${kept[t + 1]},${kept[t + 2]}`);
    const list = [];
    for (let t = 0; t < welded.length; t += 3)
      if (keys.has(`${welded[t]},${welded[t + 1]},${welded[t + 2]}`))
        list.push(index[t], index[t + 1], index[t + 2]);
    out = Uint32Array.from(list);
  }
  const defects = topologyDefects(Uint32Array.from(out, (v) => remap[v]));
  if (!clean(defects))
    throw new Error(`${label} : surface non fermée ${JSON.stringify(defects)}`);
  return out;
}

/** Ne garde que les sommets employés, numérotés dans l'ordre de leur première apparition. */
function compact(pos, uvs, index) {
  const order = new Map();
  for (const v of index) if (!order.has(v)) order.set(v, order.size);
  const outPos = new Float32Array(order.size * 3);
  const outUv = new Float32Array(order.size * 2);
  for (const [v, n] of order) {
    for (let k = 0; k < 3; k++) outPos[n * 3 + k] = pos[v * 3 + k];
    for (let k = 0; k < 2; k++) outUv[n * 2 + k] = uvs[v * 2 + k];
  }
  return {
    pos: outPos,
    uvs: outUv,
    index: Uint32Array.from(index, (v) => order.get(v)),
  };
}

function write(level, mesh, source) {
  const { remap, count } = weldedIndex(mesh.pos);
  const normals = smoothNormals(mesh.pos, mesh.index, remap, count);
  const size = writeGlb(
    fileOf(level),
    mesh.pos,
    normals,
    Array.from(mesh.index),
    source.copyright,
    source.name,
    { uvs: mesh.uvs, generator: GENERATOR }
  );
  console.log(
    `  ${level} : ${mesh.pos.length / 3} sommets (${count} soudés), ${mesh.index.length / 3} triangles, surface fermée, ${(size / 1024).toFixed(0)} Kio`
  );
}

const finest = levels[budgets.indexOf(Math.max(...budgets))];
const source = readGlb(fileOf(finest));
const atlas = await unwrap(source.pos, source.index);
console.log(
  `atlas de ${body} : ${atlas.width} x ${atlas.height} à la résolution de référence`
);
const top = compact(
  atlas.pos,
  atlas.uvs,
  closeOrRefuse(atlas.pos, atlas.index, finest)
);
write(finest, top, source);

for (const [i, level] of levels.entries()) {
  if (level === finest) continue;
  const target = budgets[i];
  let index = null;
  let pass = '';
  for (const flags of [[], ['RegularizeLight'], ['Regularize']]) {
    const [out] = MeshoptSimplifier.simplify(
      top.index,
      top.pos,
      3,
      target * 3,
      1,
      flags
    );
    try {
      index = closeOrRefuse(top.pos, out, level);
      pass = flags.join('+') || 'simple';
      break;
    } catch (error) {
      if (flags[0] === 'Regularize') throw error;
    }
  }
  console.log(
    `  ${level} simplifié depuis ${finest} (${pass}), coutures gardées`
  );
  write(level, compact(top.pos, top.uvs, index), source);
}
