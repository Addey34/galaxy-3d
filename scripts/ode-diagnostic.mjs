/**
 * QUARANTAINE DU BRUT ODE, EN MODE DIAGNOSTIC EXPLICITE (GAL-A003-05C).
 *
 * `--diagnostic` conserve la réponse HTTP `coveragetargz` ORIGINALE, avant toute transformation,
 * sous `<cache>/diagnostics/` (jamais dans `pages/`, jamais lue comme une page validée), avec sa
 * somme SHA-256 et ses métadonnées de provenance, plus l'analyse avant regroupement. Chaque écriture
 * est atomique (temporaire du même dossier, fsync, renommage) et relue pour vérifier la somme.
 * Toute erreur d'écriture est une erreur de STOCKAGE LOCAL : elle interrompt proprement la collecte
 * (`collectPages`) et n'inscrit aucun jeu dans `unavailable.json`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LocalStorageError, writeFileAtomic } from './ode-pages.mjs';

export const DIAGNOSTICS_DIR = 'diagnostics';
export const diagnosticsDir = (cacheDir) => join(cacheDir, DIAGNOSTICS_DIR);

export const sha256 = (buffer) =>
  createHash('sha256').update(buffer).digest('hex');

const safeName = (key) => key.replace(/[^A-Za-z0-9_.-]+/g, '_');

/** Aléa d'un identifiant de capture (injectable pour les tests de collision). */
export const randomCaptureSuffix = () => randomBytes(4).toString('hex');

/** Tentatives de réservation d'un identifiant de capture avant d'abandonner. */
export const MAX_CAPTURE_ATTEMPTS = 8;

/**
 * Nom de base d'une capture : jeu, offset, limite, instant ET suffixe aléatoire. C'est le même
 * identifiant pour le brut, la somme, la provenance et l'analyse.
 */
export function quarantineBase({ key, offset, limit, at, suffix }) {
  const stamp = at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${safeName(key)}@${offset}+${limit}-${stamp}-${suffix}`;
}

/**
 * RÉSERVE un identifiant de capture par création EXCLUSIVE du fichier brut (`wx` : O_CREAT|O_EXCL,
 * atomique, sans dépendre d'un `existsSync`). Deux appels au même instant, ou deux processus, ne
 * peuvent pas obtenir le même identifiant : le perdant tire un nouveau suffixe. Le fichier réservé
 * est vide jusqu'à son remplacement atomique par le brut, que nous seuls avons le droit d'écrire.
 */
export function reserveCapture({
  dir,
  key,
  offset,
  limit,
  at,
  suffixFn = randomCaptureSuffix,
}) {
  mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt++) {
    const base = quarantineBase({ key, offset, limit, at, suffix: suffixFn() });
    const rawFile = join(dir, `${base}.raw`);
    try {
      closeSync(openSync(rawFile, 'wx'));
      return { base, rawFile };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw Object.assign(
    new Error(
      `aucun identifiant de capture libre après ${MAX_CAPTURE_ATTEMPTS} tentatives (${dir})`
    ),
    { code: 'EEXIST' }
  );
}

/**
 * Écrit le brut + `.sha256` (format `sha256sum`) + `.json` de provenance. `write` est injectable
 * pour les tests. Rend les chemins écrits ; lève LocalStorageError sur n'importe quel échec.
 */
export function quarantineRaw({
  cacheDir,
  raw,
  key,
  offset,
  limit,
  freeze,
  http,
  query = null,
  now = new Date(),
  write = writeFileAtomic,
  suffixFn = randomCaptureSuffix,
}) {
  const dir = diagnosticsDir(cacheDir);
  const at = now.toISOString();
  const digest = sha256(raw);
  let reserved = null;
  const makeProvenance = (base) => ({
    kind: 'quarantaine-brute-non-validee',
    captureId: base,
    dataset: key,
    offset,
    limit,
    freeze,
    query,
    http,
    receivedBytes: raw.length,
    sha256: digest,
    retrievedAt: at,
    note: 'réponse coveragetargz originale, avant transformation ; ce n’est PAS une page validée',
  });
  try {
    reserved = reserveCapture({ dir, key, offset, limit, at, suffixFn });
    const { base, rawFile } = reserved;
    write(rawFile, raw);
    const back = readFileSync(rawFile);
    if (back.length !== raw.length || sha256(back) !== digest)
      throw Object.assign(
        new Error(`relecture de la quarantaine différente (${rawFile})`),
        { code: 'EIO' }
      );
    write(`${rawFile}.sha256`, `${digest}  ${base}.raw\n`);
    write(
      `${rawFile}.json`,
      JSON.stringify(makeProvenance(base), null, 1) + '\n'
    );
    return { rawFile, sha256: digest, base, dir };
  } catch (error) {
    // Le fichier RÉSERVÉ vide n'est pas une capture : il est retiré s'il n'a jamais reçu le brut.
    if (reserved) {
      try {
        if (readFileSync(reserved.rawFile).length === 0)
          rmSync(reserved.rawFile, { force: true });
      } catch {
        /* rien à retirer */
      }
    }
    throw error instanceof LocalStorageError
      ? error
      : new LocalStorageError('quarantaine diagnostique', error);
  }
}

/** Écrit l'analyse avant regroupement à côté du brut (même atomicité, même règle d'erreur). */
export function writeAnalysis({
  dir,
  base,
  analysis,
  write = writeFileAtomic,
}) {
  const file = join(dir, `${base}.analysis.json`);
  try {
    write(file, JSON.stringify(analysis, null, 1) + '\n');
  } catch (error) {
    throw error instanceof LocalStorageError
      ? error
      : new LocalStorageError('analyse diagnostique', error);
  }
  return file;
}

/** Une ligne de console quand les enregistrements de formes dépassent les produits regroupés. */
export function describeGap(analysis) {
  if (!analysis) return null;
  if (analysis.totalRecords === analysis.productsAfterGrouping) return null;
  return (
    `ECART enregistrements/produits : ${analysis.totalRecords} enregistrement(s) de formes ` +
    `(${Object.entries(analysis.recordsByKind)
      .map(([k, n]) => `g${k}=${n}`)
      .join(
        ', '
      )}) pour ${analysis.productsAfterGrouping} ODEId distinct(s) ; ` +
    `${analysis.repeatedTotal} identifiant(s) répété(s), ${analysis.emptyIds.count} vide(s), ` +
    `${analysis.invalidIds.count} invalide(s), ${analysis.inconsistentTotal} incohérent(s)`
  );
}
