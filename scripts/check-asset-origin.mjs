#!/usr/bin/env node
/* global console, process, fetch, setTimeout */
/**
 * AVANT un déploiement : chaque gros fichier de la build existe-t-il sur l'origine qui les sert,
 * à la même taille ?
 *
 * `VITE_ASSET_ORIGIN` fait lire textures, modèles et éphémérides ailleurs que sur le site
 * (`src/config/assetOrigin.ts`). Un site déployé vers une origine qui n'a pas le fichier rend des
 * 404 que le navigateur ne distingue pas d'un refus CORS ; une texture réécrite sous le même nom
 * mais pas recopiée en rendrait l'ANCIENNE sans rien dire. Les `.bin` d'éphémérides portent leur
 * hachage (un fichier absent se voit), les textures ont un nom stable (seule la taille trahit).
 *
 * Deux origines : `VITE_ASSET_ORIGIN` (éphémérides, lues par `Range`) et `VITE_STATIC_ORIGIN`
 * (textures et modèles). Sans `VITE_ASSET_ORIGIN` il n'y a rien à vérifier et le script sort en code 0.
 * Sortie : 0 tout est là, 1 manque ou taille différente, 2 origine illisible.
 */
import { readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const clean = (v) => (v ?? '').trim().replace(/\/+$/, '');
const ORIGIN = clean(process.env.VITE_ASSET_ORIGIN);
// Textures et modèles : origine statique (Cloudflare), à défaut celle des éphémérides.
const STATIC = clean(process.env.VITE_STATIC_ORIGIN) || ORIGIN;
const originOf = (path) =>
  path.startsWith('assets/ephemerides/') ? ORIGIN : STATIC;
const ROOT = process.env.DIST_DIR ?? 'dist';
const DIRS = ['assets/textures', 'assets/models', 'assets/ephemerides'];
const CONCURRENCY = 12;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Compare ce que la build porte à ce que l'origine annonce, et nomme chaque écart. */
export function compareFiles(local, remote) {
  const problems = [];
  for (const [path, size] of local) {
    const seen = remote.get(path);
    if (seen === undefined) problems.push(`absent de l'origine : ${path}`);
    else if (seen !== size)
      problems.push(
        `taille ${seen} sur l'origine, ${size} dans la build : ${path}`
      );
  }
  return problems;
}

/**
 * La taille annoncée d'un fichier : un nombre, `undefined` si l'en-tête manque, `null` pour un
 * 404. Une connexion qui expire est REPRISE (mesuré le 2026-10-24 : une requête sur ~480 expirait
 * sans raison depuis un poste Windows), puis l'erreur est rendue, jamais avalée.
 */
async function remoteSize(path, attempts = 4) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${originOf(path)}/${path}`, {
        method: 'HEAD',
        headers: { 'Accept-Encoding': 'identity' },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const length = response.headers.get('content-length');
      return length === null ? undefined : Number(length);
    } catch (error) {
      last = error;
      await new Promise((done) => setTimeout(done, 400 * attempt));
    }
  }
  throw last;
}

async function main() {
  if (!ORIGIN && !STATIC) {
    console.log('VITE_ASSET_ORIGIN vide : rien à vérifier.');
    return 0;
  }
  const local = new Map();
  for (const dir of DIRS)
    for await (const file of walk(join(ROOT, dir)))
      local.set(relative(ROOT, file).split(sep).join('/'), statSync(file).size);
  if (local.size === 0) {
    console.error(`aucun fichier lourd dans ${ROOT} : la build manque ?`);
    return 2;
  }
  const remote = new Map();
  const queue = [...local.keys()];
  let unreadable = 0;
  let firstError = '';
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let path = queue.pop(); path; path = queue.pop()) {
        try {
          const size = await remoteSize(path);
          if (size === undefined) remote.set(path, local.get(path));
          else if (size !== null) remote.set(path, size);
        } catch (error) {
          unreadable += 1;
          firstError ||= String(error?.cause?.code ?? error?.message ?? error);
        }
      }
    })
  );
  if (unreadable > 0) {
    console.error(
      `${unreadable} requêtes sans réponse : origine ${ORIGIN} ou ${STATIC} injoignable ?`
    );
    return 2;
  }
  const problems = compareFiles(local, remote);
  if (problems.length) {
    console.error(
      `${problems.length} écart(s) entre la build et ses origines :`
    );
    for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
    return 1;
  }
  console.log(
    `${local.size} fichiers lourds présents sur ${[...new Set([ORIGIN, STATIC])].join(' et ')}, tailles identiques.`
  );
  return 0;
}

if (
  import.meta.url === `file://${process.argv[1].split(sep).join('/')}` ||
  process.argv[1]?.endsWith('check-asset-origin.mjs')
)
  process.exitCode = await main();
