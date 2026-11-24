/* global console, process, fetch, Buffer */
/**
 * IMPORTE LES MODÈLES 3D D'ENGINS SPATIAUX (GAL-OBJECT-IMMERSION-001).
 *
 * Source : le dépôt public `nasa/NASA-3D-Resources` (« free and without copyright », README ; règle de
 * la NASA : le contenu servant à rendre des modèles 3D n'est « généralement pas soumis au droit
 * d'auteur » aux États-Unis, https://www.nasa.gov/nasa-brand-center/images-and-media/). Les fichiers
 * sont lus à un COMMIT ÉPINGLÉ, jamais à la branche : le contenu d'une branche change.
 *
 * Ce que fait le script, et rien d'autre : télécharge le GLB, VÉRIFIE son empreinte quand elle est
 * déjà connue (une empreinte différente = refus), recopie les octets TELS QUELS (aucune
 * transformation : le fichier du site est celui de la NASA, empreinte comprise) et écrit
 * `src/registry/craft/files.json` (empreinte, taille, triangles, matériaux). Le fichier est
 * compressé en Draco ; il est décodé au chargement (`ui/craftInspector`, décodeur JavaScript de
 * three, sans WebAssembly : la politique de sécurité du site ne déclare pas `wasm-unsafe-eval`).
 *
 * Usage : node scripts/import-craft-models.mjs [--check]
 *   sans option : télécharge, vérifie, écrit public/assets/models/craft/*.glb et le manifeste ;
 *   --check     : relit les fichiers écrits et refuse toute dérive d'empreinte.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'public/assets/models/craft');
const MANIFEST = path.join(root, 'src/registry/craft/files.json');
/** Le commit de `nasa/NASA-3D-Resources` lu le 2026-11-23 (dernier commit de la branche master). */
const REPO_COMMIT = '11ebb4ee043715aefbba6aeec8a61746fad67fa7';

/** id du modèle -> dossier du dépôt NASA (le fichier porte le même nom). */
const TARGETS = {
  'iss-b': 'International Space Station (ISS) (B)',
  'jwst-b': 'James Webb Space Telescope (B)',
  'juno-b': 'Juno (B)',
  'voyager-a': 'Voyager Probe (A)',
  'cassini-huygens-a': 'Cassini-Huygens (A)',
  'parker-solar-probe': 'Parker Solar Probe',
  rosetta: 'Rosetta',
  'osiris-rex': [
    'Origins, Spectral Interpretation, Resource Identification, and Security - Regolith Explorer (OSIRIS-REx)',
    'OSIRIS-REx',
  ],
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function sourceUrl(target) {
  const [folder, file] = Array.isArray(target) ? target : [target, target];
  return `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/${REPO_COMMIT}/3D%20Models/${encodeURIComponent(folder)}/${encodeURIComponent(file)}.glb`;
}

function describe(bytes) {
  const b = Buffer.from(bytes);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('pas un GLB');
  const json = JSON.parse(
    b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')
  );
  let triangles = 0;
  for (const mesh of json.meshes ?? [])
    for (const prim of mesh.primitives)
      triangles += json.accessors[prim.indices].count / 3;
  return {
    triangles,
    meshes: json.meshes?.length ?? 0,
    materials: json.materials?.length ?? 0,
    images: json.images?.length ?? 0,
    extensions: json.extensionsUsed ?? [],
  };
}

async function main() {
  const check = process.argv.includes('--check');
  const manifest = {};
  if (check) {
    const recorded = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    let bad = 0;
    for (const [id, entry] of Object.entries(recorded.files)) {
      const file = path.join(OUT_DIR, `${id}.glb`);
      const actual = fs.existsSync(file) ? sha256(fs.readFileSync(file)) : '';
      if (actual !== entry.sha256) {
        console.error(`DÉRIVE : ${id}`);
        bad++;
      }
    }
    if (bad) process.exit(1);
    console.log(`${Object.keys(recorded.files).length} modèles identiques.`);
    return;
  }
  const known = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
    : null;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [id, target] of Object.entries(TARGETS)) {
    const url = sourceUrl(target);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} : ${url}`);
    const source = Buffer.from(await res.arrayBuffer());
    // Le commit est épinglé : une empreinte qui change malgré lui n'est pas une mise à jour, c'est un défaut.
    if (known?.files[id] && known.files[id].sha256 !== sha256(source))
      throw new Error(`${id} : l'empreinte du commit épinglé a changé`);
    fs.writeFileSync(path.join(OUT_DIR, `${id}.glb`), source);
    manifest[id] = {
      sourceUrl: url,
      bytes: source.length,
      sha256: sha256(source),
      ...describe(source),
    };
    console.log(
      `${id}: ${source.length} o, ${manifest[id].triangles} triangles`
    );
  }
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        repository: 'nasa/NASA-3D-Resources',
        commit: REPO_COMMIT,
        files: manifest,
      },
      null,
      2
    ) + '\n'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
