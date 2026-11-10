#!/usr/bin/env node
/* global console, process */
/**
 * RÉCONCILIATION ET REJEU HORS RÉSEAU d'un jeu ODE (GAL-A003-05F). Ce script ne fait AUCUNE
 * requête : il lit le cache et sa quarantaine `diagnostics/`.
 *
 *   build   --cache-dir <abs> --dataset <clé> --metadata <fichier.json> --coverage <fichier.raw>
 *           écrit `<cache>/reconciliation/<jeu>.json` à partir des DEUX réponses brutes déjà
 *           conservées (SHA-256 vérifié), ou refuse. Ne modifie aucune métadonnée du cache.
 *   replay  --cache-dir <abs> --dataset <clé> [--dry-run]
 *           rejoue la capture `coveragetargz` conservée par le chemin NORMAL (parsing puis écriture
 *           atomique et validée de `pages/<jeu>/0.ndjson.gz`). La quarantaine n'est jamais copiée
 *           telle quelle : elle n'est pas une page validée. `--dry-run` vérifie tout et n'écrit rien.
 *
 * Seuls les jeux d'UNE page sont couverts. `incomplete.json` n'est PAS modifié : la prochaine
 * exécution normale du collecteur le reconstruit.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCoverageArchive } from './ode-coverage.mjs';
import { FREEZE, PAGE, resolveCacheDir } from './ode-selection.mjs';
import {
  inspectExistingPages,
  pageName,
  writeFileExclusive,
  writePageAtomic,
} from './ode-pages.mjs';
import {
  ReconciliationError,
  buildManifest,
  hasGeometry,
  loadReconciliation,
  manifestPath,
  readCatalogue,
} from './ode-reconciliation.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const safe = (k) => k.replace(/[^A-Za-z0-9_.-]+/g, '_');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/** Lit une source de la quarantaine : octets, provenance et somme du fichier `.sha256`. */
export function readSource(cacheDir, file) {
  const dir = join(cacheDir, 'diagnostics');
  const provenanceFile = file.endsWith('.raw')
    ? `${file}.json`
    : `${file}.provenance.json`;
  const sidecar = readFileSync(join(dir, `${file}.sha256`), 'utf8');
  return {
    file,
    buffer: readFileSync(join(dir, file)),
    provenance: readJson(join(dir, provenanceFile)),
    sidecarSha256: sidecar.trim().split(/\s+/)[0],
  };
}

/** Écrit le manifeste d'un jeu (jamais d'écrasement). Rend { manifest, file }. */
export function buildReconciliation({
  cacheDir,
  key,
  metadataFile,
  coverageFile,
  now = new Date(),
}) {
  const file = manifestPath(cacheDir, key);
  const exists = () =>
    new ReconciliationError(
      `un manifeste existe déjà (${file}) : il n'est jamais écrasé`
    );
  // Refus rapide ; la garantie réelle est la publication exclusive ci-dessous (course entre processus).
  if (existsSync(file)) throw exists();
  const counts = readJson(join(cacheDir, 'counts.json'));
  if (!(key in counts))
    throw new ReconciliationError(`${key} absent de counts.json`);
  const manifest = buildManifest({
    key,
    freeze: FREEZE,
    pageSize: PAGE,
    catalogueCount: counts[key],
    metadata: readSource(cacheDir, metadataFile),
    coverage: readSource(cacheDir, coverageFile),
    now,
  });
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileExclusive(file, JSON.stringify(manifest, null, 1) + '\n');
  } catch (error) {
    if (error?.code === 'EEXIST') throw exists();
    throw error;
  }
  return { manifest, file };
}

/**
 * Rejeu hors réseau de la capture conservée. Toute divergence est un refus ; `dryRun` n'écrit rien.
 * Rend { status: 'dry-run' | 'written' | 'already-valid', … }.
 */
export function replayReconciled({ cacheDir, key, dryRun = false }) {
  const counts = readJson(join(cacheDir, 'counts.json'));
  const freeze = {
    mincreationtime: FREEZE.mincreationtime,
    maxcreationtime: readJson(join(cacheDir, 'freeze.json')).maxcreationtime,
  };
  const rec = loadReconciliation({
    cacheDir,
    key,
    freeze,
    catalogueCount: counts[key],
    pageSize: PAGE,
  });
  if (!rec)
    throw new ReconciliationError(`aucun manifeste pour ${key} : rejeu refusé`);
  const { manifest } = rec;
  const problems = [];
  // 1. la capture : jeu, gel, offset (SHA-256 déjà revérifié par loadReconciliation)
  const coverage = readSource(cacheDir, manifest.sources.coverage.file);
  const cp = coverage.provenance;
  if (cp.dataset !== key) problems.push(`capture : jeu ${cp.dataset}`);
  if (cp.offset !== 0) problems.push(`capture : offset ${cp.offset}`);
  if (
    cp.freeze?.mincreationtime !== freeze.mincreationtime ||
    cp.freeze?.maxcreationtime !== freeze.maxcreationtime
  )
    problems.push('capture : gel différent');
  // 2. les exclusions, relues dans la réponse de métadonnées conservée
  const meta = readSource(cacheDir, manifest.sources.metadata.file);
  const cat = readCatalogue(meta.buffer);
  problems.push(...cat.problems);
  const byId = new Map(cat.products.map((p) => [p.id, p]));
  for (const e of manifest.excluded) {
    const p = byId.get(e.odeId);
    if (!p) problems.push(`exclu ${e.odeId} absent des métadonnées conservées`);
    else if (p.geometry)
      problems.push(`exclu ${e.odeId} : géométrie finalement présente`);
    else if (p.productId !== e.productId)
      problems.push(`exclu ${e.odeId} : ProductId ${p.productId} différent`);
  }
  for (const id of manifest.footprintIds)
    if (!byId.get(id)?.geometry)
      problems.push(`empreinte ${id} sans géométrie dans les métadonnées`);
  if (cat.products.length !== manifest.counts.catalogued)
    problems.push(
      `${cat.products.length} produits catalogués pour ${manifest.counts.catalogued}`
    );
  // 3. le parsing NORMAL de la capture : exactement les identifiants attendus
  const { products } = parseCoverageArchive(coverage.buffer, key, 0);
  const got = new Set(products.map((p) => String(p.id)));
  if (got.size !== products.length) problems.push('identifiants en double');
  if (got.size !== rec.footprintIds.size)
    problems.push(
      `${got.size} identifiants pour ${rec.footprintIds.size} attendus`
    );
  for (const id of rec.footprintIds)
    if (!got.has(id)) problems.push(`identifiant attendu absent : ${id}`);
  for (const id of got)
    if (!rec.footprintIds.has(id))
      problems.push(`identifiant inattendu : ${id}`);
  for (const id of rec.excludedIds)
    if (got.has(id)) problems.push(`exclu ${id} présent dans la capture`);
  if (problems.length) throw new ReconciliationError(problems);

  const dir = join(cacheDir, 'pages', safe(key));
  const file = join(dir, pageName(0));
  const summary = {
    dataset: key,
    catalogued: rec.catalogued,
    withFootprint: rec.footprints,
    withoutGeometry: [...rec.excludedIds],
    page: file,
    coverageSha256: manifest.sources.coverage.sha256,
    metadataSha256: manifest.sources.metadata.sha256,
  };
  const existing = inspectExistingPages(
    dir,
    [0],
    () => rec.footprints,
    () => rec.excludedIds,
    () => rec.footprintIds,
    // dry-run : inspection strictement non destructive (aucun temporaire retiré)
    { cleanTmp: !dryRun }
  );
  if (existing.valid.has(0)) return { status: 'already-valid', ...summary };
  if (dryRun) return { status: 'dry-run', ...summary };
  mkdirSync(dir, { recursive: true });
  writePageAtomic(file, products, {
    expected: rec.footprints,
    excludedIds: rec.excludedIds,
    allowedIds: rec.footprintIds,
  });
  return { status: 'written', ...summary };
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const value = (name) => {
    const at = argv.indexOf(name);
    if (at === -1) return null;
    const v = argv[at + 1];
    if (v === undefined || v.startsWith('-'))
      throw new Error(`${name} exige une valeur`);
    return v;
  };
  try {
    const cacheDir = resolveCacheDir({
      arg: value('--cache-dir'),
      env: process.env.GALAXY_ODE_CACHE ?? null,
      root: ROOT,
      requireExternal: true,
    });
    const key = value('--dataset');
    if (!key) throw new Error('--dataset exige une clé');
    if (command === 'build') {
      const metadataFile = value('--metadata');
      const coverageFile = value('--coverage');
      if (!metadataFile || !coverageFile)
        throw new Error('build exige --metadata et --coverage');
      const { manifest, file } = buildReconciliation({
        cacheDir,
        key,
        metadataFile,
        coverageFile,
      });
      console.log(`manifeste écrit : ${file}`);
      console.log(manifest.note);
    } else if (command === 'replay') {
      const result = replayReconciled({
        cacheDir,
        key,
        dryRun: argv.includes('--dry-run'),
      });
      console.log(JSON.stringify(result, null, 1));
    } else {
      throw new Error('commande attendue : build | replay');
    }
  } catch (error) {
    console.error(error.message);
    process.exit(error instanceof ReconciliationError ? 1 : 2);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();

export { hasGeometry };
