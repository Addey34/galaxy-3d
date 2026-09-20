#!/usr/bin/env node
/* global console, fetch, setTimeout, URLSearchParams */
/**
 * INSTANTANÉ DES PETITS CORPS : les 4 requêtes SBDB, tirées ICI plutôt que par le navigateur.
 *
 * Pourquoi. `ssd-api.jpl.nasa.gov` répond HTTP 200 SANS en-tête `Access-Control-Allow-Origin`
 * (mesuré au curl avec l'`Origin` du site le 2026-09-20, quatre fois) : un navigateur jette
 * donc la réponse, et la couche des petits corps était VIDE en production depuis toujours,
 * silencieusement, alors qu'elle se remplissait en développement. Ce n'est pas la CSP, qui
 * autorisait l'hôte. Node, lui, n'applique aucune politique d'origine : le relevé se fait au
 * build, et l'application ne contacte plus JPL du tout.
 *
 * Ce que ça change, et qu'il faut dire : la donnée devient un INSTANTANÉ DATÉ, pas un flux.
 * Elle porte donc sa date, que le panneau affiche. Les éléments osculateurs dérivent lentement
 * (ce sont déjà des éléments à une époque, propagés par `core/kepler.ts`) : re-lancer
 * `pnpm smallbodies:generate` est un acte délibéré, comme pour les éphémérides.
 *
 *   pnpm smallbodies:generate
 *
 * La forme du fichier est CELLE DE L'API (`fields` + `data` par catégorie) : `parseSbdbRows`
 * la lit sans une ligne de conversion, et ce qui est commité reste comparable à la source.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'public/assets/small-bodies';
const OUT = `${OUT_DIR}/dataset.json`;
const LIMIT = 2000;

/**
 * Paramètres par catégorie — copie EXACTE de `sbdbQueryUrl` (`src/core/sbdb.ts`), qui reste la
 * source de vérité et que `sbdb.test.ts` compare à ce fichier. `sb-group` n'accepte que
 * 'neo'/'pha', `sb-kind` que 'a'/'c' ; la ceinture principale et les transneptuniens se
 * dérivent du demi-grand axe par `sb-cdata`.
 */
const CATEGORIES = {
  'main-belt': { 'sb-kind': 'a', 'sb-cdata': '{"AND":["a|LT|4.5"]}' },
  neo: { 'sb-group': 'neo' },
  comet: { 'sb-kind': 'c' },
  tno: { 'sb-kind': 'a', 'sb-cdata': '{"AND":["a|GT|30"]}' },
};

const url = (extra) => {
  const params = new URLSearchParams({
    fields: 'full_name,a,e,i,om,w,ma,epoch',
    ...extra,
  });
  params.set('limit', String(LIMIT));
  return `https://ssd-api.jpl.nasa.gov/sbdb_query.api?${params.toString()}`;
};

/** L'API répond 502 par intermittence : une erreur de SERVEUR se retente, une 4xx non. */
async function getJson(target) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(target);
    if (response.ok) return response.json();
    if (response.status < 500 || attempt >= 4)
      throw new Error(`HTTP ${response.status} : ${target}`);
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
}

const categories = {};
for (const [category, extra] of Object.entries(CATEGORIES)) {
  const json = await getJson(url(extra));
  if (!Array.isArray(json.fields) || !Array.isArray(json.data))
    throw new Error(`réponse SBDB inattendue pour ${category}`);
  // Une catégorie vide passerait inaperçue à l'exécution (la couche dégrade à rien) : elle
  // doit faire échouer la GÉNÉRATION, seul moment où quelqu'un regarde.
  if (json.data.length === 0)
    throw new Error(`SBDB n'a renvoyé aucune ligne pour ${category}`);
  categories[category] = { fields: json.fields, data: json.data };
  console.log(`${category} : ${json.data.length} lignes sur ${json.count}`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      generatedBy: 'scripts/generate-small-body-dataset.mjs',
      source: 'https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html',
      retrieved: new Date().toISOString().slice(0, 10),
      limitPerCategory: LIMIT,
      categories,
    },
    null,
    0
  )}\n`
);
console.log(`écrit ${OUT}`);
