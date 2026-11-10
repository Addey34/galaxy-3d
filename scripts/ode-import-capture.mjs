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
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic, TMP_SUFFIX } from './ode-pages.mjs';

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

/** Importe une capture. `write: false` : vérifie tout et n'écrit rien. Rend { status, imported, alreadyPresent }. */
export function importCapture({ cacheDir, mainFile, write = false, fs = {} }) {
  const link = fs.linkSync ?? linkSync;
  const { digest, files } = readCapture(mainFile);
  const dir = join(cacheDir, 'diagnostics');
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
  const created = [];
  try {
    for (const f of todo) {
      const tmp = `${f.dest}.${process.pid}.${randomBytes(4).toString('hex')}${TMP_SUFFIX}`;
      try {
        writeFileAtomic(tmp, f.data, { fs });
        try {
          link(tmp, f.dest);
        } catch (error) {
          if (error?.code === 'EEXIST')
            fail(
              `collision : ${f.dest} apparu pendant l'import, laissé intact`
            );
          fail(
            `publication par lien dur impossible (${error?.code ?? error?.message}) : aucun repli par copie`
          );
        }
        created.push(f.dest);
      } finally {
        rmSync(tmp, { force: true });
        rmSync(`${tmp}${TMP_SUFFIX}`, { force: true });
      }
      if (!readFileSync(f.dest).equals(f.data))
        fail(`copie relue différente : ${f.dest}`);
    }
  } catch (error) {
    for (const c of created) rmSync(c, { force: true });
    throw error;
  }
  return {
    status: 'imported',
    digest,
    imported: todo.map((t) => t.name),
    alreadyPresent: present,
  };
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
