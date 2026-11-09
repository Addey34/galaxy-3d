/* global Buffer */
/**
 * PUBLICATION TRANSACTIONNELLE DES OBSERVATIONS DE LIEUX (GAL-A003-01).
 *
 * `generate-place-observations.mjs` supprimait le dossier PUBLIÉ d'un corps (`rmSync`) avant
 * d'avoir vérifié que le cache d'empreintes était complet : lancé sans `pages/` (le cas du poste
 * le 2026-11-09), il effaçait `public/assets/place-observations/<corps>/` puis échouait. Les
 * données livrées ne doivent jamais dépendre de la réussite d'une génération.
 *
 * Le contrat, pur et testé :
 *   1. tout est écrit dans un espace TEMPORAIRE (jamais dans `public/`) ;
 *   2. `scanDataset` + `verifyBodyResult` refusent un résultat incomplet ou incohérent AVANT toute
 *      publication ;
 *   3. `publishStaged` bascule les corps un à un par renommage, JOURNALISÉ, et remet tout en état
 *      si une étape échoue, y compris après un processus tué (`recoverPublish`) ;
 *   4. une génération qui échoue ne laisse que du temporaire, que le lancement suivant nettoie.
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** Les corps que l'ODE couvre, tels que l'index les nomme. */
export const COVERED_BODIES = ['moon', 'mars', 'mercury', 'venus'];

/**
 * `--only` doit nommer un corps couvert. Avant, un nom inconnu ne traitait rien et réécrivait
 * quand même l'index : la faute de frappe était silencieuse.
 */
export function assertCoveredBody(only) {
  if (only === null || only === undefined) return;
  if (!COVERED_BODIES.includes(only))
    throw new Error(
      `--only ${only} : corps inconnu (${COVERED_BODIES.join(', ')})`
    );
}

/** Part tolérée de produits en moins par rapport à l'index livré avant de refuser le résultat. */
export const MAX_PRODUCT_DROP = 0.01;

/**
 * Refuse un résultat de corps incomplet ou incohérent. `result` : { missingPages, extraPages,
 * pageProblems, products, observed, formations, shards, observedIds, shardOf }, `previous` :
 * l'entrée de l'index livré (ou undefined), `featureIds` : les `iauId` du gazetteer croisé.
 */
export function verifyBodyResult(
  body,
  result,
  { previous, featureIds, partial = false, acceptDrop = false }
) {
  const problems = [];
  if (result.missingPages > 0 && !partial)
    problems.push(
      `${result.missingPages} page(s) d'empreintes manquante(s) dans le cache (relancer places:pull)`
    );
  if (result.extraPages > 0)
    problems.push(
      `${result.extraPages} page(s) en trop dans le cache : le tirage ne correspond plus au dénombrement`
    );
  const pp = result.pageProblems ?? [];
  for (const p of pp.slice(0, 10)) problems.push(p);
  if (pp.length > 10) problems.push(`… et ${pp.length - 10} autre(s) jeu(x)`);
  if (!(result.products > 0))
    problems.push('aucun produit lu : le cache est vide ou illisible');
  if (!(result.shards >= 1)) problems.push('aucun morceau à publier');
  if (result.observed > result.formations)
    problems.push(
      `${result.observed} formations observées pour ${result.formations} formations`
    );
  const known = new Set(featureIds);
  for (const id of result.observedIds) {
    if (!known.has(Number(id)))
      problems.push(`la formation ${id} n'est pas dans le gazetteer croisé`);
    else if (Number(id) % result.shards !== result.shardOf(id))
      problems.push(`la formation ${id} est dans le mauvais morceau`);
    if (problems.length > 20) break;
  }
  if (
    previous &&
    !acceptDrop &&
    result.products < previous.products * (1 - MAX_PRODUCT_DROP)
  )
    problems.push(
      `${result.products} produits lus contre ${previous.products} livrés (baisse de plus de ${MAX_PRODUCT_DROP * 100} %) : cache tronqué ? (--accept-drop pour l'assumer)`
    );
  if (problems.length > 0)
    throw new Error(
      `${body} : résultat refusé, rien n'est publié :\n  - ${problems.join('\n  - ')}`
    );
}

/**
 * LES PAGES ATTENDUES D'UN JEU, par NOM et non par nombre. Un jeu de `count` produits tiré par
 * pages de `page` a exactement les fichiers `0.ndjson.gz`, `5000.ndjson.gz`… jusqu'à `count`.
 * Compter les fichiers laisse passer une page remplacée par une autre (même total, mauvais
 * contenu).
 */
export function expectedOffsets(count, page) {
  const out = [];
  for (let off = 0; off < count; off += page) out.push(off);
  return out;
}

/** Classe les fichiers d'un dossier de jeu : manquants, en trop (hors attendu), mal nommés. */
export function checkPageNames(files, count, page) {
  const want = new Set(expectedOffsets(count, page));
  const seen = new Set();
  const extra = [];
  const misnamed = [];
  for (const f of files) {
    const m = /^(0|[1-9][0-9]*)\.ndjson\.gz$/.exec(f);
    if (!m) {
      misnamed.push(f);
      continue;
    }
    const off = Number(m[1]);
    if (want.has(off)) seen.add(off);
    else extra.push(f);
  }
  const missing = [...want].filter((o) => !seen.has(o));
  return { missing, extra, misnamed };
}

/**
 * Lit un jeu : noms exacts, pages lisibles (gzip + JSON), produits distincts égaux au compte
 * déclaré. `onProduct` reçoit chaque produit au premier passage (les doublons sont écartés).
 */
export function scanDataset(dir, count, page, onProduct) {
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const names = checkPageNames(files, count, page);
  const report = {
    ...names,
    unreadable: [],
    distinct: 0,
    duplicates: 0,
    problems: [],
  };
  const ids = new Set();
  const present = expectedOffsets(count, page).filter(
    (o) => !names.missing.includes(o)
  );
  for (const off of present) {
    const file = `${off}.ndjson.gz`;
    let lines;
    try {
      lines = gunzipSync(readFileSync(join(dir, file)))
        .toString()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      report.unreadable.push(file);
      continue;
    }
    for (const p of lines) {
      if (ids.has(p.id)) {
        report.duplicates++;
        continue;
      }
      ids.add(p.id);
      onProduct?.(p);
    }
  }
  report.distinct = ids.size;
  const some = (a) => a.slice(0, 3).join(', ');
  if (names.missing.length)
    report.problems.push(
      `${names.missing.length} page(s) manquante(s) (${some(names.missing)}…)`
    );
  if (names.extra.length)
    report.problems.push(`page(s) hors attendu : ${some(names.extra)}`);
  if (names.misnamed.length)
    report.problems.push(`fichier(s) mal nommé(s) : ${some(names.misnamed)}`);
  if (report.unreadable.length)
    report.problems.push(`page(s) illisible(s) : ${some(report.unreadable)}`);
  if (
    !names.missing.length &&
    !report.unreadable.length &&
    report.distinct !== count
  )
    report.problems.push(
      `${report.distinct} produits distincts pour ${count} déclarés`
    );
  return report;
}

/** Un dossier de morceaux publiable : 0.json … (n-1).json, tous du JSON qui parse. */
export function assertStagedBody(dir, shards) {
  if (!existsSync(dir)) throw new Error(`morceaux absents : ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length !== shards)
    throw new Error(
      `${dir} : ${files.length} morceaux pour ${shards} attendus`
    );
  for (let k = 0; k < shards; k++) {
    const file = join(dir, `${k}.json`);
    if (!existsSync(file)) throw new Error(`${file} manque`);
    JSON.parse(readFileSync(file, 'utf8'));
  }
}

/**
 * RÉCUPÉRATION APRÈS INTERRUPTION BRUTALE (SIGKILL, processus tué).
 *
 * Une exception interceptée ne couvre pas un processus tué : plus aucun `catch` ne s'exécute. La
 * publication écrit donc un JOURNAL persistant (`<staging>.journal.json`, fsync puis renommage
 * atomique) et garde les anciens dossiers dans `<staging>.backup` TANT QUE le journal existe.
 * Au lancement suivant, `recoverPublish` lit le journal :
 *   - phase `committed` : la bascule était finie, on ne fait que nettoyer ;
 *   - phase `swapping`  : on remet l'état d'avant (idempotent, rejouable si la récupération est
 *     elle-même interrompue).
 * DÉMONTRÉ : un sous-processus tué par SIGKILL à chaque étape (placeObservationsPublish.test.ts).
 * NON DÉMONTRÉ : une coupure de courant (les répertoires ne sont pas fsyncés).
 */
const journalOf = (staging) => `${staging}.journal.json`;

function writeJournal(staging, journal) {
  const path = journalOf(staging);
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, JSON.stringify(journal));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

function rollback(staging, journal) {
  const backup = `${staging}.backup`;
  for (const { body, hadLive } of [...journal.bodies].reverse()) {
    const live = join(journal.outRoot, body);
    const kept = join(backup, body);
    if (hadLive) {
      // Ancien écarté : le dossier courant est le nouveau (ou absent). Sinon l'ancien n'a pas bougé.
      if (existsSync(kept)) {
        rmSync(live, { recursive: true, force: true });
        renameSync(kept, live);
      }
    } else rmSync(live, { recursive: true, force: true });
  }
  rmSync(`${journal.indexPath}.tmp`, { force: true });
  if (journal.indexExisted) {
    const saved = join(backup, 'index.json');
    if (existsSync(saved)) copyFileSync(saved, journal.indexPath);
  } else rmSync(journal.indexPath, { force: true });
}

/**
 * À appeler AVANT de supprimer ou de recréer le staging. Renvoie 'none', 'cleaned' (publication
 * déjà validée) ou 'rolled-back'. Lève si le journal est illisible : on ne devine pas.
 */
export function recoverPublish(staging) {
  const path = journalOf(staging);
  const backup = `${staging}.backup`;
  rmSync(`${path}.tmp`, { force: true });
  if (!existsSync(path)) {
    rmSync(backup, { recursive: true, force: true });
    return 'none';
  }
  let journal;
  try {
    journal = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `journal de publication illisible (${path}) : vérifier à la main avant de relancer (${error.message})`,
      { cause: error }
    );
  }
  const verdict = journal.phase === 'committed' ? 'cleaned' : 'rolled-back';
  if (journal.phase !== 'committed') rollback(staging, journal);
  rmSync(backup, { recursive: true, force: true });
  rmSync(path, { force: true });
  return verdict;
}

/**
 * Bascule les corps préparés dans `staging` vers `outRoot`, puis écrit l'index. Journalisé : voir
 * `recoverPublish`. `hooks.afterStep(label)` sert aux tests (exception ou SIGKILL simulés).
 */
export function publishStaged({
  staging,
  outRoot,
  indexPath,
  indexText,
  bodies,
  hooks = {},
}) {
  recoverPublish(staging);
  const backup = `${staging}.backup`;
  const step = (label) => hooks.afterStep?.(label);
  for (const { body, shards } of bodies)
    assertStagedBody(join(staging, body), shards);
  JSON.parse(indexText);
  mkdirSync(outRoot, { recursive: true });
  mkdirSync(dirname(indexPath), { recursive: true });
  mkdirSync(backup, { recursive: true });
  const indexExisted = existsSync(indexPath);
  if (indexExisted) copyFileSync(indexPath, join(backup, 'index.json'));
  const journal = {
    phase: 'swapping',
    outRoot,
    indexPath,
    indexExisted,
    bodies: bodies.map(({ body }) => ({
      body,
      hadLive: existsSync(join(outRoot, body)),
    })),
  };
  writeJournal(staging, journal);
  try {
    step('journal:écrit');
    for (const { body, hadLive } of journal.bodies) {
      const live = join(outRoot, body);
      if (hadLive) renameSync(live, join(backup, body));
      step(`${body}:ancien-écarté`);
      renameSync(join(staging, body), live);
      step(`${body}:nouveau-posé`);
    }
    const tmp = `${indexPath}.tmp`;
    writeFileSync(tmp, indexText);
    step('index:écrit');
    renameSync(tmp, indexPath);
    step('index:posé');
    writeJournal(staging, { ...journal, phase: 'committed' });
    step('committé');
  } catch (error) {
    // Une exception interceptée est rejouée par le même code que la récupération après SIGKILL.
    recoverPublish(staging);
    throw error;
  }
  rmSync(backup, { recursive: true, force: true });
  rmSync(journalOf(staging), { force: true });
}

/** Poids d'un texte en octets (utile aux tests comme au script). */
export const byteLength = (text) => Buffer.byteLength(text);
