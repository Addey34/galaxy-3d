#!/usr/bin/env node
/* global console, process */
/**
 * IMPORT D'UNE CAPTURE CONSERVÉE VERS `<cache>/diagnostics/` (GAL-A003-06K, proposition). Aucune requête.
 *
 * La réconciliation cherche ses deux sources sous `<cache>/diagnostics/` (`readSource`, `verifySources`) et les
 * revérifie à CHAQUE chargement. Des captures conservées ailleurs (autre volume, sauvegarde) doivent donc y être
 * rendues disponibles, sans jamais altérer les originaux :
 *   - les originaux ne sont qu'OUVERTS EN LECTURE ; leur SHA-256 est vérifié contre le fichier `.sha256` ET la
 *     provenance AVANT toute copie ;
 *   - trois fichiers par capture (contenu, provenance, somme), copiés avec leur NOM d'origine ;
 *   - rien n'est jamais écrasé : une destination déjà présente et identique octet pour octet est « déjà présente »,
 *     toute autre est une collision qui REFUSE tout l'import (contrôle fait avant la première écriture) ;
 *   - chaque fichier est écrit dans un temporaire à nom unique puis publié par LIEN DUR (atomique, exclusif, sans
 *     repli par copie) ; le contenu principal est publié EN DERNIER, de sorte que sa présence implique celle de sa
 *     provenance et de sa somme ; la copie est relue et son SHA-256 revérifié ;
 *   - en cas d'échec, seuls les fichiers créés par CET appel sont retirés.
 *
 *   node ode-import-capture.mjs --cache-dir <abs> --source <fichier principal> [--write]    (mode sec par défaut)
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TMP_SUFFIX } from './ode-pages.mjs';
import { resolveCacheDir } from './ode-selection.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export class ImportError extends Error {}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const fail = (m) => {
  throw new ImportError(m);
};

/** Lit et VÉRIFIE une capture (contenu, provenance, somme). Rend les trois fichiers sous forme d'octets. */
export function readCapture(mainFile) {
  if (!mainFile || !existsSync(mainFile))
    fail(`capture introuvable : ${mainFile}`);
  const provFile = mainFile.endsWith('.raw')
    ? `${mainFile}.json`
    : `${mainFile}.provenance.json`;
  const sumFile = `${mainFile}.sha256`;
  for (const f of [provFile, sumFile])
    if (!existsSync(f)) fail(`fichier associé absent : ${f}`);
  const main = readFileSync(mainFile);
  const prov = readFileSync(provFile);
  const sum = readFileSync(sumFile);
  const digest = sha(main);
  let provenance;
  try {
    provenance = JSON.parse(prov.toString('utf8'));
  } catch (e) {
    fail(`provenance illisible : ${e.message}`);
  }
  if (sum.toString('utf8').trim().split(/\s+/)[0] !== digest)
    fail('SHA-256 du contenu différent du fichier .sha256');
  if (provenance.sha256 !== digest)
    fail('SHA-256 du contenu différent de la provenance');
  if (provenance.receivedBytes !== main.length)
    fail('taille du contenu différente de la provenance');
  return {
    digest,
    files: [
      { name: basename(provFile), data: prov },
      { name: basename(sumFile), data: sum },
      { name: basename(mainFile), data: main },
    ],
  };
}

/**
 * Destination : chemin ABSOLU, HORS du dépôt et de tout worktree git (protections de `resolveCacheDir`), dossier
 * existant qui est bien un cache de collecte (`counts.json`), `diagnostics/` jamais un lien symbolique, et la
 * source n'est pas déjà un fichier de la destination. Rend le dossier résolu.
 */
export function checkDestination(cacheDir, mainFile) {
  if (typeof cacheDir !== 'string' || cacheDir === '')
    fail('--cache-dir exige un chemin absolu');
  let dir;
  try {
    dir = resolveCacheDir({
      arg: cacheDir,
      env: null,
      root: ROOT,
      requireExternal: true,
    });
  } catch (error) {
    fail(error.message);
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    fail(`destination absente ou non dossier : ${dir}`);
  // Chemin CANONIQUE : une jonction ou un lien situé hors dépôt peut pointer vers un dossier d'un dépôt git.
  // Les protections de destination externe s'appliquent donc aussi à la cible réelle, et c'est elle qu'on utilise.
  const canonical = realpathSync(dir);
  if (canonical !== dir) {
    try {
      resolveCacheDir({
        arg: canonical,
        env: null,
        root: ROOT,
        requireExternal: true,
      });
    } catch (error) {
      fail(`${error.message} (cible réelle de ${dir})`);
    }
    dir = canonical;
  }
  if (!existsSync(join(dir, 'counts.json')))
    fail(`${dir} n'est pas un cache de collecte (counts.json absent)`);
  const diag = join(dir, 'diagnostics');
  if (existsSync(diag) && lstatSync(diag).isSymbolicLink())
    fail(`${diag} est un lien symbolique : refusé`);
  if (existsSync(mainFile)) {
    const real = realpathSync(mainFile).toLowerCase();
    const inside = realpathSync(dir).toLowerCase();
    if (real.startsWith(`${inside}${sep}`.toLowerCase()))
      fail('la source est déjà dans le cache de destination');
  }
  return dir;
}

/**
 * Écrit `data` dans un temporaire créé EXCLUSIVEMENT (`wx`), fsyncé. Une erreur ferme le descripteur et tente de
 * retirer le temporaire, sans JAMAIS masquer l'erreur d'origine (un retrait raté est rendu dans `leftovers`).
 */
function writeTemp(tmp, data, fs, leftovers) {
  const open = fs.openSync ?? openSync;
  const write = fs.writeSync ?? writeSync;
  const fsync = fs.fsyncSync ?? fsyncSync;
  const close = fs.closeSync ?? closeSync;
  let fd = null;
  try {
    fd = open(tmp, 'wx');
    let at = 0;
    while (at < data.length) {
      const n = write(fd, data, at, data.length - at);
      if (!(n > 0))
        throw Object.assign(new Error('écriture nulle'), { code: 'EIO' });
      at += n;
    }
    fsync(fd);
    const done = fd;
    fd = null;
    close(done);
  } catch (error) {
    if (fd !== null) {
      try {
        close(fd);
      } catch {
        /* le descripteur est perdu avec le volume */
      }
    }
    try {
      (fs.rmSync ?? rmSync)(tmp, { force: true });
    } catch (e) {
      leftovers.push(`${tmp} (${e?.code ?? e?.message})`);
    }
    throw error;
  }
}

/**
 * Importe une capture. `write: false` : vérifie tout et n'écrit rien. Rend { status, imported, alreadyPresent }.
 * Garanties (GAL-A003-11B) :
 *   - ordre de publication : provenance, somme, puis le contenu principal ;
 *   - une erreur de NETTOYAGE ne masque jamais l'erreur d'origine : elle est ajoutée au message ;
 *   - un lien réussi suivi d'un temporaire impossible à retirer est un ÉCHEC (le fichier porterait deux noms) ;
 *   - le retour arrière ne retire un fichier que s'il est bien celui que CET appel a lié (même inode) ; sinon il est
 *     laissé et signalé ;
 *   - un retour arrière impossible est annoncé « ÉTAT PARTIEL, intervention manuelle », avec les chemins.
 */
export function importCapture({ cacheDir, mainFile, write = false, fs = {} }) {
  const link = fs.linkSync ?? linkSync;
  const rm = fs.rmSync ?? rmSync;
  const stat = fs.statSync ?? statSync;
  const read = fs.readFileSync ?? readFileSync;
  const cache = checkDestination(cacheDir, mainFile);
  const { digest, files } = readCapture(mainFile);
  const dir = join(cache, 'diagnostics');
  const todo = [];
  const present = [];
  for (const f of files) {
    const dest = join(dir, f.name);
    if (existsSync(dest)) {
      if (!readFileSync(dest).equals(f.data))
        fail(
          `collision : ${dest} existe avec un contenu différent, rien n'est écrit`
        );
      present.push(f.name);
    } else todo.push({ ...f, dest });
  }
  if (!write)
    return {
      status: 'dry-run',
      digest,
      imported: todo.map((t) => t.name),
      alreadyPresent: present,
    };
  mkdirSync(dir, { recursive: true });
  const created = []; // { dest, ino, size } : ce que CET appel a lié
  const leftovers = [];
  let failure = null;
  for (const f of todo) {
    const tmp = `${f.dest}.${process.pid}.${randomBytes(4).toString('hex')}${TMP_SUFFIX}`;
    try {
      writeTemp(tmp, f.data, fs, leftovers);
      const ino = stat(tmp, { bigint: true }).ino;
      try {
        link(tmp, f.dest);
      } catch (error) {
        if (error?.code === 'EEXIST')
          fail(`collision : ${f.dest} apparu pendant l'import, laissé intact`);
        fail(
          `publication par lien dur impossible (${error?.code ?? error?.message}) : aucun repli par copie`
        );
      }
      created.push({ dest: f.dest, ino, size: f.data.length });
    } catch (e) {
      failure = e;
    }
    try {
      rm(tmp, { force: true });
    } catch (e) {
      leftovers.push(`${tmp} (${e?.code ?? e?.message})`);
    }
    if (failure) break;
    if (leftovers.length) {
      failure = new ImportError(
        `temporaire non retiré après le lien de ${f.dest} : le fichier porterait plusieurs noms`
      );
      break;
    }
    try {
      if (!read(f.dest).equals(f.data))
        throw new ImportError(`copie relue différente : ${f.dest}`);
    } catch (e) {
      failure = e;
      break;
    }
  }
  if (!failure)
    return {
      status: 'imported',
      digest,
      imported: todo.map((t) => t.name),
      alreadyPresent: present,
    };
  // Retour arrière, du dernier fichier créé au premier (le principal d'abord). Seul un fichier dont l'inode est celui
  // que nous avons lié est retiré ; tout autre est laissé en place et signalé.
  const stuck = [];
  for (const c of created.reverse()) {
    try {
      let ino;
      try {
        ino = stat(c.dest, { bigint: true }).ino;
      } catch (e) {
        if (e?.code === 'ENOENT') continue;
        throw e;
      }
      if (ino !== c.ino) {
        stuck.push(`${c.dest} (n'est plus notre fichier : laissé)`);
        continue;
      }
      rm(c.dest, { force: true });
    } catch (e) {
      stuck.push(`${c.dest} (${e?.code ?? e?.message})`);
    }
  }
  if (!stuck.length && !leftovers.length) throw failure;
  const extra = [
    stuck.length ? `fichier(s) non retiré(s) : ${stuck.join(', ')}` : null,
    leftovers.length
      ? `temporaire(s) non retiré(s), à retirer à la main : ${leftovers.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' ; ');
  throw new ImportError(
    stuck.length
      ? `ÉTAT PARTIEL, intervention manuelle : ${failure.message} ; ${extra}`
      : `${failure.message} ; en plus, ${extra}`,
    { cause: failure }
  );
}

function main() {
  const argv = process.argv.slice(2);
  const val = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  try {
    const r = importCapture({
      cacheDir: val('--cache-dir'),
      mainFile: val('--source'),
      write: argv.includes('--write'),
    });
    console.log(JSON.stringify(r, null, 1));
  } catch (e) {
    console.error(`REFUS : ${e.message}`);
    process.exit(e instanceof ImportError ? 1 : 2);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
void dirname;
