#!/usr/bin/env node
/* global console, process */
/**
 * MATÉRIALISATION STRICTE D'UNE PAGE RÉCONCILIÉE (GAL-A003-10A). Hors réseau, non destructif par défaut.
 *
 * Reprise, sans réécriture, du matérialiseur éprouvé par la publication de MLA scirdrv2 (GAL-A003-09D, dérivé des
 * versions strictes 06I et 06P) : surfaces `a` et traces `l`. La preuve scientifique vient d'un MANIFESTE validé par
 * `loadReconciliation()` (sources, SHA-256, provenance, somme `.sha256`, gel et requête revérifiés), jamais de la
 * capture seule.
 *
 *   node scripts/ode-materialize.mjs --cache-dir <chemin absolu> --dataset "<clé>"            (mode SEC, défaut)
 *   node scripts/ode-materialize.mjs --cache-dir <chemin absolu> --dataset "<clé>" --write    (publie UNE page)
 *
 * Garanties :
 *  - aucun chemin de cache ni jeu implicite (le cache scientifique n'est jamais deviné) : l'absence de l'un des deux
 *    est un refus ; une option inconnue aussi ;
 *  - aucune requête réseau, même si une capture manque (le module n'en importe aucune) ;
 *  - la publication se fait par LIEN DUR exclusif, sans repli par copie ni `rename` : elle ne peut pas écraser une
 *    page existante. Elle relit les octets, contrôle SHA-256, taille et `nlink === 1`, et ne retire que la cible qu'elle
 *    vient de lier si cette relecture échoue ;
 *  - n'utilise ni `writePageAtomic()` ni `replayReconciled()` en écriture (le premier publie par `rename`).
 *
 * Limite assumée : un enregistrement `_gl` MULTIPARTIE (plusieurs parties dans un même enregistrement) n'est pas pris
 * en charge. Le nombre de lignes des produits est confronté au nombre d'enregistrements `_gl` et toute différence est
 * refusée. Son support généralisé n'appartient pas à ce module.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseCoverageArchive } from './ode-coverage.mjs';
import { checkDestination } from './ode-import-capture.mjs';
import {
  TMP_SUFFIX,
  pageName,
  validatePageBuffer,
  writeFileAtomic,
} from './ode-pages.mjs';
import { readSource, replayReconciled } from './ode-reconcile.mjs';
import { loadReconciliation, readShapefiles } from './ode-reconciliation.mjs';
import { FREEZE, PAGE } from './ode-selection.mjs';
import { scanDataset } from './place-observations-publish.mjs';

export class MaterializeError extends Error {}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const safe = (k) => k.replace(/[^A-Za-z0-9_.-]+/g, '_');
const fail = (m) => {
  throw new MaterializeError(m);
};

/**
 * Une forme est exploitable selon la nature attendue (`kind`, « a » par défaut) :
 *  - « a » : anneaux fermés d'au moins 4 points aux coordonnées finies ;
 *  - « l » : lignes d'au moins 2 points aux coordonnées finies et bornées. Un segment dégénéré (points identiques)
 *    n'est ni supprimé ni corrigé : il est conservé tel que le pipeline l'a produit.
 */
export function shapesProblem(p, kind = 'a') {
  if (kind !== 'a' && kind !== 'l') return `nature ${kind} non admise`;
  const label = kind === 'a' ? 'surfaces « a »' : 'traces « l »';
  const kinds = Object.keys(p.shapes ?? {});
  if (kinds.length !== 1 || kinds[0] !== kind)
    return `formes ${kinds.join(',') || 'aucune'} (${label} attendues)`;
  const rings = p.shapes[kind];
  if (!Array.isArray(rings) || !rings.length)
    return kind === 'a' ? 'aucun anneau' : 'aucune ligne';
  const min = kind === 'a' ? 4 : 2;
  for (const r of rings) {
    if (!Array.isArray(r) || r.length < min)
      return kind === 'a'
        ? 'anneau de moins de 4 points'
        : 'ligne de moins de 2 points';
    if (
      r.some(
        (pt) =>
          !Array.isArray(pt) ||
          pt.length < 2 ||
          !Number.isFinite(pt[0]) ||
          !Number.isFinite(pt[1]) ||
          Math.abs(pt[1]) > 90 ||
          Math.abs(pt[0]) > 360
      )
    )
      return 'coordonnée non finie ou hors bornes';
    if (kind === 'a') {
      const a = r[0];
      const b = r[r.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) return 'anneau non fermé';
    }
  }
  return null;
}

/** Plan EN MÉMOIRE. Lève MaterializeError à la moindre incohérence ; n'écrit rien dans le cache. */
export function planReconciledPage({ cacheDir, key }) {
  if (typeof key !== 'string' || key === '')
    fail('--dataset exige la clé du jeu');
  try {
    cacheDir = checkDestination(cacheDir, '');
  } catch (e) {
    fail(e.message);
  }
  for (const f of ['counts.json', 'freeze.json'])
    if (!existsSync(join(cacheDir, f))) fail(`${f} absent du cache`);
  if (existsSync(join(cacheDir, 'collect.lock')))
    fail('un collecteur tient collect.lock sur ce cache');
  const counts = readJson(join(cacheDir, 'counts.json'));
  if (!(key in counts)) fail(`${key} absent de counts.json`);
  const cf = readJson(join(cacheDir, 'freeze.json'));
  if (
    cf.mincreationtime !== FREEZE.mincreationtime ||
    cf.maxcreationtime !== FREEZE.maxcreationtime
  )
    fail('freeze.json différent du gel de référence');
  // 1. Manifeste, sources, SHA-256, provenance (SHA-256, taille, somme annexe), gel et requête : tout est contrôlé
  //    par loadReconciliation (PR #500), qui lève ReconciliationError.
  let rec;
  try {
    rec = loadReconciliation({
      cacheDir,
      key,
      freeze: cf,
      catalogueCount: counts[key],
      pageSize: PAGE,
    });
  } catch (e) {
    fail(`manifeste refusé : ${e.message}`);
  }
  if (!rec) fail(`aucun manifeste pour ${key}`);
  const kind = rec.geometryKind ?? 'l';
  if (kind !== 'a' && kind !== 'l')
    fail(`manifeste de nature ${kind} non admise (« a » ou « l » attendues)`);
  // 2. Rejeu en mode sec du pipeline (relit les exclusions dans les métadonnées, parse la capture).
  let dry;
  try {
    dry = replayReconciled({ cacheDir, key, dryRun: true });
  } catch (e) {
    fail(`rejeu en mode sec refusé : ${e.message}`);
  }
  if (dry.status !== 'dry-run')
    fail(
      `rejeu en mode sec : statut ${dry.status} (une page existe peut-être déjà)`
    );
  // 3. Produits de la capture.
  const cov = readSource(cacheDir, rec.manifest.sources.coverage.file);
  const shp = readShapefiles(cov.buffer);
  if (shp.kind !== kind)
    fail(
      `nature du shapefile ${shp.kind ?? 'ambiguë'} différente de celle du manifeste (${kind})`
    );
  const { products } = parseCoverageArchive(cov.buffer, key, 0);
  const ids = products.map((p) => String(p.id));
  if (new Set(ids).size !== ids.length)
    fail('identifiants en double après regroupement');
  if (products.length !== rec.footprints)
    fail(
      `${products.length} produits pour ${rec.footprints} empreintes du manifeste`
    );
  for (const id of ids)
    if (!rec.footprintIds.has(id)) fail(`identifiant non attendu : ${id}`);
  for (const id of rec.footprintIds)
    if (!ids.includes(id))
      fail(`identifiant du manifeste absent de la capture : ${id}`);
  for (const id of rec.excludedIds)
    if (ids.includes(id)) fail(`exclu ${id} présent dans la capture`);
  for (const p of products) {
    const problem = shapesProblem(p, kind);
    if (problem) fail(`produit ${p.id} : ${problem}`);
  }
  // Traces : un enregistrement de `_gl` = une ligne de produit (refus prudent des enregistrements multiparties).
  if (kind === 'l') {
    const lines = products.reduce((n, p) => n + p.shapes.l.length, 0);
    if (lines !== shp.variants.gl.records)
      fail(
        `${lines} lignes dans les produits pour ${shp.variants.gl.records} enregistrements _gl`
      );
  }
  // 4. Les octets EXACTS qu'écrirait writePageAtomic, relus et validés.
  const bytes = gzipSync(products.map((p) => JSON.stringify(p)).join('\n'));
  const opts = {
    expected: rec.footprints,
    excludedIds: rec.excludedIds,
    allowedIds: rec.footprintIds,
  };
  const validated = validatePageBuffer(bytes, opts);
  const dir = join(cacheDir, 'pages', safe(key));
  const target = join(dir, pageName(0));
  if (existsSync(target)) fail(`la page cible existe déjà : ${target}`);
  if (existsSync(dir) && readdirSync(dir).length)
    fail(`le dossier du jeu n'est pas vide : ${dir}`);
  // scanDataset avec la réconciliation, sur une COPIE jetable hors du cache.
  const scratch = mkdtempSync(join(tmpdir(), 'mat-scan-'));
  let report;
  try {
    writeFileSync(join(scratch, pageName(0)), bytes);
    report = scanDataset(scratch, counts[key], PAGE, null, rec);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (report.problems.length || report.distinct !== rec.footprints)
    fail(
      `scanDataset refuse la page : ${report.problems.join(' ; ') || `${report.distinct} distincts`}`
    );
  return {
    key,
    kind,
    cacheDir,
    count: rec.footprints,
    catalogued: rec.catalogued,
    excludedIds: rec.excludedIds,
    footprintIds: rec.footprintIds,
    validated,
    bytes,
    pageSha256: sha(bytes),
    pageBytes: bytes.length,
    dir,
    target,
    manifestFile: rec.file,
    coverageSha256: rec.manifest.sources.coverage.sha256,
    metadataSha256: rec.manifest.sources.metadata.sha256,
    products,
    report,
  };
}

/**
 * Publication STRICTE par LIEN DUR, sans repli par copie. Ne retire que NOTRE temporaire et, si la relecture échoue
 * après un lien réussi, la cible que NOUS venons de lier ; si ce retrait échoue, signale un ÉTAT PARTIEL sans rien
 * nettoyer d'autre. Une erreur de nettoyage ne masque jamais l'erreur d'origine et n'autorise jamais le succès. N'écrit
 * aucun autre fichier du cache. `fs` n'existe que pour les tests (injection de pannes).
 */
export function commitPage(
  plan,
  { fs = {}, cacheDir, allowSiblingPages = false } = {}
) {
  const link = fs.linkSync ?? linkSync;
  const lock = join(cacheDir ?? plan.cacheDir, 'collect.lock');
  if (existsSync(lock)) fail('un collecteur tient collect.lock sur ce cache');
  if (existsSync(plan.target))
    fail(`la page cible existe déjà : ${plan.target}`);
  // Un jeu multipage publie ses pages une à une : les pages sœurs (déjà validées par l'appelant) sont admises.
  if (
    !allowSiblingPages &&
    existsSync(plan.dir) &&
    readdirSync(plan.dir).length
  )
    fail(`le dossier du jeu n'est pas vide : ${plan.dir}`);
  mkdirSync(plan.dir, { recursive: true });
  const rm = fs.rmSync ?? rmSync;
  const tmp = `${plan.target}.${process.pid}.${randomBytes(4).toString('hex')}${TMP_SUFFIX}`;
  let failure = null;
  try {
    writeFileAtomic(tmp, plan.bytes, { fs });
    if (!readFileSync(tmp).equals(plan.bytes))
      fail('le temporaire relu diffère des octets planifiés');
    try {
      link(tmp, plan.target);
    } catch (error) {
      if (error?.code === 'EEXIST')
        fail(
          `collision : la page cible existe déjà, laissée intacte : ${plan.target}`
        );
      fail(
        `publication par lien dur impossible (${error?.code ?? error?.message}) : aucun repli par copie, aucune page écrite`
      );
    }
  } catch (e) {
    failure = e;
  }
  // Retrait de NOS deux temporaires. Une erreur ici ne coupe jamais la suite : elle est mémorisée, car la page déjà
  // liée doit passer ses contrôles définitifs (ou être retirée) avant tout retour.
  const leftovers = [];
  for (const f of [tmp, `${tmp}${TMP_SUFFIX}`]) {
    try {
      rm(f, { force: true });
    } catch (e) {
      leftovers.push(`${f} (${e?.code ?? e?.message})`);
    }
  }
  const manual = `temporaire(s) non retiré(s), à retirer à la main : ${leftovers.join(', ')}`;
  if (failure) {
    // Aucun lien n'a abouti : aucune page n'est publiée. L'erreur d'origine reste la première information.
    if (!leftovers.length) throw failure;
    throw new MaterializeError(`${failure.message} ; en plus, ${manual}`);
  }
  let back;
  try {
    if (leftovers.length)
      throw new MaterializeError(
        `${manual} : la page porterait plusieurs noms`
      );
    back = readFileSync(plan.target);
    if (!back.equals(plan.bytes))
      throw new MaterializeError('relecture différente');
    if (sha(back) !== plan.pageSha256 || back.length !== plan.pageBytes)
      throw new MaterializeError('SHA-256 ou taille différents du plan');
    validatePageBuffer(back, {
      expected: plan.count,
      excludedIds: plan.excludedIds,
      allowedIds: plan.footprintIds,
    });
    if (statSync(plan.target).nlink !== 1)
      throw new MaterializeError(
        'la page a plusieurs noms après retrait du temporaire'
      );
  } catch (e) {
    // La cible a été liée par NOUS : seule elle peut être retirée. Si elle ne l'est pas, l'état est partiel.
    try {
      rm(plan.target, { force: true });
    } catch (removal) {
      throw new MaterializeError(
        `ÉTAT PARTIEL, intervention manuelle : ${e.message} ; la page ${plan.target} n'a pas pu être retirée (${removal?.code ?? removal?.message})${leftovers.length ? ` ; ${manual}` : ''}`
      );
    }
    throw new MaterializeError(
      `page retirée après relecture : ${e.message}${leftovers.length && !String(e.message).includes('à retirer à la main') ? ` ; ${manual}` : ''}`
    );
  }
  return { target: plan.target, sha256: sha(back), bytes: back.length };
}

const OPTIONS = new Set(['--cache-dir', '--dataset', '--write']);

/** Lit les arguments sans rien deviner : chemin du cache et jeu OBLIGATOIRES, option inconnue refusée. */
export function parseArgs(argv) {
  const out = { cacheDir: null, key: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!OPTIONS.has(a)) fail(`option inconnue : ${a}`);
    if (a === '--write') out.write = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) fail(`${a} exige une valeur`);
      if (a === '--cache-dir') out.cacheDir = v;
      else out.key = v;
    }
  }
  if (!out.cacheDir)
    fail('--cache-dir est obligatoire (aucun cache par défaut)');
  if (!out.key) fail('--dataset est obligatoire (un seul jeu désigné)');
  return out;
}

/** Interface en ligne de commande. Rend le rapport ; n'écrit que si `--write`. */
export function run(argv) {
  const { cacheDir, key, write } = parseArgs(argv);
  const plan = planReconciledPage({ cacheDir, key });
  const ids = [...plan.footprintIds].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1
  );
  const report = {
    mode: write ? 'ECRITURE' : 'SEC',
    key: plan.key,
    nature: plan.kind,
    catalogues: plan.catalogued,
    produits: plan.count,
    exclus: [...plan.excludedIds],
    octetsPage: plan.pageBytes,
    sha256Page: plan.pageSha256,
    cible: plan.target,
    manifeste: plan.manifestFile,
    sha256Couverture: plan.coverageSha256,
    sha256Metadonnees: plan.metadataSha256,
    scan: { distinct: plan.report.distinct, problemes: plan.report.problems },
    identifiants: ids,
  };
  return {
    report,
    published: write ? commitPage(plan, { cacheDir: plan.cacheDir }) : null,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { report, published } = run(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 1));
    if (published) console.log(JSON.stringify(published));
  } catch (e) {
    console.error(`REFUS : ${e.message}`);
    process.exit(2);
  }
}
