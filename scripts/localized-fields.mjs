/* global console, process */
/**
 * LES CHAMPS LOCALISÉS DU REGISTRE — relevé, puis remplissage par insertion TEXTE (lot 20, 20B).
 *
 * Deux modes :
 *
 *   node scripts/localized-fields.mjs --dump > champs.json     relève tout ce qui est localisé
 *   node scripts/localized-fields.mjs --fill champs.json        insère `es` et `pt-BR`
 *   node scripts/localized-fields.mjs --check                   code 1 s'il reste un champ à deux
 *                                                               langues (garde, sans réseau)
 *
 * POURQUOI UNE INSERTION TEXTE : `JSON.parse` + `JSON.stringify` réécrirait `0.0000803236` en
 * `8.03236e-05` et churnerait des dizaines de fiches qui n'ont rien à voir avec ce lot. Le piège
 * est écrit dans `CLAUDE.md`, et il a déjà coûté une fois.
 *
 * Le repérage se fait sur la valeur FRANÇAISE, qui est unique dans son fichier : chaque insertion
 * exige EXACTEMENT une occurrence, sinon le script s'arrête. Les liens Wikipédia ne passent pas
 * par ici — ils sont DÉRIVÉS de l'API interlangue par `scripts/wiki-langlinks.mjs`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [
  'src/registry/entities',
  'src/registry/spacecraft',
  'src/registry/interstellar',
  'src/registry/providers',
  'src/registry/tours',
];

const args = process.argv.slice(2);

/** Tous les fichiers de fiches, chemin relatif à la racine. */
function fiches() {
  const out = [];
  for (const dir of DIRS) {
    const full = join(ROOT, dir);
    for (const name of readdirSync(full).filter((f) => f.endsWith('.json')))
      out.push(relative(ROOT, join(full, name)).split('\\').join('/'));
  }
  return out;
}

/**
 * Tout objet `{ en, fr, … }` d'une fiche, avec son chemin JSON et ses valeurs.
 * Les blocs `wiki` sont EXCLUS : ils ont leur propre source (l'API interlangue).
 */
function localizedBlocks(json, path = '') {
  const out = [];
  if (json === null || typeof json !== 'object') return out;
  // Un bloc localisé est un objet dont TOUTES les clés sont des langues, et dont au moins une
  // porte une chaîne. Détecter sur la seule présence de `en` en manquait toute une famille :
  // `displayName` d'un corps dont le nom anglais est la clé capitalisée ne déclare QUE `fr`
  // (« Terre », « Soleil », « Cérès »). Mesuré au lot 20, phase 20B : l'inventaire du plan en
  // annonçait 227, il y en a davantage, et c'est cette détection-ci qui fait foi.
  const keys = Array.isArray(json) ? [] : Object.keys(json);
  const isLocalized =
    keys.length > 0 &&
    keys.every((key) => ['en', 'fr', 'es', 'pt-BR'].includes(key)) &&
    keys.some((key) => typeof json[key] === 'string');
  if (isLocalized) {
    if (!path.endsWith('wiki'))
      out.push({
        path,
        en: typeof json.en === 'string' ? json.en : null,
        fr: typeof json.fr === 'string' ? json.fr : null,
        es: typeof json.es === 'string' ? json.es : null,
        'pt-BR': typeof json['pt-BR'] === 'string' ? json['pt-BR'] : null,
      });
    return out;
  }
  for (const [key, value] of Object.entries(json))
    out.push(
      ...localizedBlocks(
        value,
        Array.isArray(json) ? path : `${path ? path + '.' : ''}${key}`
      )
    );
  return out;
}

if (args.includes('--dump') || args.includes('--check')) {
  const rows = [];
  for (const file of fiches()) {
    const json = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
    for (const block of localizedBlocks(json)) rows.push({ file, ...block });
  }
  const incomplete = rows.filter(
    (row) => row.es === null || row['pt-BR'] === null
  );
  if (args.includes('--check')) {
    console.log(
      `${rows.length} champs localisés, ${incomplete.length} incomplets`
    );
    if (incomplete.length > 0) {
      for (const row of incomplete.slice(0, 40))
        console.error(`  ${row.file} ${row.path}`);
      process.exit(1);
    }
    process.exit(0);
  }
  console.log(JSON.stringify(incomplete, null, 1));
  process.exit(0);
}

const fillAt = args.indexOf('--fill');
if (fillAt < 0) {
  console.error('usage : --dump | --fill <fichier.json> | --check');
  process.exit(1);
}
const payload = JSON.parse(readFileSync(args[fillAt + 1], 'utf8'));
let written = 0;
const byFile = new Map();
for (const row of payload) {
  if (!byFile.has(row.file)) byFile.set(row.file, []);
  byFile.get(row.file).push(row);
}
/**
 * La valeur à un chemin JSON pointé (`config.realData.description`).
 *
 * Nommée `valueAtPath` et non `at` : la boucle plus bas déclare son propre `const at` (la
 * position du repère dans le texte), qui masquait cette fonction sur tout le bloc et faisait
 * échouer le script en zone morte temporelle.
 */
function valueAtPath(json, path) {
  let node = json;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

for (const [file, rows] of byFile) {
  const path = join(ROOT, file);
  const original = readFileSync(path, 'utf8');
  const parsed = JSON.parse(original);
  let source = original;
  for (const row of rows) {
    if (typeof row.es !== 'string' || typeof row['pt-BR'] !== 'string') {
      console.error(`${file} ${row.path} : traduction manquante`);
      process.exit(1);
    }
    // La valeur française est LUE dans la fiche, jamais recopiée dans la charge utile : une
    // apostrophe typographique retapée de travers aurait fait échouer le repérage, ou pire,
    // l'aurait fait réussir sur le mauvais bloc.
    const block = valueAtPath(parsed, row.path);
    if (!block || typeof block.fr !== 'string') {
      console.error(
        `${file} ${row.path} : aucun bloc localisé avec un français à ce chemin`
      );
      process.exit(1);
    }
    row.fr = block.fr;
    // Repérage par la valeur FRANÇAISE, échappée comme JSON l'écrit.
    const needle = `"fr": ${JSON.stringify(row.fr)}`;
    const occurrences = source.split(needle).length - 1;
    if (occurrences !== 1) {
      console.error(
        `${file} ${row.path} : ${occurrences} occurrence(s) de la valeur française, ` +
          `il en faut exactement une`
      );
      process.exit(1);
    }
    const at = source.indexOf(needle);
    const lineStart = source.lastIndexOf('\n', at) + 1;
    const indent = source.slice(lineStart, at);
    const after = at + needle.length;
    // La ligne française peut être suivie d'une virgule (d'autres clés suivent) ou non.
    const tail = source.slice(after, after + 1) === ',' ? ',' : '';
    const addition =
      `${tail}\n${indent}"es": ${JSON.stringify(row.es)},` +
      `\n${indent}"pt-BR": ${JSON.stringify(row['pt-BR'])}${tail ? '' : ''}`;
    source =
      source.slice(0, after) + addition + source.slice(after + tail.length);
    if (!tail) {
      // Pas de virgule après le français : il faut en ajouter une AVANT nos deux lignes.
      const fixed = source.slice(0, after) + ',' + source.slice(after);
      source = fixed;
    }
  }
  if (source !== original) {
    JSON.parse(source); // refus immédiat d'un JSON cassé, avant d'écrire
    writeFileSync(path, source, 'utf8');
    written += 1;
  }
}
console.log(
  `${written} fiche(s) écrite(s), ${payload.length} champ(s) complété(s)`
);
