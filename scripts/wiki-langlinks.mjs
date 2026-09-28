/* global console, process, fetch, URL */
/**
 * LES LIENS WIKIPÉDIA DES AUTRES LANGUES, LUS À LA SOURCE — jamais devinés (lot 20, phase 20B).
 *
 * Chaque fiche du registre déclare un article Wikipédia par langue (`realData.wiki`). Deviner
 * l'adresse espagnole en traduisant le titre anglais produit des 404, c'est-à-dire des liens
 * publiés faux : « Mars (planet) » n'est pas « Marte (planeta) » par hasard, et les petites lunes
 * n'ont pas toutes d'article.
 *
 * L'adresse est donc DEMANDÉE à Wikipédia elle-même : l'API `prop=langlinks` rend le lien
 * interlangue officiel de l'article anglais. Ce qui n'existe pas est déclaré ABSENT, et la fiche
 * retombe alors sur l'anglais — un manque nommé, pas un lien mort.
 *
 *   node scripts/wiki-langlinks.mjs            écrit les fiches (insertion TEXTE, cf. ci-dessous)
 *   node scripts/wiki-langlinks.mjs --check     ne touche à rien ; code 1 si une fiche a dérivé
 *   node scripts/wiki-langlinks.mjs --report    affiche le relevé et sort
 *
 * POURQUOI UNE INSERTION TEXTE et non un `JSON.parse` + `JSON.stringify` : le sérialiseur
 * réécrit `0.0000803236` en `8.03236e-05` et churnerait des dizaines de fiches qui n'ont rien à
 * voir avec ce lot. Le piège est déjà écrit dans `CLAUDE.md`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTITIES = join(ROOT, 'src/registry/entities');
const API = 'https://en.wikipedia.org/w/api.php';

/** Les langues à remplir, et le domaine Wikipédia de chacune. */
const TARGETS = [
  { locale: 'es', lang: 'es', host: 'es.wikipedia.org' },
  { locale: 'pt-BR', lang: 'pt', host: 'pt.wikipedia.org' },
];

const args = process.argv.slice(2);
const check = args.includes('--check');
const reportOnly = args.includes('--report');

/** Le titre d'article d'une URL Wikipédia, décodé. */
function titleOf(url) {
  const match = /\/wiki\/(.+)$/.exec(url);
  if (!match) throw new Error(`URL Wikipédia non reconnue : ${url}`);
  return decodeURIComponent(match[1]).replace(/_/g, ' ');
}

/** L'URL d'un article, écrite comme les fiches existantes l'écrivent. */
function urlOf(host, title) {
  return `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Chaque bloc `"wiki": { … }` d'une fiche, avec sa position et son `en`. */
function wikiBlocks(source) {
  const blocks = [];
  const re = /"wiki":\s*\{/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) throw new Error('bloc "wiki" non terminé');
    const body = source.slice(open, end + 1);
    const enMatch = /"en":\s*"([^"]+)"/.exec(body);
    if (!enMatch)
      throw new Error(`bloc "wiki" sans "en" : ${body.slice(0, 80)}`);
    blocks.push({ open, end, body, en: enMatch[1] });
  }
  return blocks;
}

const files = readdirSync(ENTITIES).filter((name) => name.endsWith('.json'));
/** Titre anglais -> les fichiers qui le citent. */
const titles = new Map();
for (const name of files) {
  const source = readFileSync(join(ENTITIES, name), 'utf8');
  for (const block of wikiBlocks(source)) {
    const title = titleOf(block.en);
    if (!titles.has(title)) titles.set(title, []);
    titles.get(title).push(name);
  }
}
console.log(`${titles.size} articles anglais cités par ${files.length} fiches`);

/** Les liens interlangues d'un lot de titres, demandés à Wikipédia. */
async function langlinks(batch, lang) {
  const url = new URL(API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('prop', 'langlinks');
  url.searchParams.set('lllang', lang);
  url.searchParams.set('lllimit', '500');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('titles', batch.join('|'));
  const response = await fetch(url, {
    headers: {
      // Wikipédia demande un agent identifiable ; un agent anonyme se fait limiter.
      'User-Agent':
        'Galaxy-3D/0.10 (https://galaxy.adrianguichard.dev) node-fetch',
    },
  });
  if (!response.ok)
    throw new Error(
      `API Wikipédia : HTTP ${response.status} ${response.statusText}`
    );
  const json = await response.json();
  const out = new Map();
  // Une redirection change le titre demandé : on la suit pour rattacher la réponse.
  const alias = new Map();
  for (const entry of json.query?.redirects ?? [])
    alias.set(entry.to, entry.from);
  for (const page of json.query?.pages ?? []) {
    const asked = alias.get(page.title) ?? page.title;
    const link = page.langlinks?.[0]?.title;
    out.set(asked, link ?? null);
    if (page.missing) out.set(asked, null);
  }
  return out;
}

const all = [...titles.keys()];
/** locale -> (titre anglais -> titre traduit ou null) */
const resolved = new Map();
for (const target of TARGETS) {
  const map = new Map();
  for (let i = 0; i < all.length; i += 40) {
    const batch = all.slice(i, i + 40);
    const answer = await langlinks(batch, target.lang);
    for (const title of batch) map.set(title, answer.get(title) ?? null);
  }
  resolved.set(target.locale, map);
  const missing = [...map.entries()].filter(([, value]) => value === null);
  console.log(
    `${target.locale} : ${map.size - missing.length} articles sur ${map.size}` +
      (missing.length
        ? `, absents : ${missing.map(([title]) => title).join(', ')}`
        : '')
  );
}

if (reportOnly) process.exit(0);

let changed = 0;
const drifted = [];
for (const name of files) {
  const path = join(ENTITIES, name);
  const original = readFileSync(path, 'utf8');
  let source = original;
  // De la FIN vers le DÉBUT : insérer décale les positions suivantes.
  for (const block of wikiBlocks(source).reverse()) {
    const title = titleOf(block.en);
    const indent = /\n(\s*)"en":/.exec(block.body)?.[1] ?? '        ';
    const additions = [];
    for (const target of TARGETS) {
      const translated = resolved.get(target.locale).get(title);
      if (translated === null || translated === undefined) continue;
      const url = urlOf(target.host, translated);
      if (new RegExp(`"${target.locale}":\\s*"`).test(block.body)) {
        const current = new RegExp(`"${target.locale}":\\s*"([^"]+)"`).exec(
          block.body
        )[1];
        if (current !== url)
          drifted.push(`${name} ${target.locale} : ${current} ≠ ${url}`);
        continue;
      }
      additions.push(`${indent}"${target.locale}": "${url}"`);
    }
    if (additions.length === 0) continue;
    // Insertion APRÈS les langues déjà présentes, pour garder l'ordre en, fr, es, pt-BR : une
    // fiche se relit, et voir l'espagnol avant l'anglais ferait douter de la langue de repli.
    const closeAt = block.body.lastIndexOf('}');
    const head = block.body.slice(0, closeAt).replace(/\s+$/, '');
    const closeIndent = indent.slice(0, Math.max(0, indent.length - 2));
    const inserted = `${head},\n${additions.join(',\n')}\n${closeIndent}}`;
    source =
      source.slice(0, block.open) + inserted + source.slice(block.end + 1);
  }
  if (source !== original) {
    changed += 1;
    if (!check) writeFileSync(path, source, 'utf8');
  }
}

if (check) {
  if (changed > 0 || drifted.length > 0) {
    console.error(
      `${changed} fiche(s) à compléter, ${drifted.length} lien(s) qui ont dérivé :\n` +
        drifted.join('\n')
    );
    process.exit(1);
  }
  console.log('les liens interlangues des fiches sont à jour');
} else {
  console.log(`${changed} fiche(s) écrite(s)`);
  if (drifted.length > 0) {
    console.error(`liens divergents, NON réécrits :\n${drifted.join('\n')}`);
    process.exit(1);
  }
}
