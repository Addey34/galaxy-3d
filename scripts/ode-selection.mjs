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
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * Le gel temporel : un jour déjà fini (l'ODE lit `maxcreationtime=AAAA-MM-JJ` comme la FIN de ce
 * jour). Source unique, relue par le précontrôle et confrontée à l'index livré.
 */
export const FREEZE = {
  mincreationtime: '1900-01-01',
  maxcreationtime: '2026-09-29',
};
/** Produits par page tirée. */
export const PAGE = 5000;
/** Base de métadonnées de l'ODE → cible. */
export const TARGET = {
  Moon: 'moon',
  Mars: 'mars',
  Mercury: 'mercury',
  Venus: 'venus',
};

/** Les jeux à empreintes, une ligne par CLÉ (la liste de l'ODE répète une clé par DataSetId). */
export function datasetsFromIipt(raw) {
  const sets = raw.ODEResults.IIPTSets.IIPTSet.filter(
    (s) => s.ValidFootprints === 'T'
  );
  const keys = new Map();
  for (const s of sets) {
    const k = [s.ODEMetaDB, s.IHID, s.IID, s.PT].join('|');
    if (!keys.has(k) && TARGET[s.ODEMetaDB])
      keys.set(k, {
        key: k,
        db: s.ODEMetaDB,
        target: TARGET[s.ODEMetaDB],
        IHID: s.IHID,
        IID: s.IID,
        PT: s.PT,
        mission: s.IHName,
        instrument: s.IName,
        minObs: s.MinObservationTime,
        maxObs: s.MaxObservationTime,
      });
  }
  return [...keys.values()];
}

/** Les corps qu'une collecte peut viser, dans l'ordre voulu (Mercure d'abord, plus petit). */
export const COLLECTABLE_BODIES = ['mercury', 'mars'];

/**
 * Valeur d'une option `--nom valeur`. Absente : null. Présente SANS valeur (argument final) ou
 * suivie d'une autre option (`--dataset --plan`) : erreur, jamais une valeur silencieusement
 * lue dans l'argument suivant ni un « option absente ».
 */
export function optionValue(argv, name) {
  const at = argv.indexOf(name);
  if (at === -1) return null;
  const value = argv[at + 1];
  if (value === undefined || value === '' || value.startsWith('-'))
    throw new Error(`${name} exige une valeur`);
  return value;
}

/** Les métadonnées dont un pilote a besoin, lues du cache et JAMAIS récupérées en ligne. */
export const PILOT_METADATA = [
  'iipt.json',
  'counts.json',
  'redundancy.json',
  'unfrozen.json',
  'freeze.json',
];

/** Lève, avant toute requête, si une métadonnée du pilote manque dans le cache. */
export function assertLocalMetadata(cacheDir, exists = existsSync) {
  const missing = PILOT_METADATA.filter((f) => !exists(join(cacheDir, f)));
  if (missing.length)
    throw new Error(
      `métadonnées absentes du cache (${missing.join(', ')}) : un pilote (--dataset / --max-pages) ne les récupère jamais en ligne ; les fournir (copie) ou lancer une collecte normale`
    );
}

/**
 * `--dataset <clé>` : syntaxe d'une clé de jeu (`Corps|MISSION|INSTRUMENT|TYPE`, quatre segments
 * non vides, sans espace de bord). Vérifiée AVANT toute requête, sans la liste des jeux. Rend la
 * clé, ou null si l'option est absente ; lève sinon.
 */
export function parseDatasetArg(value) {
  if (value === null || value === undefined) return null;
  const parts = String(value).split('|');
  if (parts.length !== 4 || parts.some((p) => p === '' || p !== p.trim()))
    throw new Error(
      `--dataset ${JSON.stringify(value)} : clé invalide (attendu Corps|MISSION|INSTRUMENT|TYPE, quatre segments non vides)`
    );
  return String(value);
}

/** `--max-pages <n>` : entier strictement positif, ou null si absent. */
export function parseMaxPages(value) {
  if (value === null || value === undefined) return null;
  if (
    !/^[1-9][0-9]*$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new Error(
      `--max-pages ${JSON.stringify(value)} : entier strictement positif et sûr (≤ ${Number.MAX_SAFE_INTEGER}) attendu`
    );
  return Number(value);
}

/** Refuse la collecte si plus de pages que la limite sont à télécharger (avant toute requête). */
export function assertMaxPages(pagesToDownload, maxPages) {
  if (maxPages !== null && pagesToDownload > maxPages)
    throw new Error(
      `${pagesToDownload} page(s) à télécharger pour --max-pages ${maxPages} : collecte refusée, rien n'est tiré`
    );
}

/**
 * Jeux retenus : cible == `body` (strict), puis IHID == `only` si donné, puis clé == `dataset`
 * (égalité exacte) si donnée. Lève si `body` est absent ou inconnu, si la clé n'existe pas ou
 * appartient à un autre corps, ou si la sélection est vide (une faute de frappe ne doit pas
 * ressembler à « rien à tirer »).
 */
export function selectDatasets(list, { body, only = null, dataset = null }) {
  if (!body)
    throw new Error(
      `--body est obligatoire pour une collecte (${COLLECTABLE_BODIES.join(', ')})`
    );
  if (!COLLECTABLE_BODIES.includes(body))
    throw new Error(
      `--body ${body} : corps inconnu (${COLLECTABLE_BODIES.join(', ')})`
    );
  if (dataset !== null) {
    const found = list.find((s) => s.key === dataset);
    if (!found) throw new Error(`--dataset ${dataset} : clé absente des jeux`);
    if (found.target !== body)
      throw new Error(
        `--dataset ${dataset} appartient à ${found.target}, pas à --body ${body}`
      );
  }
  const picked = list.filter(
    (s) =>
      s.target === body &&
      (only === null || s.IHID === only) &&
      (dataset === null || s.key === dataset)
  );
  if (picked.length === 0)
    throw new Error(
      `aucun jeu pour --body ${body}${only ? ` --only ${only}` : ''}${dataset ? ` --dataset ${dataset}` : ''}`
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

/** Ce qui prouve qu'un cache contient déjà une collecte ou ses métadonnées (datées d'un gel). */
const COLLECTION_TRACES = [
  'counts.json',
  'redundancy.json',
  'unfrozen.json',
  'unavailable.json',
  'meta-only.json',
  'pages',
];

/**
 * `freeze.json` n'est JAMAIS recréé dans un cache qui contient déjà des données ou des
 * métadonnées : le gel d'une collecte ne se devine pas, il se lit. Un cache vierge (ou réduit à
 * `iipt.json`, qui ne dépend pas du gel) reçoit celui du script ; sinon l'absence est une erreur.
 * Renvoie 'present', 'create' ou lève.
 */
export function freezeAction(cacheDir) {
  if (existsSync(join(cacheDir, 'freeze.json'))) return 'present';
  const traces = COLLECTION_TRACES.filter((n) => existsSync(join(cacheDir, n)));
  if (traces.length)
    throw new Error(
      `freeze.json manque dans un cache qui contient déjà ${traces.join(', ')} : le gel de cette collecte est inconnu, rien n'est recréé. Restaurer freeze.json depuis la sauvegarde, ou repartir d'un cache vide.`
    );
  return 'create';
}

/**
 * Vrai si l'on peut écrire dans `dir` : un dossier existant reçoit un fichier d'essai puis le
 * retire ; un dossier absent est jugé sur son plus proche ancêtre existant (qui doit être un
 * dossier inscriptible), SANS rien créer. Renvoie { ok, detail }.
 */
export function canWriteInto(dir) {
  let target = dir;
  let willCreate = false;
  while (!existsSync(target)) {
    const up = dirname(target);
    if (up === target) return { ok: false, detail: `aucun ancêtre : ${dir}` };
    target = up;
    willCreate = true;
  }
  try {
    if (!statSync(target).isDirectory())
      return { ok: false, detail: `${target} n'est pas un dossier` };
    const probe = join(target, `.ode-write-probe-${process.pid}`);
    writeFileSync(probe, 'x');
    rmSync(probe, { force: true });
    return {
      ok: true,
      detail: willCreate ? `sera créé sous ${target}` : `inscriptible : ${dir}`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `écriture refusée dans ${target} : ${error.code ?? error.message}`,
    };
  }
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
