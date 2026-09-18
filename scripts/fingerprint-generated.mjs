#!/usr/bin/env node
/* global console, process */
/**
 * EMPREINTE DES DOCUMENTS GÉNÉRÉS : le build produit-il encore exactement les mêmes documents ?
 *
 * Pourquoi ce script existe. Le lot 7 sort le contenu de `config/bodies.ts` et
 * `config/smallBodies.ts` vers des registres JSON. Tout ce que publie `src/seo/` DÉRIVE de ce
 * catalogue : 114 pages, 56 vignettes de partage, le sitemap. Une migration qui change une
 * valeur, un ordre de clés ou un arrondi ne casse aucun test et ne produit aucune erreur : elle
 * change silencieusement ce qui est indexé. Une empreinte prise AVANT la migration est la seule
 * chose qui transforme « je crois que rien n'a bougé » en une réponse.
 *
 * Ce qu'il compare, et ce qu'il ignore délibérément :
 *
 *   - les pages sont rendues à partir de `dist/index.html`, qui référence les bundles au nom
 *     HACHÉ (`/assets/SolarSystemApp-hlgQ0VPF.js`). Ce hachage change dès qu'on touche une ligne
 *     de source — y compris le chargeur du registre. Sans normalisation, les 114 empreintes
 *     bougeraient à chaque commit et ce contrôle deviendrait un signal rouge permanent, donc un
 *     signal qu'on finit par ignorer. Les références hachées sont donc remplacées par un
 *     marqueur stable AVANT hachage : on compare le CONTENU du document, pas le nom du bundle ;
 *   - les vignettes sont des JPEG rendus sans GPU, de façon déterministe : hachées telles quelles ;
 *   - `dist/assets/**`, `sw.js` et les icônes ne sont pas des documents dérivés du catalogue.
 *
 * Usage :
 *   node scripts/fingerprint-generated.mjs --write      écrit la référence
 *   node scripts/fingerprint-generated.mjs              compare dist/ à la référence
 *   node scripts/fingerprint-generated.mjs --portable   idem, vignettes exclues (autre machine)
 *
 * La référence est commitée (`src/seo/generated-fingerprint.json`) : c'est elle qui fait foi
 * d'un commit à l'autre. `reports/` est ignoré par git, donc invisible de la CI.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');
const BASELINE = resolve(process.cwd(), 'src/seo/generated-fingerprint.json');

/**
 * Seuils bas, comme ceux du plugin Vite : ils attrapent la PANNE (catalogue non chargé, build
 * partiel), pas la suppression volontaire d'un corps. Un build qui passe sous ces nombres n'a
 * pas produit un site différent, il a échoué sans le dire.
 */
const MINIMUM = { html: 100, jpg: 40, xml: 1 };

/** Références de bundles hachées par Vite : `/assets/<nom>-<hash>.<ext>`. */
const HASHED_ASSET = /\/assets\/([A-Za-z0-9._-]+?)-[A-Za-z0-9_-]{8}\.(js|css)/g;

/**
 * Le TAMPON DE BUILD : `new Date()` au moment du build (`vite.config.ts`), écrit dans le
 * `<lastmod>` du sitemap et dans le `dateModified` du JSON-LD des pages documentaires. Il ne
 * dérive pas du catalogue : sans normalisation, l'empreinte serait rouge chaque matin, et un
 * signal rouge permanent est un signal qu'on cesse de lire.
 *
 * Trouvé en falsifiant ce script, pas en le relisant : deux builds à quelques minutes
 * d'intervalle ont franchi minuit UTC et trois documents ont changé sans qu'une ligne de source
 * ne bouge. Les deux contextes sont normalisés NOMMÉMENT, jamais la date partout dans le
 * document : une date de relevé du catalogue qui tomberait le jour du build doit rester
 * comparée.
 */
const BUILD_STAMPS = [
  [/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g, '<lastmod>BUILD-DATE</lastmod>'],
  [/"dateModified":"\d{4}-\d{2}-\d{2}"/g, '"dateModified":"BUILD-DATE"'],
];

/** Les documents que le build DÉRIVE du catalogue, à l'exclusion du reste de `dist/`. */
function isGeneratedDocument(rel) {
  const parts = rel.split(sep);
  if (parts[0] === 'assets' || parts[0] === 'icons') return false;
  if (rel === 'sitemap.xml') return true;
  if (parts[0] === 'social' && rel.endsWith('.jpg')) return true;
  return rel.endsWith(`${sep}index.html`) || rel === 'index.html';
}

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Empreinte d'un document. Le texte est normalisé sur les noms de bundles ; le binaire ne l'est
 * pas. La normalisation est volontairement la SEULE : tout le reste du document compte.
 */
async function fingerprintFile(full, rel) {
  if (rel.endsWith('.jpg')) {
    return createHash('sha256')
      .update(await readFile(full))
      .digest('hex');
  }
  const text = await readFile(full, 'utf-8');
  let normalised = text.replace(HASHED_ASSET, '/assets/$1-HASH.$2');
  for (const [pattern, replacement] of BUILD_STAMPS) {
    normalised = normalised.replace(pattern, replacement);
  }
  return createHash('sha256').update(normalised, 'utf-8').digest('hex');
}

async function fingerprintDist() {
  const files = await walk(DIST);
  const documents = {};
  for (const full of files) {
    const rel = relative(DIST, full);
    if (!isGeneratedDocument(rel)) continue;
    documents[rel.split(sep).join('/')] = await fingerprintFile(full, rel);
  }

  const counts = { html: 0, jpg: 0, xml: 0 };
  for (const name of Object.keys(documents)) {
    if (name.endsWith('.html')) counts.html += 1;
    else if (name.endsWith('.jpg')) counts.jpg += 1;
    else if (name.endsWith('.xml')) counts.xml += 1;
  }
  for (const [kind, minimum] of Object.entries(MINIMUM)) {
    if (counts[kind] < minimum) {
      throw new Error(
        `build incomplet : ${counts[kind]} document(s) ${kind}, minimum attendu ${minimum}`
      );
    }
  }

  // Clés triées : l'empreinte ne doit pas dépendre de l'ordre de parcours du système de fichiers.
  const sorted = {};
  for (const name of Object.keys(documents).sort())
    sorted[name] = documents[name];
  return { counts, bundle: await bundleSizes(files), documents: sorted };
}

/**
 * Taille des morceaux livrés, indexée par leur nom SANS hachage. Informative, jamais
 * bloquante : le poids du bundle change légitimement à chaque commit. Elle est ici parce que
 * le lot 7 fait passer le catalogue de littéraux TypeScript à du JSON importé, et que ces deux
 * formes ne se minifient pas pareil : l'écart doit être MESURÉ, pas supposé.
 */
async function bundleSizes(files) {
  const sizes = {};
  for (const full of files) {
    const rel = relative(DIST, full).split(sep).join('/');
    const match = /^assets\/(.+?)-[A-Za-z0-9_-]{8}\.(js|css)$/.exec(rel);
    if (!match) continue;
    sizes[`${match[1]}.${match[2]}`] = (await readFile(full)).byteLength;
  }
  const sorted = {};
  for (const name of Object.keys(sizes).sort()) sorted[name] = sizes[name];
  return sorted;
}

/**
 * Les vignettes ne sont PAS portables d'une machine à l'autre, et c'est structurel : leur texte
 * est un SVG rendu par sharp, dont la pile de polices est
 * `Segoe UI, Helvetica, Arial, DejaVu Sans, sans-serif` (`seo/socialCard.ts`). Un runner Linux
 * tombe sur DejaVu Sans là où Windows sert Segoe UI : mêmes données, octets différents. Le
 * rendu de la SPHÈRE, lui, est déterministe et sans police.
 *
 * `--portable` retire donc les JPEG de la comparaison, pour le seul cas où l'on compare deux
 * machines (la CI). Par défaut tout est comparé : sur une même machine, avant et après une
 * migration, la vignette dit des choses que la page ne dit pas (elle affiche deux faits du
 * corps et sa texture).
 */
const isPortable = (name) => !name.endsWith('.jpg');

function onlyPortable(documents) {
  const out = {};
  for (const name of Object.keys(documents)) {
    if (isPortable(name)) out[name] = documents[name];
  }
  return out;
}

function report(baseline, current) {
  const before = baseline.documents;
  const after = current.documents;
  const removed = Object.keys(before).filter((n) => !(n in after));
  const added = Object.keys(after).filter((n) => !(n in before));
  const changed = Object.keys(before).filter(
    (n) => n in after && before[n] !== after[n]
  );
  return { removed, added, changed };
}

/** Écart de poids des morceaux, affiché et jamais bloquant (cf. `bundleSizes`). */
function reportBundle(before, after) {
  const lines = [];
  for (const name of Object.keys(after).sort()) {
    const delta = after[name] - (before[name] ?? 0);
    if (name in before && delta === 0) continue;
    const sign = delta >= 0 ? '+' : '';
    lines.push(
      `  ${name} ${after[name]} o (${name in before ? `${sign}${delta}` : 'nouveau'})`
    );
  }
  for (const name of Object.keys(before).sort()) {
    if (!(name in after)) lines.push(`  ${name} disparu`);
  }
  if (lines.length > 0) {
    console.log(
      `poids des morceaux, écart à la référence :\n${lines.join('\n')}`
    );
  }
}

async function main() {
  const write = process.argv.includes('--write');
  const current = await fingerprintDist();

  if (write) {
    await writeFile(BASELINE, `${JSON.stringify(current, null, 2)}\n`, 'utf-8');
    console.log(
      `référence écrite : ${Object.keys(current.documents).length} documents ` +
        `(${current.counts.html} pages, ${current.counts.jpg} vignettes, ${current.counts.xml} sitemap)`
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(await readFile(BASELINE, 'utf-8'));
  } catch {
    console.error(
      `référence absente (${relative(process.cwd(), BASELINE)}) : lancer --write sur un build de référence`
    );
    process.exitCode = 1;
    return;
  }

  reportBundle(baseline.bundle ?? {}, current.bundle);

  const portable = process.argv.includes('--portable');
  const compared = portable
    ? {
        baseline: { documents: onlyPortable(baseline.documents) },
        current: { documents: onlyPortable(current.documents) },
      }
    : { baseline, current };

  const { removed, added, changed } = report(
    compared.baseline,
    compared.current
  );
  if (removed.length === 0 && added.length === 0 && changed.length === 0) {
    console.log(
      `documents générés identiques : ${Object.keys(compared.current.documents).length} vérifiés` +
        (portable ? ' (vignettes exclues, --portable)' : '')
    );
    return;
  }

  console.error('les documents générés ont changé :');
  for (const name of removed) console.error(`  supprimé  ${name}`);
  for (const name of added) console.error(`  ajouté    ${name}`);
  for (const name of changed) console.error(`  modifié   ${name}`);
  console.error(
    `\n${removed.length} supprimé(s), ${added.length} ajouté(s), ${changed.length} modifié(s).\n` +
      'Si le changement est voulu, relancer avec --write et COMMITTER la référence séparément.'
  );
  process.exitCode = 1;
}

// `process.exit(0)` pendant qu'une E/S est ouverte fait planter Node dans libuv sur Windows
// (UV_HANDLE_CLOSING, code 127) : on positionne le code, on ne quitte jamais de force.
await main();
