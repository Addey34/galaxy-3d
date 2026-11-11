#!/usr/bin/env node
/* global console, process */
/**
 * RÉCONCILIATION ET MATÉRIALISATION MULTIPAGE D'UN JEU ODE (GAL-A003-11B). Aucune requête réseau, hors ligne.
 *
 * Un jeu de plus de 5 000 produits se lit en FENÊTRES (`offset`, `limit` = 5 000). Le manifeste historique
 * (`reconciliation-empreintes`, une page) reste intact ; celui-ci est distinct : `reconciliation-multipage`, fichier
 * `<cache>/reconciliation/<jeu>.multipage.json`, ignoré par `loadReconciliation`.
 *
 * Principe : on ne SUPPOSE JAMAIS qu'un offset de `coveragetargz` et le même offset de `results=m` désignent les
 * mêmes produits. Pour chaque fenêtre, la correspondance se DÉMONTRE par les identifiants (ODEId) et les ProductId :
 * tout produit d'un côté et pas de l'autre est un refus, sauf une exclusion démontrée (métadonnées sans géométrie ET
 * absent de toutes les variantes de shapefile). Puis le jeu entier est validé : toutes les fenêtres, aucun ODEId
 * répété entre fenêtres, catalogue = empreintes + exclusions démontrées. Seul un manifeste qualifié autorise la
 * publication, page par page, par lien dur exclusif (réutilise `commitPage` du matérialiseur strict).
 *
 * Mémoire bornée : les captures sont traitées UNE fenêtre à la fois ; seuls les ensembles d'identifiants restent.
 *
 *   node scripts/ode-multipage.mjs build --cache-dir <abs> --dataset "<clé>" [--write]        (sec par défaut)
 *   node scripts/ode-multipage.mjs materialize --cache-dir <abs> --dataset "<clé>" --offset <n|all> [--write]
 */
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseCoverageArchive } from './ode-coverage.mjs';
import { checkDestination } from './ode-import-capture.mjs';
import {
  MaterializeError,
  commitPage,
  shapesProblem,
} from './ode-materialize.mjs';
import { TMP_SUFFIX, pageName, validatePageBuffer } from './ode-pages.mjs';
import {
  RECONCILIATION_DIR,
  REASON_NO_GEOMETRY,
  SURFACE_VARIANTS,
  primaryVariant,
  readCatalogue,
  readShapefiles,
} from './ode-reconciliation.mjs';
import { FREEZE, PAGE } from './ode-selection.mjs';

export const MULTIPAGE_KIND = 'reconciliation-multipage';
export const MULTIPAGE_VERSION = 1;
const CAP = 20;

export class ManifestWriteError extends Error {}

export class MultipageError extends Error {
  constructor(problems) {
    const list = Array.isArray(problems) ? problems : [problems];
    super(
      `multipage refusé :\n  - ${list.slice(0, CAP).join('\n  - ')}${list.length > CAP ? `\n  - … (${list.length - CAP} autres)` : ''}`
    );
    this.name = 'MultipageError';
    this.problems = list;
  }
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
const safe = (k) => k.replace(/[^A-Za-z0-9_.-]+/g, '_');
const byNumber = (a, b) =>
  BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
const sameFreeze = (a, b) =>
  a?.mincreationtime === b?.mincreationtime &&
  a?.maxcreationtime === b?.maxcreationtime;
export const multipageManifestPath = (cacheDir, key) =>
  join(cacheDir, RECONCILIATION_DIR, `${safe(key)}.multipage.json`);

/** Les offsets exacts d'un jeu : 0, pageSize, 2·pageSize, … (ceil(count / pageSize) fenêtres). */
export function windowOffsets(count, pageSize = PAGE) {
  const out = [];
  for (let o = 0; o < count; o += pageSize) out.push(o);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Provenance : trois preuves d'intégrité et identité de la requête
// ---------------------------------------------------------------------------------------------------------------

/** SHA-256, taille et somme annexe d'une source, confrontés à sa provenance. */
function integrityProblems(label, source) {
  const problems = [];
  const sum = sha(source.buffer);
  const p = source.provenance ?? {};
  if (p.sha256 !== sum)
    problems.push(
      `${label} : SHA-256 ${sum} différent de la provenance (${p.sha256})`
    );
  if (p.receivedBytes !== source.buffer.length)
    problems.push(
      `${label} : ${source.buffer.length} octets pour ${p.receivedBytes} annoncés`
    );
  if (source.sidecarSha256 === undefined)
    problems.push(`${label} : somme annexe absente`);
  else if (source.sidecarSha256 !== sum)
    problems.push(`${label} : somme .sha256 différente du contenu`);
  if (p.http !== undefined && p.http?.status !== 200)
    problems.push(`${label} : statut HTTP ${p.http?.status} (200 attendu)`);
  return problems;
}

/** Identité de la requête d'une source : jeu, offset, limite, gel, paramètres. */
function identityProblems(
  label,
  kind,
  { key, offset, limit, freeze, provenance }
) {
  const problems = [];
  const p = provenance ?? {};
  const [db, ihid, iid, pt] = key.split('|');
  if (p.dataset !== key)
    problems.push(`${label} : jeu ${p.dataset} (attendu ${key})`);
  if (p.offset !== offset)
    problems.push(`${label} : offset ${p.offset} (attendu ${offset})`);
  if (String(p.limit) !== String(limit))
    problems.push(`${label} : limite ${p.limit} (attendu ${limit})`);
  if (!sameFreeze(p.freeze, freeze))
    problems.push(`${label} : gel de la provenance différent`);
  const q = p.query ?? {};
  const expected = {
    ...(kind === 'metadata'
      ? { query: 'product', results: 'm', output: 'JSON' }
      : { query: 'coveragetargz' }),
    target: db.toLowerCase(),
    IHID: ihid,
    IID: iid,
    PT: pt,
    limit: String(limit),
    offset: String(offset),
    mincreationtime: freeze.mincreationtime,
    maxcreationtime: freeze.maxcreationtime,
  };
  for (const [k, v] of Object.entries(expected))
    if (q[k] !== v)
      problems.push(`${label} : paramètre ${k}=${q[k]} (attendu ${v})`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Une fenêtre : preuve de correspondance métadonnées / shapefile
// ---------------------------------------------------------------------------------------------------------------

/** Les octets EXACTS d'une page, comme le pipeline normal (`writePageAtomic`) les produit. */
export function buildPageBytes(products) {
  return gzipSync(products.map((p) => JSON.stringify(p)).join('\n'));
}

/**
 * Analyse UNE fenêtre à partir des deux réponses brutes. Pur. Rend { window, problems } ; `window` est la section du
 * manifeste (null si une lecture est impossible). Aucune exclusion n'est présumée : chaque produit du catalogue est
 * soit dans le shapefile, soit une exclusion démontrée.
 */
export function analyzeWindow({
  key,
  freeze,
  pageSize = PAGE,
  catalogueCount,
  offset,
  metadata,
  coverage,
  allowedDatasetIds,
  target = key.split('|')[0],
}) {
  const where = `${key} @${offset}`;
  const problems = [];
  const add = (m) => problems.push(`${where} : ${m}`);
  const expectedCatalogued = Math.min(pageSize, catalogueCount - offset);
  if (!(expectedCatalogued > 0)) {
    add(`offset hors du jeu (${catalogueCount} produits)`);
    return { window: null, problems };
  }
  for (const [label, kind, src] of [
    ['métadonnées', 'metadata', metadata],
    ['coveragetargz', 'coverage', coverage],
  ]) {
    problems.push(...integrityProblems(`${where} ${label}`, src));
    problems.push(
      ...identityProblems(`${where} ${label}`, kind, {
        key,
        offset,
        limit: pageSize,
        freeze,
        provenance: src.provenance,
      })
    );
  }
  const cat = readCatalogue(metadata.buffer);
  problems.push(...cat.problems.map((m) => `${where} : ${m}`));
  if (cat.products.length !== expectedCatalogued)
    add(
      `réponse ${cat.products.length < expectedCatalogued ? 'PARTIELLE' : 'excédentaire'} des métadonnées : ${cat.products.length} produits pour ${expectedCatalogued} attendus (HTTP 200 n'est pas une preuve de complétude)`
    );
  let shp;
  let products;
  try {
    shp = readShapefiles(coverage.buffer);
    products = parseCoverageArchive(coverage.buffer, key, offset).products;
  } catch (error) {
    add(`archive coveragetargz illisible ou tronquée : ${error.message}`);
    return { window: null, problems };
  }
  problems.push(...shp.problems.map((m) => `${where} : ${m}`));
  if (problems.length) return { window: null, problems };

  const kind = shp.kind;
  const primary = primaryVariant(kind);
  const gl = shp.variants[primary].ids;
  const catIds = new Set(cat.products.map((p) => p.id));
  const glPid = shp.variants[primary].productIds;
  // Correspondance des fenêtres, par identifiants ET ProductId.
  const alien = [...gl].filter((id) => !catIds.has(id));
  if (alien.length)
    add(
      `${alien.length} produit(s) du shapefile absent(s) du catalogue de la fenêtre (fenêtres désalignées ?), par exemple ${alien.slice(0, 3).join(', ')}`
    );
  for (const [variant, v] of Object.entries(shp.variants)) {
    if (variant === primary) continue;
    for (const id of v.ids)
      if (!gl.has(id))
        add(`variante ${variant} : identifiant ${id} absent de _${primary}`);
    for (const id of gl) {
      if (!v.ids.has(id))
        add(`variante ${variant} : identifiant ${id} de _${primary} absent`);
      else if (kind === 'a' && v.productIds.get(id) !== glPid.get(id))
        add(
          `variante ${variant} : ODEId ${id} porte le ProductId ${v.productIds.get(id)} au lieu de ${glPid.get(id)}`
        );
    }
  }
  const excluded = [];
  for (const p of cat.products) {
    const inGl = gl.has(p.id);
    if (inGl) {
      if (!p.geometry)
        add(
          `produit ${p.id} : dans le shapefile mais sans géométrie dans les métadonnées`
        );
      if (glPid.get(p.id) !== p.productId)
        add(
          `produit ${p.id} : ProductId ${glPid.get(p.id)} (shapefile) différent de ${p.productId} (métadonnées)`
        );
      continue;
    }
    if (p.geometry)
      add(
        `produit ${p.id} : géométrie dans les métadonnées mais absent du shapefile (exclusion injustifiée)`
      );
    else if (p.otherGeometry.length)
      add(`produit ${p.id} : exclu mais porte ${p.otherGeometry.join(', ')}`);
    else
      excluded.push({
        odeId: p.id,
        productId: p.productId,
        reason: REASON_NO_GEOMETRY,
        metadataGeometry: 'absente',
        inShapefiles: Object.fromEntries(
          Object.keys(shp.variants).map((v) => [v, false])
        ),
      });
  }
  // Contenu : DatasetId autorisés (valeurs de iipt.json), cible, formes.
  const allowed = new Set(allowedDatasetIds ?? []);
  if (!allowed.size)
    add(
      'aucun DatasetId autorisé fourni (iipt.json) : vérification impossible'
    );
  const observedDs = new Set();
  const observedTarget = new Set();
  let withTarget = 0;
  for (const p of products) {
    observedDs.add(p.ds ?? '');
    if (allowed.size && !allowed.has(p.ds ?? ''))
      add(`produit ${p.id} : DatasetId ${JSON.stringify(p.ds)} non autorisé`);
    if (p.target) {
      withTarget++;
      observedTarget.add(p.target);
      if (p.target.toLowerCase() !== target.toLowerCase())
        add(`produit ${p.id} : cible ${p.target} (attendu ${target})`);
    }
    const problem = shapesProblem(p, kind);
    if (problem) add(`produit ${p.id} : ${problem}`);
  }
  if (kind === 'l') {
    const lines = products.reduce((n, p) => n + (p.shapes.l?.length ?? 0), 0);
    if (lines !== shp.variants.gl.records)
      add(
        `${lines} lignes dans les produits pour ${shp.variants.gl.records} enregistrements _gl (multipartie non prise en charge)`
      );
  }
  if (products.length !== gl.size)
    add(
      `${products.length} produits regroupés pour ${gl.size} identifiants du shapefile`
    );
  if (problems.length) return { window: null, problems };

  const bytes = buildPageBytes(products);
  const footprints = [...gl].sort(byNumber);
  const window = {
    offset,
    limit: pageSize,
    counts: {
      catalogued: cat.products.length,
      footprints: footprints.length,
      excluded: excluded.length,
    },
    geometry: {
      kind,
      variants: Object.fromEntries(
        Object.entries(shp.variants).map(([k, v]) => [
          k,
          { records: v.records, distinct: v.ids.size },
        ])
      ),
      shapes: shp.variants[primary].records,
    },
    datasetIds: [...observedDs].sort(),
    target: {
      expected: target,
      check:
        withTarget === 0
          ? 'non-disponible'
          : withTarget === products.length
            ? 'verifie'
            : 'partiel',
      observed: [...observedTarget].sort(),
    },
    sources: {
      metadata: {
        file: metadata.file,
        sha256: sha(metadata.buffer),
        receivedBytes: metadata.buffer.length,
        retrievedAt: metadata.provenance.retrievedAt,
        httpStatus: metadata.provenance.http?.status ?? null,
      },
      coverage: {
        file: coverage.file,
        sha256: sha(coverage.buffer),
        receivedBytes: coverage.buffer.length,
        retrievedAt: coverage.provenance.retrievedAt,
        httpStatus: coverage.provenance.http?.status ?? null,
      },
    },
    footprintIds: footprints,
    productIds: footprints.map((id) => glPid.get(id)),
    excluded: excluded.sort((a, b) => byNumber(a.odeId, b.odeId)),
    page: {
      sha256: sha(bytes),
      bytes: bytes.length,
      products: footprints.length,
    },
  };
  return { window, problems };
}

// ---------------------------------------------------------------------------------------------------------------
// Le jeu entier : manifeste et validation globale
// ---------------------------------------------------------------------------------------------------------------

/**
 * Valide un manifeste multipage SANS lire de capture : structure, fenêtres exactes, comptes, identifiants distincts
 * entre fenêtres, exclusions démontrées, catalogue = empreintes + exclusions. Rend la liste des problèmes (jamais ne
 * lève) ; chaque message nomme le jeu, l'offset et les identifiants.
 */
export function validateMultipageManifest(
  manifest,
  { key, freeze, catalogueCount, pageSize = PAGE }
) {
  const problems = [];
  const add = (m) => problems.push(`${key} : ${m}`);
  if (!manifest || typeof manifest !== 'object')
    return [`${key} : manifeste illisible`];
  if (manifest.version !== MULTIPAGE_VERSION)
    add(`version ${manifest.version} (attendu ${MULTIPAGE_VERSION})`);
  if (manifest.kind !== MULTIPAGE_KIND)
    add(`nature ${manifest.kind} (attendu ${MULTIPAGE_KIND})`);
  if (manifest.dataset !== key) add(`jeu ${manifest.dataset}`);
  if (!sameFreeze(manifest.freeze, freeze))
    add('gel du manifeste différent du gel de référence');
  if (manifest.pageSize !== pageSize)
    add(`taille de page ${manifest.pageSize} (attendu ${pageSize})`);
  if (manifest.catalogueCount !== catalogueCount)
    add(
      `catalogue du manifeste ${manifest.catalogueCount} différent du compte gelé ${catalogueCount}`
    );
  if (manifest.status !== 'qualifie')
    add(`statut ${manifest.status} (« qualifie » attendu)`);
  if (!['a', 'l'].includes(manifest.geometryKind))
    add(`nature de géométrie ${manifest.geometryKind} non admise`);
  const windows = Array.isArray(manifest.windows) ? manifest.windows : [];
  const want = windowOffsets(catalogueCount, pageSize);
  const seen = new Map();
  for (const w of windows) seen.set(w.offset, (seen.get(w.offset) ?? 0) + 1);
  for (const o of want) if (!seen.has(o)) add(`fenêtre @${o} manquante`);
  for (const [o, n] of seen) {
    if (n > 1) add(`fenêtre @${o} répétée ${n} fois`);
    if (!want.includes(o))
      add(
        `fenêtre @${o} surnuméraire (offsets attendus : 0 à ${want.at(-1)} par ${pageSize})`
      );
  }
  const owner = new Map(); // ODEId -> { offset, role, productId }
  const files = new Map(); // sha256 de capture -> offset
  let catalogued = 0;
  let footprints = 0;
  let excluded = 0;
  const primary = primaryVariant(manifest.geometryKind ?? 'l');
  for (const w of windows) {
    const at = `@${w.offset}`;
    const wc = w.counts ?? {};
    const ids = Array.isArray(w.footprintIds) ? w.footprintIds : [];
    const ex = Array.isArray(w.excluded) ? w.excluded : [];
    const expected = Math.min(pageSize, catalogueCount - w.offset);
    if (w.limit !== pageSize)
      add(`${at} : limite ${w.limit} (attendu ${pageSize})`);
    if (wc.catalogued !== expected)
      add(
        `${at} : ${wc.catalogued} catalogués pour ${expected} attendus (fenêtre ${w.offset}+${pageSize} de ${catalogueCount})`
      );
    if (wc.footprints !== ids.length || wc.excluded !== ex.length)
      add(
        `${at} : comptes annoncés (${wc.footprints} empreintes, ${wc.excluded} exclus) ≠ listes (${ids.length}, ${ex.length})`
      );
    if (ids.length + ex.length !== wc.catalogued)
      add(
        `${at} : ${ids.length} empreintes + ${ex.length} exclus ≠ ${wc.catalogued} catalogués (perte non justifiée)`
      );
    if (!Array.isArray(w.productIds) || w.productIds.length !== ids.length)
      add(
        `${at} : ProductId (${w.productIds?.length}) ≠ empreintes (${ids.length})`
      );
    if (w.page?.products !== ids.length)
      add(
        `${at} : page prévue de ${w.page?.products} produits pour ${ids.length} empreintes`
      );
    if (!/^[0-9a-f]{64}$/.test(w.page?.sha256 ?? '') || !(w.page?.bytes > 0))
      add(`${at} : SHA-256 ou taille de la page prévue absents`);
    if (w.geometry?.kind !== manifest.geometryKind)
      add(`${at} : nature ${w.geometry?.kind} ≠ ${manifest.geometryKind}`);
    if (w.geometry?.shapes < ids.length)
      add(`${at} : ${w.geometry?.shapes} formes pour ${ids.length} produits`);
    for (const s of ['metadata', 'coverage']) {
      const src = w.sources?.[s];
      if (
        !/^[0-9a-f]{64}$/.test(src?.sha256 ?? '') ||
        !(src?.receivedBytes > 0) ||
        !src?.file
      )
        add(`${at} : source ${s} sans fichier, SHA-256 ou taille`);
    }
    const covSha = w.sources?.coverage?.sha256;
    if (covSha) {
      if (files.has(covSha))
        add(
          `${at} : même capture coveragetargz que @${files.get(covSha)} (offset répété)`
        );
      files.set(covSha, w.offset);
    }
    const required =
      manifest.geometryKind === 'a' ? SURFACE_VARIANTS : [primary];
    for (const e of ex) {
      if (e.reason !== REASON_NO_GEOMETRY)
        add(`${at} : exclusion ${e.odeId} : motif ${e.reason} non admis`);
      if (e.metadataGeometry !== 'absente')
        add(
          `${at} : exclusion ${e.odeId} : absence de géométrie des métadonnées non démontrée`
        );
      const proof = e.inShapefiles;
      if (
        !proof ||
        required.some((v) => proof[v] !== false) ||
        Object.values(proof).some((v) => v !== false)
      )
        add(
          `${at} : exclusion ${e.odeId} : absence des shapefiles non démontrée`
        );
      if (!e.productId) add(`${at} : exclusion ${e.odeId} : ProductId absent`);
    }
    const claim = (id, role, productId) => {
      const prev = owner.get(id);
      if (!prev) return owner.set(id, { offset: w.offset, role, productId });
      if (productId !== prev.productId)
        add(
          `ODEId ${id} : ProductId contradictoires (${prev.productId} @${prev.offset}, ${productId} @${w.offset})`
        );
      if (prev.role !== role)
        add(
          `ODEId ${id} : ${prev.role === 'exclu' ? 'exclu' : 'géolocalisé'} @${prev.offset} mais ${role === 'exclu' ? 'exclu' : 'géolocalisé'} @${w.offset}`
        );
      else
        add(
          `ODEId ${id} présent dans deux fenêtres @${prev.offset} et @${w.offset}`
        );
    };
    ids.forEach((id, i) => claim(id, 'empreinte', w.productIds?.[i]));
    for (const e of ex) claim(e.odeId, 'exclu', e.productId);
    catalogued += wc.catalogued ?? 0;
    footprints += ids.length;
    excluded += ex.length;
  }
  const c = manifest.counts ?? {};
  if (catalogued !== catalogueCount)
    add(
      `somme des catalogués des fenêtres ${catalogued} ≠ compte gelé ${catalogueCount}`
    );
  if (footprints + excluded !== catalogueCount)
    add(
      `${footprints} empreintes + ${excluded} exclusions démontrées ≠ ${catalogueCount} catalogués`
    );
  if (
    c.catalogued !== catalogued ||
    c.footprints !== footprints ||
    c.excluded !== excluded ||
    c.windows !== windows.length
  )
    add(
      `comptes globaux annoncés ${JSON.stringify(c)} ≠ recalculés ${JSON.stringify({ catalogued, footprints, excluded, windows: windows.length })}`
    );
  if (owner.size !== catalogued)
    add(`${owner.size} identifiants distincts pour ${catalogued} catalogués`);
  return problems;
}

/** Assemble le manifeste du jeu à partir des fenêtres analysées ; refuse tout défaut de validation globale. */
export function buildMultipageManifest({
  key,
  freeze,
  pageSize = PAGE,
  catalogueCount,
  allowedDatasetIds,
  target,
  windows,
  now = new Date(),
}) {
  const sorted = [...windows].sort((a, b) => a.offset - b.offset);
  const kinds = [...new Set(sorted.map((w) => w.geometry.kind))];
  const sum = (f) => sorted.reduce((n, w) => n + f(w), 0);
  const manifest = {
    version: MULTIPAGE_VERSION,
    kind: MULTIPAGE_KIND,
    dataset: key,
    geometryKind: kinds.length === 1 ? kinds[0] : null,
    freeze: {
      mincreationtime: freeze.mincreationtime,
      maxcreationtime: freeze.maxcreationtime,
    },
    pageSize,
    catalogueCount,
    target: target ?? key.split('|')[0],
    allowedDatasetIds: [...(allowedDatasetIds ?? [])].sort(),
    counts: {
      catalogued: sum((w) => w.counts.catalogued),
      footprints: sum((w) => w.counts.footprints),
      excluded: sum((w) => w.counts.excluded),
      windows: sorted.length,
    },
    status: 'qualifie',
    windows: sorted,
    builtAt: now.toISOString(),
    note: `${catalogueCount} catalogués = ${sum((w) => w.counts.footprints)} géolocalisables + ${sum((w) => w.counts.excluded)} exclusions démontrées sur ${sorted.length} fenêtres ; correspondance fenêtre à fenêtre démontrée par ODEId et ProductId`,
  };
  const problems = validateMultipageManifest(manifest, {
    key,
    freeze,
    catalogueCount,
    pageSize,
  });
  if (problems.length) throw new MultipageError(problems);
  return manifest;
}

// ---------------------------------------------------------------------------------------------------------------
// Lecture du cache : captures, qualification, vérification des sources
// ---------------------------------------------------------------------------------------------------------------

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

function readCapture(cacheDir, file, readFile = readFileSync) {
  const dir = join(cacheDir, 'diagnostics');
  return {
    file,
    buffer: readFile(join(dir, file)),
    provenance: JSON.parse(readFile(join(dir, `${file}.json`), 'utf8')),
    sidecarSha256: readFile(join(dir, `${file}.sha256`), 'utf8')
      .trim()
      .split(/\s+/)[0],
  };
}

/** DatasetId autorisés pour un jeu, tels que `iipt.json` les déclare (toutes les écritures présentes). */
export function allowedDatasetIdsFromIipt(iipt, key) {
  const [, ihid, iid, pt] = key.split('|');
  let sets = iipt?.ODEResults?.IIPTSets?.IIPTSet ?? [];
  if (!Array.isArray(sets)) sets = [sets];
  return [
    ...new Set(
      sets
        .filter((s) => s.IHID === ihid && s.IID === iid && s.PT === pt)
        .map((s) => s.DataSetId)
    ),
  ].sort();
}

/**
 * Cherche dans `diagnostics/` les captures `.raw` d'un jeu (provenance `.raw.json`), par fenêtre et par type.
 * Plusieurs captures pour la même fenêtre et le même type : refus (le choix n'est jamais deviné).
 */
export function discoverCaptures(
  cacheDir,
  key,
  readDir = readdirSync,
  readFile = readFileSync
) {
  const dir = join(cacheDir, 'diagnostics');
  const found = new Map();
  const problems = [];
  for (const name of readDir(dir).filter((n) => n.endsWith('.raw.json'))) {
    let p;
    try {
      p = JSON.parse(readFile(join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    if (p.dataset !== key) continue;
    const kind =
      p.query?.query === 'coveragetargz'
        ? 'coverage'
        : p.query?.query === 'product'
          ? 'metadata'
          : null;
    if (!kind) continue;
    const slot = `${p.offset}:${kind}`;
    const file = name.slice(0, -'.json'.length);
    if (found.has(slot))
      problems.push(
        `plusieurs captures ${kind} pour ${key} @${p.offset} : ${found.get(slot)} et ${file}`
      );
    else found.set(slot, file);
  }
  return { found, problems };
}

/**
 * QUALIFIE un jeu à partir des captures de `diagnostics/` : analyse fenêtre par fenêtre (une seule en mémoire à la
 * fois), puis validation globale. Rend le manifeste (non écrit) ; lève MultipageError.
 */
export function qualifyDataset({
  cacheDir,
  key,
  now = new Date(),
  readFile = readFileSync,
  readDir = readdirSync,
}) {
  const counts = readJson(join(cacheDir, 'counts.json'));
  if (!(key in counts))
    throw new MultipageError(`${key} absent de counts.json`);
  const freeze = readJson(join(cacheDir, 'freeze.json'));
  if (!sameFreeze(freeze, FREEZE))
    throw new MultipageError('freeze.json différent du gel de référence');
  const allowed = allowedDatasetIdsFromIipt(
    readJson(join(cacheDir, 'iipt.json')),
    key
  );
  const offsets = windowOffsets(counts[key]);
  const { found, problems } = discoverCaptures(
    cacheDir,
    key,
    readDir,
    readFile
  );
  const windows = [];
  for (const offset of offsets) {
    const meta = found.get(`${offset}:metadata`);
    const cov = found.get(`${offset}:coverage`);
    if (!meta)
      problems.push(`${key} @${offset} : capture de métadonnées absente`);
    if (!cov)
      problems.push(`${key} @${offset} : capture coveragetargz absente`);
    if (!meta || !cov) continue;
    const r = analyzeWindow({
      key,
      freeze,
      catalogueCount: counts[key],
      offset,
      metadata: readCapture(cacheDir, meta, readFile),
      coverage: readCapture(cacheDir, cov, readFile),
      allowedDatasetIds: allowed,
    });
    problems.push(...r.problems);
    if (r.window) windows.push(r.window);
  }
  for (const k of found.keys()) {
    const o = Number(k.split(':')[0]);
    if (!offsets.includes(o))
      problems.push(`${key} : capture @${o} hors des fenêtres attendues`);
  }
  if (problems.length) throw new MultipageError(problems);
  return buildMultipageManifest({
    key,
    freeze,
    catalogueCount: counts[key],
    allowedDatasetIds: allowed,
    windows,
    now,
  });
}

/**
 * Revérifie sur disque les sources d'UNE fenêtre du manifeste : octets contre SHA-256 et taille consignés, puis les
 * trois preuves de provenance et l'identité de la requête. Rend les problèmes.
 */
export function verifyWindowSources(
  manifest,
  offset,
  cacheDir,
  readFile = readFileSync
) {
  const w = manifest.windows.find((x) => x.offset === offset);
  const problems = [];
  for (const kind of ['metadata', 'coverage']) {
    const src = w.sources[kind];
    let cap;
    try {
      cap = readCapture(cacheDir, src.file, readFile);
    } catch (error) {
      problems.push(
        `${manifest.dataset} @${offset} source ${kind} illisible (${src.file}) : ${error.code ?? error.message}`
      );
      continue;
    }
    const label = `${manifest.dataset} @${offset} source ${kind}`;
    if (cap.buffer.length !== src.receivedBytes)
      problems.push(
        `${label} : ${cap.buffer.length} octets pour ${src.receivedBytes}`
      );
    if (sha(cap.buffer) !== src.sha256)
      problems.push(`${label} : SHA-256 différent de celui du manifeste`);
    problems.push(...integrityProblems(label, cap));
    problems.push(
      ...identityProblems(label, kind, {
        key: manifest.dataset,
        offset,
        limit: manifest.pageSize,
        freeze: manifest.freeze,
        provenance: cap.provenance,
      })
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Matérialisation par offset
// ---------------------------------------------------------------------------------------------------------------

const fail = (m) => {
  throw new MaterializeError(m);
};

/**
 * Charge le manifeste d'un jeu et le valide GLOBALEMENT : structure, fenêtres, identifiants distincts, comptes, puis
 * les sources de TOUTES les fenêtres (une à la fois). Rien n'est publiable sans ce contexte. N'écrit rien.
 */
export function loadQualifiedDataset({
  cacheDir,
  key,
  readFile = readFileSync,
}) {
  let dir;
  try {
    dir = checkDestination(cacheDir, '');
  } catch (e) {
    fail(e.message);
  }
  for (const f of ['counts.json', 'freeze.json'])
    if (!existsSync(join(dir, f))) fail(`${f} absent du cache`);
  if (existsSync(join(dir, 'collect.lock')))
    fail('un collecteur tient collect.lock sur ce cache');
  const counts = readJson(join(dir, 'counts.json'));
  if (!(key in counts)) fail(`${key} absent de counts.json`);
  const freeze = readJson(join(dir, 'freeze.json'));
  if (!sameFreeze(freeze, FREEZE))
    fail('freeze.json différent du gel de référence');
  const file = multipageManifestPath(dir, key);
  if (!existsSync(file))
    fail(`aucun manifeste multipage pour ${key} (${file})`);
  let manifest;
  try {
    manifest = JSON.parse(readFile(file, 'utf8'));
  } catch (e) {
    fail(`manifeste illisible : ${e.message}`);
  }
  const problems = validateMultipageManifest(manifest, {
    key,
    freeze,
    catalogueCount: counts[key],
  });
  for (const w of manifest.windows ?? [])
    problems.push(...verifyWindowSources(manifest, w.offset, dir, readFile));
  if (problems.length)
    fail(`manifeste refusé : ${new MultipageError(problems).message}`);
  return { cacheDir: dir, key, manifest, file };
}

/**
 * Plan EN MÉMOIRE de la page d'UN offset. Les sources de la fenêtre sont revérifiées, les produits reconstruits
 * depuis la capture et confrontés au manifeste (identifiants, ProductId, formes, SHA-256 et taille prévus). Une page
 * déjà présente n'est réutilisée que si elle est identique au manifeste ; sinon arrêt, jamais de correction.
 */
export function planWindowPage(ctx, offset, { readFile = readFileSync } = {}) {
  const { manifest, key, cacheDir } = ctx;
  const w = manifest.windows.find((x) => x.offset === offset);
  if (!w)
    fail(
      `${key} : offset ${offset} absent du manifeste (offsets : ${manifest.windows.map((x) => x.offset).join(', ')})`
    );
  const sp = verifyWindowSources(manifest, offset, cacheDir, readFile);
  if (sp.length) fail(`sources refusées : ${sp.join(' ; ')}`);
  const cov = readCapture(cacheDir, w.sources.coverage.file, readFile);
  const { products } = parseCoverageArchive(cov.buffer, key, offset);
  const ids = products.map((p) => String(p.id));
  if (new Set(ids).size !== ids.length)
    fail(`${key} @${offset} : identifiants en double après regroupement`);
  const want = new Set(w.footprintIds);
  const excludedIds = new Set(w.excluded.map((e) => e.odeId));
  if (products.length !== want.size)
    fail(
      `${key} @${offset} : ${products.length} produits pour ${want.size} empreintes du manifeste`
    );
  const pid = new Map(w.footprintIds.map((id, i) => [id, w.productIds[i]]));
  for (const p of products) {
    const id = String(p.id);
    if (!want.has(id))
      fail(`${key} @${offset} : identifiant non attendu ${id}`);
    if (excludedIds.has(id))
      fail(`${key} @${offset} : exclu ${id} présent dans la capture`);
    if (pid.get(id) !== p.pid)
      fail(
        `${key} @${offset} : ProductId ${p.pid} pour ${id} (manifeste ${pid.get(id)})`
      );
    const problem = shapesProblem(p, manifest.geometryKind);
    if (problem) fail(`${key} @${offset} : produit ${id} : ${problem}`);
  }
  const bytes = buildPageBytes(products);
  if (sha(bytes) !== w.page.sha256 || bytes.length !== w.page.bytes)
    fail(
      `${key} @${offset} : page reconstruite (${bytes.length} o, ${sha(bytes)}) différente de celle prévue au manifeste (${w.page.bytes} o, ${w.page.sha256})`
    );
  validatePageBuffer(bytes, {
    expected: w.counts.footprints,
    excludedIds,
    allowedIds: want,
  });
  const dir = join(cacheDir, 'pages', safe(key));
  const target = join(dir, pageName(offset));
  let status = 'a-publier';
  if (existsSync(dir)) {
    const known = new Set(manifest.windows.map((x) => pageName(x.offset)));
    for (const name of readdirSync(dir)) {
      if (name.endsWith(TMP_SUFFIX))
        fail(
          `${key} : temporaire ${name} dans ${dir} (interruption ?) : ÉTAT PARTIEL, intervention manuelle, rien n'est retiré`
        );
      if (!known.has(name))
        fail(`${key} : fichier inattendu ${name} dans ${dir} : arrêt`);
    }
  }
  if (existsSync(target)) {
    let back;
    try {
      back = readFile(target);
      validatePageBuffer(back, {
        expected: want.size,
        excludedIds,
        allowedIds: want,
      });
    } catch (e) {
      fail(
        `${key} @${offset} : page existante invalide (${e.message}) : arrêt, jamais corrigée automatiquement`
      );
    }
    if (sha(back) !== w.page.sha256 || back.length !== w.page.bytes)
      fail(
        `${key} @${offset} : page existante DIVERGENTE du manifeste (${back.length} o, ${sha(back)}) : arrêt, jamais remplacée`
      );
    if (statSync(target).nlink !== 1)
      fail(`${key} @${offset} : page existante à plusieurs noms : arrêt`);
    status = 'deja-publiee';
  }
  return {
    key,
    kind: manifest.geometryKind,
    cacheDir,
    offset,
    status,
    count: want.size,
    catalogued: w.counts.catalogued,
    excludedIds,
    footprintIds: want,
    bytes,
    pageSha256: sha(bytes),
    pageBytes: bytes.length,
    dir,
    target,
  };
}

/**
 * Matérialise les fenêtres demandées, dans l'ordre. Mode sec par défaut. Le contexte (validation globale du jeu) est
 * chargé AVANT toute écriture. Une page déjà publiée et identique est laissée ; la première anomalie arrête tout et
 * l'erreur porte `.report` (ce qui avait été fait). `fs` n'existe que pour les tests.
 */
export function materializeWindows({
  cacheDir,
  key,
  offsets,
  write = false,
  fs = {},
  readFile = readFileSync,
}) {
  const ctx = loadQualifiedDataset({ cacheDir, key, readFile });
  const all = ctx.manifest.windows.map((w) => w.offset);
  const todo = offsets === 'all' ? all : offsets;
  if (!Array.isArray(todo) || !todo.length)
    fail('au moins un offset (ou « all ») est exigé');
  const report = [];
  try {
    for (const offset of todo) {
      const plan = planWindowPage(ctx, offset, { readFile });
      if (plan.status === 'deja-publiee' || !write) {
        report.push({
          offset,
          status: plan.status === 'deja-publiee' ? 'deja-publiee' : 'sec',
          sha256: plan.pageSha256,
          bytes: plan.pageBytes,
        });
        continue;
      }
      const done = commitPage(plan, {
        cacheDir: ctx.cacheDir,
        fs,
        allowSiblingPages: true,
      });
      report.push({
        offset,
        status: 'publiee',
        sha256: done.sha256,
        bytes: done.bytes,
      });
    }
  } catch (error) {
    error.report = report;
    throw error;
  }
  return { key, mode: write ? 'ecriture' : 'sec', report };
}

// ---------------------------------------------------------------------------------------------------------------
// Écriture exclusive du manifeste
// ---------------------------------------------------------------------------------------------------------------

/**
 * Publie le manifeste SANS remplacement ni copie de repli : temporaire exclusif, lien dur, relecture. Les erreurs de
 * nettoyage n'écrasent pas l'erreur d'origine ; seul le fichier lié par CET appel peut être retiré.
 */
export function writeManifestExclusive(file, text, { fs = {} } = {}) {
  const link = fs.linkSync ?? linkSync;
  const rm = fs.rmSync ?? rmSync;
  const bytes = Buffer.from(text, 'utf8');
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}${TMP_SUFFIX}`;
  let fd = null;
  let failure = null;
  let linked = false;
  try {
    fd = (fs.openSync ?? openSync)(tmp, 'wx');
    (fs.writeSync ?? writeSync)(fd, bytes, 0, bytes.length);
    (fs.fsyncSync ?? fsyncSync)(fd);
    const done = fd;
    fd = null;
    (fs.closeSync ?? closeSync)(done);
    try {
      link(tmp, file);
      linked = true;
    } catch (e) {
      throw new ManifestWriteError(
        e?.code === 'EEXIST'
          ? `un manifeste existe déjà (${file}) : jamais écrasé`
          : `lien dur impossible (${e?.code ?? e?.message}) : aucun repli par copie`
      );
    }
  } catch (e) {
    failure = e;
  }
  if (fd !== null) {
    try {
      closeSync(fd);
    } catch {
      /* perdu avec le volume */
    }
  }
  const leftovers = [];
  try {
    rm(tmp, { force: true });
  } catch (e) {
    leftovers.push(`${tmp} (${e?.code ?? e?.message})`);
  }
  if (!failure && !leftovers.length) {
    try {
      if (!readFileSync(file).equals(bytes))
        failure = new ManifestWriteError('relecture du manifeste différente');
    } catch (e) {
      failure = e;
    }
  } else if (!failure)
    failure = new ManifestWriteError(
      `temporaire non retiré : le manifeste porterait plusieurs noms`
    );
  if (!failure) return { file, sha256: sha(bytes), bytes: bytes.length };
  let stuck = null;
  if (linked) {
    try {
      rm(file, { force: true });
    } catch (e) {
      stuck = `${file} (${e?.code ?? e?.message})`;
    }
  }
  const extra = [
    stuck ? `manifeste non retiré : ${stuck}` : null,
    leftovers.length
      ? `temporaire(s) à retirer à la main : ${leftovers.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' ; ');
  if (!extra) throw failure;
  throw new ManifestWriteError(
    `${stuck ? 'ÉTAT PARTIEL, intervention manuelle : ' : ''}${failure.message} ; ${extra}`
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Ligne de commande
// ---------------------------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['build', 'materialize'].includes(command))
    throw new Error(`commande inconnue : ${command} (build | materialize)`);
  const out = {
    command,
    cacheDir: null,
    key: null,
    offset: null,
    write: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--write') out.write = true;
    else if (['--cache-dir', '--dataset', '--offset'].includes(a)) {
      const v = rest[++i];
      if (v === undefined || v.startsWith('--'))
        throw new Error(`${a} exige une valeur`);
      if (a === '--cache-dir') out.cacheDir = v;
      else if (a === '--dataset') out.key = v;
      else out.offset = v;
    } else throw new Error(`option inconnue : ${a}`);
  }
  if (!out.cacheDir)
    throw new Error('--cache-dir est obligatoire (aucun cache par défaut)');
  if (!out.key) throw new Error('--dataset est obligatoire');
  if (command === 'materialize') {
    if (out.offset === null)
      throw new Error('--offset est obligatoire (un entier, ou all)');
    if (out.offset !== 'all' && !/^(0|[1-9][0-9]*)$/.test(out.offset))
      throw new Error(`--offset ${out.offset} : entier positif ou all attendu`);
  } else if (out.offset !== null)
    throw new Error('--offset ne s’applique qu’à materialize');
  return out;
}

export function run(argv) {
  const a = parseArgs(argv);
  const cacheDir = checkDestination(a.cacheDir, '');
  if (a.command === 'materialize')
    return materializeWindows({
      cacheDir,
      key: a.key,
      offsets: a.offset === 'all' ? 'all' : [Number(a.offset)],
      write: a.write,
    });
  const file = multipageManifestPath(cacheDir, a.key);
  if (existsSync(file))
    throw new MultipageError(
      `un manifeste existe déjà (${file}) : jamais écrasé`
    );
  const manifest = qualifyDataset({ cacheDir, key: a.key });
  const summary = {
    mode: a.write ? 'ecriture' : 'sec',
    dataset: a.key,
    status: manifest.status,
    counts: manifest.counts,
    file,
  };
  if (!a.write) return summary;
  return {
    ...summary,
    published: writeManifestExclusive(file, JSON.stringify(manifest) + '\n'),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(run(process.argv.slice(2)), null, 1));
  } catch (e) {
    console.error(`REFUS : ${e.message}`);
    process.exit(2);
  }
}
