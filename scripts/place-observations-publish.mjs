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
 *   2. `verifyBodyResult` refuse un résultat incomplet ou incohérent AVANT toute publication ;
 *   3. `publishStaged` bascule les corps un à un par renommage, en gardant l'ancien dossier, et
 *      REMET TOUT EN ÉTAT si une étape échoue (renommage, écriture de l'index, ou crash simulé) ;
 *   4. une génération qui échoue ne laisse que du temporaire, que le lancement suivant nettoie.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

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
 * products, observed, formations, shards, observedIds, shardOf }, `previous` : l'entrée de l'index
 * livré (ou undefined), `featureIds` : les `iauId` du gazetteer croisé.
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
 * Bascule les corps préparés dans `staging` vers `outRoot`, puis écrit l'index. Chaque étape est
 * annulable ; en cas d'échec tout revient à l'état d'avant et l'erreur est relancée.
 *
 * `hooks.afterStep(label)` sert aux tests : lever une exception simule un crash à cet endroit.
 */
export function publishStaged({
  staging,
  outRoot,
  indexPath,
  indexText,
  bodies,
  hooks = {},
}) {
  const backup = `${staging}.backup`;
  rmSync(backup, { recursive: true, force: true });
  mkdirSync(backup, { recursive: true });
  const done = [];
  let indexBackedUp = false;
  const indexExisted = existsSync(indexPath);
  const step = (label) => hooks.afterStep?.(label);
  try {
    for (const { body, shards } of bodies)
      assertStagedBody(join(staging, body), shards);
    JSON.parse(indexText);
    mkdirSync(outRoot, { recursive: true });
    for (const { body } of bodies) {
      const live = join(outRoot, body);
      const kept = join(backup, body);
      const hadLive = existsSync(live);
      if (hadLive) renameSync(live, kept);
      done.push({ body, hadLive });
      step(`${body}:ancien-écarté`);
      renameSync(join(staging, body), live);
      step(`${body}:nouveau-posé`);
    }
    if (existsSync(indexPath)) {
      copyFileSync(indexPath, join(backup, 'index.json'));
      indexBackedUp = true;
    }
    mkdirSync(dirname(indexPath), { recursive: true });
    const tmp = `${indexPath}.tmp`;
    writeFileSync(tmp, indexText);
    step('index:écrit');
    renameSync(tmp, indexPath);
    step('index:posé');
  } catch (error) {
    for (const { body, hadLive } of done.reverse()) {
      const live = join(outRoot, body);
      const kept = join(backup, body);
      rmSync(live, { recursive: true, force: true });
      if (hadLive && existsSync(kept)) renameSync(kept, live);
    }
    rmSync(`${indexPath}.tmp`, { force: true });
    if (indexBackedUp) {
      mkdirSync(dirname(indexPath), { recursive: true });
      copyFileSync(join(backup, 'index.json'), indexPath);
    } else if (!indexExisted) {
      // L'index n'existait pas : un index écrit par cette tentative ne doit pas lui survivre.
      rmSync(indexPath, { force: true });
    }
    rmSync(backup, { recursive: true, force: true });
    throw error;
  }
  rmSync(backup, { recursive: true, force: true });
}

/** Poids d'un texte en octets (utile aux tests comme au script). */
export const byteLength = (text) => Buffer.byteLength(text);
