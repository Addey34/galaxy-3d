/**
 * PAGES ODE : ÉCRITURE ATOMIQUE, REPRISE VÉRIFIÉE, ERREURS LOCALES SÉPARÉES (GAL-A003-04).
 *
 * Avant : une page était écrite directement sous son nom définitif. Un processus tué (ou un
 * disque plein) au milieu laissait un fichier TRONQUÉ que la reprise prenait pour acquis (« le
 * fichier existe »). Et toute exception du bloc de tirage, y compris un disque plein, déclarait
 * le JEU « indisponible » dans `unavailable.json`, comme si l'ODE l'avait refusé.
 *
 * Le contrat, testé dans `src/config/odePages.test.ts` :
 *   1. `writePageAtomic` écrit dans `<page>.tmp` du MÊME dossier, fsync, relit et valide le
 *      temporaire, puis le renomme sous son nom définitif (renommage atomique) ;
 *   2. `inspectExistingPages` valide chaque page présente (gzip entier, lignes JSON, `id`,
 *      `shapes`) avant de la tenir pour acquise, retire les temporaires abandonnés, et SIGNALE
 *      les pages invalides sans les supprimer : elles sont remplacées atomiquement une fois la
 *      nouvelle page validée (une page invalide non remplacée reste visible, jamais effacée) ;
 *   3. `classifyStorageError` sépare les erreurs LOCALES (disque plein, E/S, volume disparu,
 *      permissions) des erreurs de téléchargement ; `collectPages` arrête proprement la collecte
 *      sur une erreur locale et n'inscrit JAMAIS ce jeu dans `unavailable`.
 */
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export const TMP_SUFFIX = '.tmp';
export const pageName = (offset) => `${offset}.ndjson.gz`;

/** Codes d'erreur d'un stockage local (jamais ceux d'une réponse du serveur d'archive). */
export const LOCAL_STORAGE_CODES = new Set([
  'ENOSPC', // disque plein
  'EIO', // erreur d'entrée-sortie
  'EROFS', // volume en lecture seule
  'EACCES',
  'EPERM', // permissions
  'ENOENT', // dossier ou volume disparu
  'ENODEV',
  'ENXIO', // périphérique disparu
  'ENOTDIR',
  'EDQUOT', // quota
  'EBUSY',
  'EMFILE',
  'ENFILE',
  'EFBIG',
  'EUNKNOWN', // codes génériques de Windows pour une E/S échouée
]);

/** Une erreur de stockage local, distincte d'une erreur de téléchargement. */
export class LocalStorageError extends Error {
  constructor(operation, cause) {
    super(
      `stockage local (${operation}) : ${cause?.code ?? ''} ${cause?.message ?? cause}`,
      { cause }
    );
    this.name = 'LocalStorageError';
    this.code = cause?.code;
  }
}

/**
 * Une page lisible mais INCOMPLÈTE (trop courte, vide, excédentaire) ou incohérente (identifiants
 * en double). Ce n'est ni une panne de stockage ni un jeu indisponible : l'incomplétude est
 * DÉCLARÉE (`incomplete.json`), la page n'est jamais publiée comme complète.
 */
export class IncompletePageError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IncompletePageError';
    Object.assign(this, details);
  }
}

/** Vrai si l'erreur vient du système de fichiers local (et pas du réseau). */
export function isLocalStorageError(error) {
  if (error instanceof LocalStorageError) return true;
  const code = error?.code;
  return typeof code === 'string' && LOCAL_STORAGE_CODES.has(code);
}

/**
 * Valide le contenu d'une page : gzip ENTIER (un gzip tronqué lève), chaque ligne un JSON, chaque
 * produit avec un `id` et des `shapes`. Renvoie le nombre de produits ; lève sinon.
 */
export function validatePageBuffer(
  buffer,
  { expected, excludedIds, allowedIds } = {}
) {
  let text;
  try {
    text = gunzipSync(buffer).toString('utf8');
  } catch (error) {
    throw new Error(`gzip invalide (${error.code ?? error.message})`, {
      cause: error,
    });
  }
  let count = 0;
  const ids = new Set();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let product;
    try {
      product = JSON.parse(line);
    } catch (error) {
      throw new Error(`ligne ${count + 1} : JSON invalide`, { cause: error });
    }
    if (
      product === null ||
      typeof product !== 'object' ||
      product.id === undefined ||
      typeof product.shapes !== 'object' ||
      product.shapes === null
    )
      throw new Error(`ligne ${count + 1} : produit sans id ou sans shapes`);
    const id = String(product.id);
    // Un produit déclaré SANS géométrie par une réconciliation ne doit jamais figurer dans une page.
    if (excludedIds?.has(id))
      throw new IncompletePageError(
        `exclusion injustifiée : le produit ${id}, déclaré sans géométrie, figure dans la page`,
        { got: count + 1, distinct: ids.size, expected }
      );
    // Jeu réconcilié : les identifiants sont EXACTEMENT ceux du manifeste, pas seulement leur nombre.
    if (allowedIds && !allowedIds.has(id))
      throw new IncompletePageError(
        `identifiant non attendu : ${id} ne figure pas dans l'ensemble prouvé des empreintes`,
        { got: count + 1, distinct: ids.size, expected }
      );
    if (ids.has(id))
      throw new IncompletePageError(`identifiant en double : ${id}`, {
        got: count + 1,
        distinct: ids.size,
        expected,
      });
    ids.add(id);
    count++;
  }
  if (expected !== undefined && count !== expected)
    throw new IncompletePageError(
      `page ${count < expected ? 'incomplète' : 'excédentaire'} : ${count} produit(s) distinct(s) pour ${expected} attendu(s)`,
      { got: count, distinct: count, expected }
    );
  return count;
}

/** Valide un fichier de page déjà sur disque. Lève si absent, tronqué ou illisible. */
export function validatePageFile(file, options) {
  return validatePageBuffer(readFileSync(file), options);
}

/**
 * Écrit TOUT le tampon : `writeSync` peut écrire moins d'octets que demandé, ou aucun. Une
 * écriture qui n'avance plus est une défaillance LOCALE (EIO), jamais une boucle infinie.
 */
export function writeAll(fd, buffer, write = writeSync) {
  let offset = 0;
  while (offset < buffer.length) {
    const n = write(fd, buffer, offset, buffer.length - offset);
    if (!Number.isInteger(n) || n <= 0)
      throw Object.assign(
        new Error(
          `écriture interrompue : ${n} octet(s) écrit(s) à ${offset}/${buffer.length}`
        ),
        { code: 'EIO' }
      );
    offset += n;
  }
}

/**
 * Écrit une page sous son nom définitif, ATOMIQUEMENT. `hooks.afterStep(label)` sert aux tests
 * (exception ou SIGKILL simulés) : 'half-written', 'tmp-written', 'tmp-validated'.
 * Toute erreur du système de fichiers est relancée en LocalStorageError, le temporaire retiré.
 */
export function writePageAtomic(
  file,
  products,
  { hooks = {}, fs = {}, expected, excludedIds, allowedIds } = {}
) {
  const open = fs.openSync ?? openSync;
  const write = fs.writeSync ?? writeSync;
  const fsync = fs.fsyncSync ?? fsyncSync;
  const close = fs.closeSync ?? closeSync;
  const rename = fs.renameSync ?? renameSync;
  const step = (label) => hooks.afterStep?.(label);
  const tmp = `${file}${TMP_SUFFIX}`;
  const data = gzipSync(products.map((p) => JSON.stringify(p)).join('\n'));
  let fd = null;
  try {
    fd = open(tmp, 'w');
    const half = Math.floor(data.length / 2);
    writeAll(fd, data.subarray(0, half), write);
    step('half-written');
    writeAll(fd, data.subarray(half), write);
    fsync(fd);
    close(fd);
    fd = null;
    step('tmp-written');
    // Validation du TEMPORAIRE relu depuis le disque, avant toute publication.
    validatePageFile(tmp, { expected, excludedIds, allowedIds });
    step('tmp-validated');
    rename(tmp, file);
  } catch (error) {
    if (fd !== null) {
      try {
        close(fd);
      } catch {
        /* le descripteur est perdu avec le volume */
      }
    }
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best effort : un temporaire abandonné est retiré à la reprise */
    }
    // Une erreur de validation n'est pas une erreur de stockage ; celles du disque le sont.
    if (isLocalStorageError(error))
      throw new LocalStorageError('écriture', error);
    throw error;
  }
}

/**
 * Examine le dossier d'un jeu avant de reprendre. `offsets` : les décalages attendus.
 * Renvoie { valid: Set<number>, invalid: [{ offset, reason }], staleTmp: string[] }.
 * Les temporaires abandonnés (`*.tmp`) sont retirés : par construction ils sont incomplets ou en
 * attente de validation. Les pages INVALIDES ne sont PAS supprimées : elles sont signalées et
 * seront remplacées atomiquement après un nouveau téléchargement validé.
 */
export function inspectExistingPages(
  dir,
  offsets,
  expectedFor,
  excludedFor,
  allowedFor,
  { cleanTmp = true } = {}
) {
  const valid = new Set();
  const invalid = [];
  const staleTmp = [];
  if (!existsSync(dir)) return { valid, invalid, staleTmp };
  for (const name of readdirSync(dir))
    if (name.endsWith(TMP_SUFFIX)) {
      // `cleanTmp: false` : inspection strictement non destructive (dry-run), le temporaire est seulement signalé.
      if (cleanTmp) rmSync(join(dir, name), { force: true });
      staleTmp.push(name);
    }
  for (const offset of offsets) {
    const file = join(dir, pageName(offset));
    if (!existsSync(file)) continue;
    try {
      validatePageFile(file, {
        expected: expectedFor?.(offset),
        excludedIds: excludedFor?.(offset),
        allowedIds: allowedFor?.(offset),
      });
      valid.add(offset);
    } catch (error) {
      if (isLocalStorageError(error) && error.code !== 'ENOENT')
        throw new LocalStorageError('lecture', error);
      invalid.push({ offset, reason: error.message });
    }
  }
  return { valid, invalid, staleTmp };
}

/**
 * Tire les pages `tasks` ({ key, offset, file }) avec `concurrency` ouvriers.
 *   - `pull(task)` rend les produits ; ses erreurs sont des erreurs de TÉLÉCHARGEMENT : le jeu est
 *     déclaré indisponible (`markUnavailable`), comme avant ;
 *   - l'écriture d'une page ou de `unavailable.json` qui échoue pour une raison LOCALE arrête la
 *     collecte proprement (plus aucune page n'est prise) et n'inscrit JAMAIS le jeu.
 * Renvoie { done, failed, fatal } ; `fatal` est l'erreur locale ou null.
 */
export async function collectPages({
  tasks,
  pull,
  write = writePageAtomic,
  unavailable,
  markUnavailable,
  markIncomplete = () => {},
  concurrency = 2,
  onProgress = () => {},
}) {
  let done = 0;
  let failed = 0;
  let incomplete = 0;
  let fatal = null;
  const queue = [...tasks];
  const stop = (error) => {
    fatal ??= error;
  };
  const asLocal = (error, operation) =>
    error instanceof LocalStorageError
      ? error
      : new LocalStorageError(operation, error);
  /** Un échec de TÉLÉCHARGEMENT (ou de contenu reçu) : le jeu est déclaré indisponible. */
  function failDownload(task, error) {
    failed++;
    try {
      markUnavailable(task, error);
    } catch (storeError) {
      if (!isLocalStorageError(storeError)) throw storeError;
      stop(asLocal(storeError, 'unavailable.json'));
      return false;
    }
    done++;
    onProgress({ done, failed, queued: queue.length, task, error });
    return true;
  }
  async function worker() {
    while (queue.length && !fatal) {
      const task = queue.shift();
      if (unavailable[task.key]) {
        done++;
        continue;
      }
      let products;
      try {
        products = await pull(task);
      } catch (error) {
        // Une erreur du système de fichiers survenue pendant le tirage (marqueur méta, etc.)
        // reste locale : elle ne dit rien sur la disponibilité du jeu.
        if (isLocalStorageError(error)) {
          stop(asLocal(error, 'tirage'));
          break;
        }
        if (!failDownload(task, error)) break;
        continue;
      }
      try {
        write(task.file, products, {
          expected: task.expected,
          excludedIds: task.excludedIds,
          allowedIds: task.allowedIds,
        });
      } catch (error) {
        if (isLocalStorageError(error)) {
          stop(asLocal(error, 'écriture'));
          break;
        }
        if (error instanceof IncompletePageError) {
          // L'ODE n'a pas fourni tout ce qui est attendu : DÉCLARÉ, jamais masqué ni publié.
          incomplete++;
          try {
            markIncomplete(task, error);
          } catch (storeError) {
            if (!isLocalStorageError(storeError)) throw storeError;
            stop(asLocal(storeError, 'incomplete.json'));
            break;
          }
          done++;
          onProgress({ done, failed, queued: queue.length, task, error });
          continue;
        }
        // contenu reçu invalide (refusé par la validation avant publication) : échec de jeu
        if (!failDownload(task, error)) break;
        continue;
      }
      done++;
      onProgress({ done, failed, queued: queue.length, task });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { done, failed, incomplete, fatal, remaining: queue.length };
}

/** Écrit un petit fichier de métadonnées atomiquement (temporaire du même dossier, fsync, rename). */
export function writeFileAtomic(file, text, { fs = {} } = {}) {
  const write = fs.writeSync ?? writeSync;
  const tmp = `${file}${TMP_SUFFIX}`;
  let fd = null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    fd = openSync(tmp, 'w');
    writeAll(
      fd,
      Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'),
      write
    );
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmp, file);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* perdu avec le volume */
      }
    }
    rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * Publie un fichier SANS JAMAIS REMPLACER la destination. Le contenu est d'abord écrit et fsyncé
 * dans un temporaire PROPRE au processus (pid + aléa), puis publié :
 *   - par `link` quand le volume le permet : la destination apparaît entière ou pas du tout
 *     (ATOMIQUE), un seul gagnant, EEXIST pour les autres ;
 *   - sinon (volume sans liens physiques, exFAT) par `copyFile` en mode EXCLUSIF
 *     (`COPYFILE_EXCL`) : la création est exclusive (EEXIST si la destination existe, aucun
 *     écrasement possible, même en course) mais la COPIE N'EST PAS ATOMIQUE : un lecteur peut voir
 *     un fichier PARTIEL pendant la copie, ou après une interruption. Le lecteur doit donc refuser
 *     un fichier incomplet (c'est le cas du manifeste : JSON entier, structure et SHA-256 validés).
 * Propriété des fichiers : on ne supprime que ce qu'on a créé. Le temporaire est le nôtre ; la
 * destination n'est retirée que si NOTRE copie a réussi puis échoué à la relecture. Après une
 * erreur d'écriture non EEXIST, la destination éventuellement partielle est LAISSÉE (elle peut
 * n'être qu'à un autre processus) : elle est refusée à la lecture et se retire à la main.
 * Les temporaires d'autres processus ne sont jamais touchés. Lève une erreur EEXIST si la
 * destination existe.
 */
export function writeFileExclusive(file, data, { fs = {} } = {}) {
  const link = fs.linkSync ?? linkSync;
  const copy = fs.copyFileSync ?? copyFileSync;
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}${TMP_SUFFIX}`;
  try {
    writeFileAtomic(tmp, bytes, { fs });
    try {
      link(tmp, file);
    } catch (error) {
      if (!NO_HARDLINK_CODES.has(error?.code)) throw error;
      copy(tmp, file, constants.COPYFILE_EXCL);
      // Notre copie a réussi : la destination est la nôtre. On la relit ; si elle diffère, c'est
      // un fichier partiel que NOUS avons créé, on le retire et on échoue.
      let written = null;
      try {
        written = readFileSync(file);
      } catch {
        /* illisible : traité comme différent */
      }
      if (!written || !written.equals(bytes)) {
        rmSync(file, { force: true });
        throw Object.assign(
          new Error(`copie exclusive incomplète (${file}) : retirée`),
          { code: 'EIO' }
        );
      }
    }
  } finally {
    rmSync(tmp, { force: true });
  }
}
const NO_HARDLINK_CODES = new Set([
  'EPERM',
  'ENOSYS',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EXDEV',
]);

/** Code de sortie d'une collecte arrêtée sur une erreur locale (distinct des échecs de jeu). */
export const EXIT_LOCAL_STORAGE = 3;
