/* global process */
/**
 * SÉLECTION PAR CORPS ET CACHE EXTÉRIEUR POUR LA COLLECTE ODE (GAL-A003-03).
 *
 * `pull-ode-footprints.mjs --only` filtre par IHID, c'est-à-dire par MISSION : MESSENGER couvre
 * Mercure ET Vénus (survols), `ARCB-NRAO` la Lune ET Vénus. `--only MESSENGER` tirait donc aussi
 * des jeux de Vénus. `--body` filtre sur la CIBLE du jeu, strictement, et se combine avec `--only`
 * par intersection.
 *
 * Les métadonnées du cache (`iipt.json`, `counts.json`, `redundancy.json`, `unfrozen.json`,
 * `freeze.json`) sont calculées sur la liste COMPLÈTE des jeux, jamais sur la sélection : un
 * tirage partiel ne doit pas les réduire. `assertMetadataComplete` le vérifie avant toute écriture
 * de page, pour qu'un fichier partiel ou périmé fasse échouer au lieu d'être pris pour une vérité.
 *
 * Module pur (hors fichiers du cache et de la serrure) : testé dans `src/config/odeSelection.test.ts`.
 */
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Les corps qu'une collecte peut viser, dans l'ordre voulu (Mercure d'abord, plus petit). */
export const COLLECTABLE_BODIES = ['mercury', 'mars'];

/**
 * Jeux retenus : cible == `body` (strict), puis IHID == `only` si donné. Lève si `body` est absent
 * ou inconnu, ou si la sélection est vide (une faute de frappe ne doit pas ressembler à « rien à
 * tirer »).
 */
export function selectDatasets(list, { body, only = null }) {
  if (!body)
    throw new Error(
      `--body est obligatoire pour une collecte (${COLLECTABLE_BODIES.join(', ')})`
    );
  if (!COLLECTABLE_BODIES.includes(body))
    throw new Error(
      `--body ${body} : corps inconnu (${COLLECTABLE_BODIES.join(', ')})`
    );
  const picked = list.filter(
    (s) => s.target === body && (only === null || s.IHID === only)
  );
  if (picked.length === 0)
    throw new Error(
      `aucun jeu pour --body ${body}${only ? ` --only ${only}` : ''}`
    );
  return picked;
}

/** Remonte les dossiers parents : vrai si l'un d'eux contient `.git` (dépôt ou worktree). */
function insideGitTree(path) {
  let dir = path;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const up = dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

/**
 * Le répertoire du cache : `--cache-dir`, sinon la variable d'environnement, sinon (seulement
 * sans `--body`) l'ancien emplacement du dépôt. Une collecte par corps EXIGE un chemin absolu
 * extérieur à tout dépôt et à tout worktree : un `git clean` ou la suppression d'un worktree
 * jetable ne doit jamais emporter des heures de collecte.
 */
export function resolveCacheDir({ arg, env, root, requireExternal }) {
  const chosen = arg || env || null;
  if (chosen === null) {
    if (requireExternal)
      throw new Error(
        'une collecte par corps exige --cache-dir <chemin absolu> (ou GALAXY_ODE_CACHE), hors de tout dépôt'
      );
    return join(root, '.cache', 'ode-footprints');
  }
  if (!isAbsolute(chosen))
    throw new Error(`--cache-dir doit être un chemin absolu : ${chosen}`);
  const dir = resolve(chosen);
  const rel = relative(resolve(root), dir);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
    throw new Error(`--cache-dir est dans le dépôt (${root}) : ${dir}`);
  if (requireExternal && insideGitTree(dir))
    throw new Error(
      `--cache-dir est dans un dépôt ou un worktree git (un .git existe plus haut) : ${dir}`
    );
  return dir;
}

/**
 * Les métadonnées du cache décrivent TOUS les jeux, ou on s'arrête. `counts` : clé → nombre,
 * `redundancy` : clé → { verdict }, `unfrozen` : objet ou null s'il manque, `freezeOnDisk` : le
 * contenu de `freeze.json` ou null, `freeze` : le gel de ce script.
 */
export function assertMetadataComplete({
  list,
  counts,
  redundancy,
  unfrozen,
  freezeOnDisk,
  freeze,
}) {
  const problems = [];
  const missingCounts = list.filter((s) => !(s.key in counts));
  if (missingCounts.length)
    problems.push(
      `counts.json ne couvre pas ${missingCounts.length} jeu(x) (${missingCounts
        .slice(0, 3)
        .map((s) => s.key)
        .join(', ')}…) : fichier partiel`
    );
  const missingRed = list.filter((s) => !redundancy[s.key]?.verdict);
  if (missingRed.length)
    problems.push(
      `redundancy.json ne couvre pas ${missingRed.length} jeu(x) : fichier partiel`
    );
  if (unfrozen === null || unfrozen === undefined)
    problems.push(
      'unfrozen.json manque : les jeux sans date de création seraient comptés sous le gel (zéro produit)'
    );
  else
    for (const key of Object.keys(unfrozen))
      if (!(key in counts))
        problems.push(`unfrozen.json cite ${key}, inconnu de counts.json`);
  if (
    freezeOnDisk &&
    (freezeOnDisk.maxcreationtime !== freeze.maxcreationtime ||
      freezeOnDisk.mincreationtime !== freeze.mincreationtime)
  )
    problems.push(
      `freeze.json (${freezeOnDisk.maxcreationtime}) diffère du gel du script (${freeze.maxcreationtime}) : le cache mélangerait deux gels`
    );
  if (problems.length)
    throw new Error(
      `métadonnées du cache incohérentes, rien n'est tiré :\n  - ${problems.join('\n  - ')}`
    );
}

/**
 * Une seule collecte à la fois par cache : deux processus réécriraient `unavailable.json` l'un
 * sur l'autre. Serrure `collect.lock` portant le PID ; une serrure dont le processus est mort est
 * reprise. Renvoie une fonction de libération.
 */
export function acquireLock(cacheDir, { isAlive = pidAlive } = {}) {
  const path = join(cacheDir, 'collect.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(path, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(path, 'utf8'));
      if (Number.isFinite(pid) && pid > 0 && isAlive(pid))
        throw new Error(
          `une collecte est déjà en cours sur ce cache (PID ${pid}) : ${path}`,
          { cause: error }
        );
      rmSync(path, { force: true });
    }
  }
  throw new Error(`serrure impossible à prendre : ${path}`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
