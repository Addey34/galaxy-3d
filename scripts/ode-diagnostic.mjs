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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalStorageError, writeFileAtomic } from './ode-pages.mjs';

export const DIAGNOSTICS_DIR = 'diagnostics';
export const diagnosticsDir = (cacheDir) => join(cacheDir, DIAGNOSTICS_DIR);

export const sha256 = (buffer) =>
  createHash('sha256').update(buffer).digest('hex');

const safeName = (key) => key.replace(/[^A-Za-z0-9_.-]+/g, '_');

/** Nom de base d'une quarantaine : jeu, offset, limite et instant (jamais écrasée). */
export function quarantineBase({ key, offset, limit, at }) {
  const stamp = at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${safeName(key)}@${offset}+${limit}-${stamp}`;
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
}) {
  const dir = diagnosticsDir(cacheDir);
  const at = now.toISOString();
  const base = quarantineBase({ key, offset, limit, at });
  const rawFile = join(dir, `${base}.raw`);
  const digest = sha256(raw);
  const provenance = {
    kind: 'quarantaine-brute-non-validee',
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
  };
  try {
    write(rawFile, raw);
    const back = readFileSync(rawFile);
    if (back.length !== raw.length || sha256(back) !== digest)
      throw Object.assign(
        new Error(`relecture de la quarantaine différente (${rawFile})`),
        { code: 'EIO' }
      );
    write(`${rawFile}.sha256`, `${digest}  ${base}.raw\n`);
    write(`${rawFile}.json`, JSON.stringify(provenance, null, 1) + '\n');
  } catch (error) {
    throw error instanceof LocalStorageError
      ? error
      : new LocalStorageError('quarantaine diagnostique', error);
  }
  return { rawFile, sha256: digest, base, dir };
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
