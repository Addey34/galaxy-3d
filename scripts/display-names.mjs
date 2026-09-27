/* global console, process */
/**
 * LE NOM D'AFFICHAGE D'UN CORPS, DANS LES QUATRE LANGUES (lot 20, phase 20B).
 *
 * Écrit ou complète `displayName` dans chaque fiche du registre, depuis la table
 * `scripts/display-names.json`. La table est ici, hors des fiches, pour qu'on puisse la relire
 * d'un bloc : soixante-dix noms propres, et la RÈGLE qui décide de leur forme.
 *
 * LA RÈGLE, écrite parce qu'elle n'est pas évidente et qu'elle a des exceptions :
 *
 *   - un corps nommé d'après la mythologie gréco-romaine, et dont la forme localisée est
 *     ancienne (les planètes, les lunes classiques, les premiers astéroïdes), prend la forme
 *     établie de la langue : Jápeto, Encélado, Plutão, Higía ;
 *   - un corps découvert depuis 1990, ou nommé hors de cette tradition, garde sa désignation
 *     UAI : Bennu, Ryugu, Quaoar, Sedna, Makemake, Gonggong, Orcus. Localiser le seul Orcus
 *     dans une liste qui contient Quaoar et Sedna serait arbitraire ;
 *   - la source de la forme localisée est le TITRE de l'article Wikipédia de la langue, obtenu
 *     par l'API interlangue (`scripts/wiki-langlinks.mjs`), débarrassé de son homonymie et de son
 *     numéro de catalogue — pas ma mémoire.
 *
 * UNE EXCEPTION MESURÉE, et c'est celle qui justifie de tout écrire : le titre portugais de
 * Vénus est « Vénus (planeta) », qui est l'orthographe du PORTUGAL. Le brésilien écrit
 * « Vênus », avec un accent circonflexe. Nous livrons du portugais du BRÉSIL, donc la table
 * porte « Vênus » et non le titre de l'article. Suivre aveuglément la source aurait livré, sous
 * l'étiquette `pt-BR`, une forme que le Brésil n'écrit pas.
 *
 *   node scripts/display-names.mjs          écrit les fiches
 *   node scripts/display-names.mjs --check   code 1 si une fiche diverge de la table
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = JSON.parse(
  readFileSync(join(ROOT, 'scripts/display-names.json'), 'utf8')
);
const check = process.argv.includes('--check');

const LOCALES = ['en', 'fr', 'es', 'pt-BR'];

/** Où vit la fiche d'un identifiant, et sous quelle clé son bloc de configuration. */
function locate(id) {
  for (const [dir, holder] of [
    ['src/registry/entities', null],
    ['src/registry/spacecraft', 'root'],
    ['src/registry/interstellar', 'root'],
  ]) {
    const path = join(ROOT, dir, `${id}.json`);
    try {
      const source = readFileSync(path, 'utf8');
      return { path, source, holder };
    } catch {
      /* fiche ailleurs */
    }
  }
  throw new Error(`fiche introuvable pour « ${id} »`);
}

let written = 0;
const diverging = [];
for (const [id, names] of Object.entries(TABLE)) {
  for (const locale of LOCALES)
    if (typeof names[locale] !== 'string' || names[locale] === '')
      throw new Error(`${id} : le nom ${locale} manque dans la table`);
  const { path, source } = locate(id);

  // Le bloc à écrire, indenté comme son voisinage.
  const existing = /^(\s*)"displayName": \{[^}]*\}/m.exec(source);
  const indent = existing
    ? existing[1]
    : (/^(\s*)"kind":/m.exec(source)?.[1] ?? '  ');
  const body = LOCALES.map(
    (locale) => `${indent}  "${locale}": ${JSON.stringify(names[locale])}`
  ).join(',\n');
  const block = `${indent}"displayName": {\n${body}\n${indent}}`;

  let next;
  if (existing) {
    next =
      source.slice(0, existing.index) +
      block +
      source.slice(existing.index + existing[0].length);
  } else {
    // Aucun bloc : on l'insère juste après `"kind": …`, où il vit dans les autres fiches.
    const kind = /^(\s*)"kind": "[^"]*",$/m.exec(source);
    if (!kind)
      throw new Error(
        `${id} : ni displayName ni "kind" pour y accrocher le bloc`
      );
    const at = kind.index + kind[0].length;
    next = `${source.slice(0, at)}\n${block},${source.slice(at)}`;
  }
  JSON.parse(next); // refus d'un JSON cassé avant écriture
  if (next === source) continue;
  if (check) diverging.push(id);
  else {
    writeFileSync(path, next, 'utf8');
    written += 1;
  }
}

if (check) {
  if (diverging.length > 0) {
    console.error(
      `${diverging.length} fiche(s) divergent de la table : ${diverging.join(', ')}`
    );
    process.exit(1);
  }
  console.log(
    `les ${Object.keys(TABLE).length} noms d'affichage sont conformes à la table`
  );
} else {
  console.log(`${written} fiche(s) écrite(s) sur ${Object.keys(TABLE).length}`);
}
