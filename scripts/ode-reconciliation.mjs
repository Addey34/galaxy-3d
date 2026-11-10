/**
 * RÉCONCILIATION DES PRODUITS SANS EMPREINTE (GAL-A003-05F).
 *
 * Deux comptes distincts, jamais confondus :
 *   - le CATALOGUE (`counts.json`, `query=product&results=c`) compte tous les produits du jeu,
 *     avec ou sans géométrie ;
 *   - les EMPREINTES (`coveragetargz`) ne portent que les produits géolocalisables.
 * Mesuré sur `Mercury|MESSENGER|MLA|radr` : 3 278 catalogués = 3 274 géolocalisables + 4 produits
 * dont les métadonnées ET les shapefiles n'ont aucune géométrie.
 *
 * Un MANIFESTE de réconciliation, local et hors dépôt (`<cache>/reconciliation/<jeu>.json`), porte
 * la PREUVE de ces exclusions : identifiants exacts, motif factuel, gel, SHA-256 et références des
 * deux réponses brutes. Il ne vaut que pour UN jeu et UNE page (catalogue <= taille de page) ;
 * aucune tolérance, aucun pourcentage : l'attendu après exclusions prouvées reste une ÉGALITÉ
 * stricte. Les jeux de plusieurs pages ne sont PAS couverts (pagination à valider séparément).
 *
 * Ce module ne fait AUCUNE requête réseau.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readDbf, untar } from './ode-coverage.mjs';

export const RECONCILIATION_DIR = 'reconciliation';
export const MANIFEST_VERSION = 1;
export const REASON_NO_GEOMETRY = 'absence-de-geometrie';
/** Les champs géométriques d'une réponse de métadonnées `query=product&results=m`. */
export const GEOMETRY_FIELDS = [
  'Footprint_GL_geometry',
  'Footprint_geometry',
  'Footprint_C0_geometry',
  'Footprint_NP_geometry',
  'Footprint_SP_geometry',
];
/** Les variantes de shapefile d'une archive `coveragetargz`. `gl` est celle que lit le pipeline. */
export const SHAPEFILE_VARIANTS = ['gl', 'c0l', 'c180l'];
/**
 * Les natures de géométrie couvertes : `l` (traces, historique) et `a` (surfaces). La variante lue par le
 * pipeline est `g<nature>`. Un manifeste SANS `geometryKind` est un manifeste de traces (format d'origine).
 */
export const GEOMETRY_KINDS = ['l', 'a'];
export const primaryVariant = (kind) => `g${kind}`;
/** Les trois variantes qu'une archive de surfaces doit porter. */
export const SURFACE_VARIANTS = ['ga', 'c0a', 'c180a'];

export class ReconciliationError extends Error {
  constructor(problems) {
    const list = Array.isArray(problems) ? problems : [problems];
    super(`réconciliation refusée :\n  - ${list.join('\n  - ')}`);
    this.name = 'ReconciliationError';
    this.problems = list;
  }
}

const safeName = (key) => key.replace(/[^A-Za-z0-9_.-]+/g, '_');
export const manifestPath = (cacheDir, key) =>
  join(cacheDir, RECONCILIATION_DIR, `${safeName(key)}.json`);
export const sha256 = (buffer) =>
  createHash('sha256').update(buffer).digest('hex');
const byNumber = (a, b) =>
  BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;

/** Vrai si le produit porte au moins une géométrie exploitable (ni vide, ni `EMPTY`). */
export function hasGeometry(product) {
  return GEOMETRY_FIELDS.some((field) => {
    const value = product[field];
    if (value === undefined || value === null) return false;
    const text = String(value).trim();
    return text !== '' && !/EMPTY/.test(text);
  });
}

/** Lit la réponse de métadonnées AVANT tout filtrage. Rend { products, problems }. */
export function readCatalogue(buffer) {
  const problems = [];
  let json;
  try {
    json = JSON.parse(buffer.toString('utf8')).ODEResults;
  } catch (error) {
    return {
      products: [],
      problems: [`métadonnées illisibles : ${error.message}`],
    };
  }
  if (!json || json.Status !== 'Success')
    problems.push(`métadonnées : Status ${json?.Status ?? 'absent'}`);
  let list = json?.Products?.Product ?? [];
  if (!Array.isArray(list)) list = [list];
  const products = [];
  const seen = new Set();
  for (const raw of list) {
    const id = /product_idGeo=(\d+)/.exec(raw.ProductURL ?? '')?.[1] ?? null;
    const productId =
      /product_id=([^&]+)/.exec(raw.ProductURL ?? '')?.[1] ?? null;
    if (!id || !productId) {
      problems.push(
        `produit sans identifiant exploitable (ProductURL ${raw.ProductURL ?? 'absent'})`
      );
      continue;
    }
    if (seen.has(id))
      problems.push(`ODEId en double dans les métadonnées : ${id}`);
    seen.add(id);
    // Tout AUTRE champ dont le nom évoque une géométrie et qui porte une valeur : preuve d'absence renforcée
    // pour un produit exclu (les cinq champs connus restent seuls juges de `geometry`, comportement inchangé).
    const otherGeometry = Object.keys(raw).filter(
      (k) =>
        /geom|polygon|wkt/i.test(k) &&
        !GEOMETRY_FIELDS.includes(k) &&
        String(raw[k] ?? '').trim() !== '' &&
        !/EMPTY/.test(String(raw[k]))
    );
    products.push({ id, productId, geometry: hasGeometry(raw), otherGeometry });
  }
  return { products, problems };
}

/**
 * Traces : plusieurs enregistrements pour un même ODEId ne sont admis que s'ils sont PROUVÉS légitimes :
 * même ProductId pour tous les enregistrements de l'identifiant, et au moins autant d'enregistrements par
 * identifiant dans chaque variante (c0l/c180l en ont davantage : découpe au méridien). Sinon, refus nommé (comportement d'origine).
 */
function traceRecordProblems(variants) {
  const problems = [];
  const count = (pairs) => {
    const m = new Map();
    for (const [id] of pairs) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const gl = variants.gl;
  const glCount = count(gl.pairs);
  const pidOf = new Map();
  // Les ProductId contradictoires à l'intérieur d'une variante sont refusés par `conflicts` (readShapefiles).
  for (const [id, pid] of gl.pairs) pidOf.set(id, pid);
  for (const [v, x] of Object.entries(variants)) {
    if (v === 'gl') continue;
    const c = count(x.pairs);
    for (const [id, n] of glCount)
      if ((c.get(id) ?? 0) < n)
        problems.push(
          `variante ${v} : ${c.get(id) ?? 0} enregistrements pour l'ODEId ${id} (${n} en _gl)`
        );
    for (const [id, pid] of x.pairs)
      if (pidOf.has(id) && pidOf.get(id) !== pid)
        problems.push(`variante ${v} : ProductId différent pour l'ODEId ${id}`);
  }
  return problems.slice(0, 5);
}

/**
 * Lit les shapefiles d'une archive brute. Rend { variants, kind, problems }. La nature (`l` ou `a`) se DÉRIVE
 * des suffixes présents ; une archive qui en mêle plusieurs, ou aucune, est refusée. Pour les traces, plusieurs
 * enregistrements `_gl` d'un même ODEId ne sont admis que prouvés légitimes (`traceRecordProblems`). Pour les surfaces, plusieurs enregistrements par ODEId
 * sont légitimes (anneau découpé à la couture 0/360) mais un ODEId ne porte JAMAIS deux ProductId.
 */
export function readShapefiles(buffer) {
  const problems = [];
  let tar;
  try {
    tar = untar(gunzipSync(buffer));
  } catch {
    tar = untar(buffer);
  }
  const variants = {};
  const conflicts = {};
  const shapeFiles = new Set();
  for (const name of Object.keys(tar))
    if (/\.shp$/.test(name)) shapeFiles.add(name);
  const missingShp = [];
  for (const name of Object.keys(tar)) {
    const m = /_(gl|c0l|c180l|ga|c0a|c180a)\.dbf$/.exec(name);
    if (!m) continue;
    const rows = readDbf(tar[name], ['ODEId', 'ProductId']);
    // Surfaces : la table seule ne décrit aucune géométrie, le `.shp` de la même variante est exigé.
    const shp = name.replace(/\.dbf$/, '.shp');
    if (m[1].endsWith('a') && !(shapeFiles.has(shp) && tar[shp].length > 100))
      missingShp.push(m[1]);
    variants[m[1]] = {
      records: rows.length,
      ids: new Set(rows.map((r) => r.ODEId)),
      productIds: new Map(rows.map((r) => [r.ODEId, r.ProductId])),
      pairs: rows.map((r) => [r.ODEId, r.ProductId]),
    };
    const seen = new Map();
    conflicts[m[1]] = new Set();
    for (const r of rows) {
      if (seen.has(r.ODEId) && seen.get(r.ODEId) !== r.ProductId)
        conflicts[m[1]].add(r.ODEId);
      seen.set(r.ODEId, r.ProductId);
    }
  }
  const kinds = [...new Set(Object.keys(variants).map((v) => v.slice(-1)))];
  if (kinds.length > 1) {
    problems.push(
      `archive mêlant plusieurs natures de géométrie (${kinds.join(', ')}) : non couverte`
    );
    return { variants, kind: null, problems };
  }
  const kind = kinds[0] ?? 'l';
  const primary = primaryVariant(kind);
  if (!variants[primary])
    problems.push(
      `archive sans shapefile \`_${primary}\` (celui que lit le pipeline)`
    );
  else if (kind === 'l') problems.push(...traceRecordProblems(variants));
  if (kind === 'a')
    for (const v of SURFACE_VARIANTS)
      if (!variants[v])
        problems.push(`surfaces : variante \`_${v}\` manquante`);
  if (kind === 'a')
    for (const v of missingShp)
      problems.push(
        `surfaces : variante \`_${v}\` sans fichier .shp exploitable`
      );
  for (const [v, ids] of Object.entries(conflicts))
    if (ids.size)
      problems.push(
        `variante ${v} : ProductId incohérent pour l'ODEId ${[...ids].slice(0, 3).join(', ')}`
      );
  return { variants, kind, problems };
}

const sameFreeze = (a, b) =>
  a?.mincreationtime === b?.mincreationtime &&
  a?.maxcreationtime === b?.maxcreationtime;

/**
 * Construit le manifeste à partir des DEUX réponses brutes, ou refuse. Pur : les tampons et les
 * provenances sont fournis. Toute divergence est une erreur, aucune exclusion n'est présumée.
 */
export function buildManifest({
  key,
  freeze,
  pageSize,
  catalogueCount,
  metadata,
  coverage,
  now = new Date(),
}) {
  const problems = [];
  const [db, ihid, iid, pt] = key.split('|');
  // --- provenance et SHA-256 de chaque source
  const checkSource = (label, source) => {
    const sum = sha256(source.buffer);
    if (sum !== source.provenance?.sha256)
      problems.push(
        `${label} : SHA-256 ${sum} différent de la provenance (${source.provenance?.sha256})`
      );
    if (source.buffer.length !== source.provenance?.receivedBytes)
      problems.push(
        `${label} : ${source.buffer.length} octets pour ${source.provenance?.receivedBytes} annoncés`
      );
    if (source.sidecarSha256 !== undefined && source.sidecarSha256 !== sum)
      problems.push(`${label} : somme .sha256 différente du contenu`);
    return sum;
  };
  const metaSha = checkSource('métadonnées', metadata);
  const covSha = checkSource('coveragetargz', coverage);
  // `requete` (captures historiques) ou `query` (sondes de métadonnées isolées) : même contenu.
  const req = metadata.provenance?.requete ?? metadata.provenance?.query ?? {};
  const expectReq = {
    query: 'product',
    results: 'm',
    output: 'JSON',
    target: db.toLowerCase(),
    IHID: ihid,
    IID: iid,
    PT: pt,
    offset: '0',
  };
  for (const [k, v] of Object.entries(expectReq))
    if (req[k] !== v)
      problems.push(`métadonnées : paramètre ${k}=${req[k]} (attendu ${v})`);
  if (
    req.mincreationtime !== freeze.mincreationtime ||
    req.maxcreationtime !== freeze.maxcreationtime
  )
    problems.push(
      `métadonnées : gel ${req.mincreationtime}..${req.maxcreationtime} différent du gel ${freeze.mincreationtime}..${freeze.maxcreationtime}`
    );
  const cp = coverage.provenance ?? {};
  if (cp.dataset !== key)
    problems.push(`coveragetargz : jeu ${cp.dataset} (attendu ${key})`);
  if (cp.offset !== 0)
    problems.push(`coveragetargz : offset ${cp.offset} (attendu 0)`);
  if (!sameFreeze(cp.freeze, freeze))
    problems.push('coveragetargz : gel différent');
  if (String(req.limit) !== String(cp.limit))
    problems.push(
      `limites différentes (métadonnées ${req.limit}, coveragetargz ${cp.limit})`
    );

  // --- catalogue et empreintes
  const cat = readCatalogue(metadata.buffer);
  const shp = readShapefiles(coverage.buffer);
  problems.push(...cat.problems, ...shp.problems);
  const catalogued = cat.products.length;
  if (catalogued !== catalogueCount)
    problems.push(
      `catalogue : ${catalogued} produits dans les métadonnées pour ${catalogueCount} dans counts.json`
    );
  if (catalogueCount > pageSize)
    problems.push(
      `jeu de ${catalogueCount} produits (> ${pageSize}) : la réconciliation ne couvre que les jeux d'UNE page, la pagination multipage doit être validée séparément`
    );
  if (catalogued >= Number(req.limit))
    problems.push(
      `métadonnées possiblement tronquées : ${catalogued} produits pour une limite de ${req.limit}`
    );

  if (!problems.length) {
    const catIds = new Set(cat.products.map((p) => p.id));
    const primary = primaryVariant(shp.kind);
    const gl = shp.variants[primary].ids;
    for (const id of gl)
      if (!catIds.has(id))
        problems.push(`identifiant du shapefile absent du catalogue : ${id}`);
    for (const [variant, v] of Object.entries(shp.variants))
      if (variant !== primary) {
        for (const id of v.ids)
          if (!gl.has(id))
            problems.push(
              `variante ${variant} : identifiant ${id} absent de _${primary}`
            );
        for (const id of gl)
          if (!v.ids.has(id))
            problems.push(
              `variante ${variant} : identifiant ${id} de _${primary} absent`
            );
          else if (
            shp.kind === 'a' &&
            v.productIds.get(id) !== shp.variants[primary].productIds.get(id)
          )
            problems.push(
              `variante ${variant} : ODEId ${id} porte le ProductId ${v.productIds.get(id)} au lieu de ${shp.variants[primary].productIds.get(id)} (_${primary})`
            );
      }
    for (const p of cat.products) {
      const inGl = gl.has(p.id);
      if (!inGl && p.otherGeometry.length)
        problems.push(
          `produit ${p.id} : exclu mais porte ${p.otherGeometry.join(', ')} dans les métadonnées`
        );
      if (inGl && !p.geometry)
        problems.push(
          `produit ${p.id} : dans le shapefile mais sans géométrie dans les métadonnées`
        );
      if (!inGl && p.geometry)
        problems.push(
          `produit ${p.id} : géométrie présente dans les métadonnées mais absent du shapefile (exclusion injustifiée)`
        );
      if (inGl && shp.variants[primary].productIds.get(p.id) !== p.productId)
        problems.push(
          `produit ${p.id} : ProductId ${shp.variants[primary].productIds.get(p.id)} (shapefile) différent de ${p.productId} (métadonnées)`
        );
    }
  }
  if (problems.length) throw new ReconciliationError(problems);

  const gl = shp.variants[primaryVariant(shp.kind)].ids;
  const excluded = cat.products
    .filter((p) => !gl.has(p.id))
    .map((p) => ({
      odeId: p.id,
      productId: p.productId,
      reason: REASON_NO_GEOMETRY,
      metadataGeometry: 'absente',
      inShapefiles: Object.fromEntries(
        Object.keys(shp.variants).map((v) => [v, false])
      ),
    }))
    .sort((a, b) => byNumber(a.odeId, b.odeId));
  const manifest = {
    version: MANIFEST_VERSION,
    kind: 'reconciliation-empreintes',
    dataset: key,
    // Absent pour les traces (format d'origine, octet pour octet) ; présent pour les surfaces.
    ...(shp.kind === 'l' ? {} : { geometryKind: shp.kind }),
    freeze: {
      mincreationtime: freeze.mincreationtime,
      maxcreationtime: freeze.maxcreationtime,
    },
    pageSize,
    offset: 0,
    limit: Number(req.limit),
    counts: { catalogued, footprints: gl.size, excluded: excluded.length },
    excluded,
    footprintIds: [...gl].sort(byNumber),
    sources: {
      metadata: {
        file: metadata.file,
        sha256: metaSha,
        receivedBytes: metadata.buffer.length,
        retrievedAt: metadata.provenance.retrievedAt,
        request: req,
      },
      coverage: {
        file: coverage.file,
        sha256: covSha,
        receivedBytes: coverage.buffer.length,
        retrievedAt: coverage.provenance.retrievedAt,
        variants: Object.fromEntries(
          Object.entries(shp.variants).map(([k, v]) => [
            k,
            { records: v.records, distinct: v.ids.size },
          ])
        ),
      },
    },
    builtAt: now.toISOString(),
    note: `${catalogued} catalogués = ${gl.size} géolocalisables + ${excluded.length} sans géométrie ; ces produits ne sont PAS des observations géographiques`,
  };
  const check = validateManifest(manifest, {
    key,
    freeze,
    catalogueCount,
    pageSize,
  });
  if (check.length) throw new ReconciliationError(check);
  return manifest;
}

/** Invariants du manifeste (structure, comptes, ensembles). Rend la liste des problèmes. */
export function validateManifest(
  manifest,
  { key, freeze, catalogueCount, pageSize }
) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['manifeste illisible'];
  if (manifest.version !== MANIFEST_VERSION)
    problems.push(`version ${manifest.version} (attendu ${MANIFEST_VERSION})`);
  if (manifest.kind !== 'reconciliation-empreintes')
    problems.push(`nature ${manifest.kind}`);
  if (manifest.dataset !== key)
    problems.push(`jeu ${manifest.dataset} (attendu ${key})`);
  if (manifest.geometryKind !== undefined && manifest.geometryKind !== 'a')
    problems.push(`nature de géométrie ${manifest.geometryKind} non admise`);
  const primary = primaryVariant(manifest.geometryKind ?? 'l');
  if (!sameFreeze(manifest.freeze, freeze))
    problems.push('gel du manifeste différent du gel courant');
  if (manifest.pageSize !== pageSize)
    problems.push(`taille de page ${manifest.pageSize} (attendu ${pageSize})`);
  if (manifest.offset !== 0)
    problems.push("seule la page 0 d'un jeu d'une page est couverte");
  const c = manifest.counts ?? {};
  const excluded = Array.isArray(manifest.excluded) ? manifest.excluded : [];
  const footprints = Array.isArray(manifest.footprintIds)
    ? manifest.footprintIds
    : [];
  if (c.catalogued !== catalogueCount)
    problems.push(
      `catalogue du manifeste ${c.catalogued} différent de counts.json ${catalogueCount}`
    );
  if (catalogueCount > pageSize)
    problems.push('jeu de plusieurs pages : non couvert par la réconciliation');
  if (c.footprints !== footprints.length)
    problems.push(
      `empreintes annoncées ${c.footprints} pour ${footprints.length} identifiants`
    );
  if (c.excluded !== excluded.length)
    problems.push(
      `exclusions annoncées ${c.excluded} pour ${excluded.length} listées`
    );
  if (footprints.length + excluded.length !== c.catalogued)
    problems.push(
      `${footprints.length} empreintes + ${excluded.length} exclus ≠ ${c.catalogued} catalogués`
    );
  if (new Set(footprints).size !== footprints.length)
    problems.push("identifiants d'empreinte en double");
  const exIds = excluded.map((e) => e.odeId);
  if (new Set(exIds).size !== exIds.length)
    problems.push('identifiants exclus en double');
  const fp = new Set(footprints);
  for (const id of exIds)
    if (fp.has(id))
      problems.push(`identifiant ${id} à la fois exclu et empreinte`);
  for (const e of excluded) {
    if (e.reason !== REASON_NO_GEOMETRY)
      problems.push(`exclusion ${e.odeId} : motif ${e.reason} non admis`);
    if (e.metadataGeometry !== 'absente')
      problems.push(
        `exclusion ${e.odeId} : géométrie des métadonnées non démontrée absente`
      );
    const proof = e.inShapefiles;
    const required =
      manifest.geometryKind === 'a' ? SURFACE_VARIANTS : [primary];
    if (
      !proof ||
      Object.values(proof).some((v) => v !== false) ||
      required.some((v) => !(v in proof)) ||
      // Surfaces : exactement les trois variantes, ni plus ni moins (le contrat des traces reste inchangé).
      (manifest.geometryKind === 'a' &&
        Object.keys(proof).length !== SURFACE_VARIANTS.length)
    )
      problems.push(
        `exclusion ${e.odeId} : absence des shapefiles non démontrée`
      );
  }
  for (const s of ['metadata', 'coverage'])
    if (!/^[0-9a-f]{64}$/.test(manifest.sources?.[s]?.sha256 ?? ''))
      problems.push(`source ${s} : SHA-256 absent`);
  return problems;
}

/** Revérifie les sommes des deux sources sur disque (`<cache>/diagnostics/`). Lève si une diffère. */
export function verifySources(manifest, cacheDir, readFile = readFileSync) {
  const problems = [];
  for (const s of ['metadata', 'coverage']) {
    const src = manifest.sources[s];
    const file = join(cacheDir, 'diagnostics', src.file);
    let bytes;
    try {
      bytes = readFile(file);
    } catch (error) {
      problems.push(
        `source ${s} illisible (${src.file}) : ${error.code ?? error.message}`
      );
      continue;
    }
    if (bytes.length !== src.receivedBytes)
      problems.push(
        `source ${s} : ${bytes.length} octets pour ${src.receivedBytes}`
      );
    if (sha256(bytes) !== src.sha256)
      problems.push(`source ${s} : SHA-256 différent de celui du manifeste`);
  }
  if (problems.length) throw new ReconciliationError(problems);
}

/**
 * Charge et vérifie la réconciliation d'un jeu. Rend null s'il n'y a pas de manifeste (comportement
 * normal inchangé) ; lève ReconciliationError si le manifeste existe mais ne tient pas.
 */
export function loadReconciliation({
  cacheDir,
  key,
  freeze,
  catalogueCount,
  pageSize,
  checkSources = true,
  exists = existsSync,
  readFile = readFileSync,
}) {
  const file = manifestPath(cacheDir, key);
  if (!exists(file)) return null;
  let manifest;
  try {
    manifest = JSON.parse(readFile(file, 'utf8'));
  } catch (error) {
    throw new ReconciliationError(
      `manifeste illisible (${file}) : ${error.message}`
    );
  }
  const problems = validateManifest(manifest, {
    key,
    freeze,
    catalogueCount,
    pageSize,
  });
  if (problems.length) throw new ReconciliationError(problems);
  if (checkSources) verifySources(manifest, cacheDir, readFile);
  return {
    manifest,
    file,
    geometryKind: manifest.geometryKind ?? 'l',
    catalogued: manifest.counts.catalogued,
    footprints: manifest.counts.footprints,
    excludedIds: new Set(manifest.excluded.map((e) => e.odeId)),
    footprintIds: new Set(manifest.footprintIds),
  };
}

/**
 * Ce qu'une page doit contenir : le catalogue (`min(page, count - offset)`) sans réconciliation ;
 * avec elle, le nombre d'empreintes PROUVÉ, et la liste des identifiants qui ne doivent PAS y être.
 */
export function pageExpectation({ count, offset, pageSize, reconciliation }) {
  const catalogued = Math.min(pageSize, count - offset);
  if (!reconciliation)
    return {
      expected: catalogued,
      excludedIds: undefined,
      allowedIds: undefined,
    };
  if (offset !== 0 || count > pageSize)
    throw new ReconciliationError(
      'réconciliation appliquée à un jeu de plusieurs pages'
    );
  return {
    expected: reconciliation.footprints,
    excludedIds: reconciliation.excludedIds,
    allowedIds: reconciliation.footprintIds,
  };
}
