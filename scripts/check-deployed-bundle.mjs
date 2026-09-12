#!/usr/bin/env node
/* global console, process, fetch, setTimeout */
/**
 * APRÈS un déploiement : ce que le site sert VRAIMENT est-il ce qu'on vient de construire ?
 *
 * Pourquoi ce script existe. « CI verte » ne dit rien de ce qui est en ligne. Le 2026-09-11
 * j'ai affirmé deux fois, à tort, l'état de la production — d'abord qu'un quota Firebase
 * bloquait les déploiements, ensuite qu'elle servait un commit vieux de six versions. Les deux
 * étaient faux, et les deux venaient de la même erreur : lire le résultat GLOBAL d'un run
 * (rouge à cause des shards e2e) au lieu du job qui déploie, puis extrapoler. La vérification
 * qui aurait tranché en dix secondes tient en une requête HTTP.
 *
 * Elle est faite À LA MAIN dans ce projet depuis des semaines — le journal de bord répète
 * « vérifié en production, pas seulement CI verte », et chaque fois c'est ce même geste :
 * récupérer l'asset servi et le comparer au `dist/` local. L'automatiser, c'est retirer à
 * l'humain la seule étape que personne ne pense à faire quand tout a l'air vert.
 *
 * Ce script ne BLOQUE rien : il tourne après le déploiement, donc il ne peut rien empêcher.
 * Il échoue bruyamment quand la production diverge, ce qui est exactement l'information que
 * personne n'avait aujourd'hui.
 *
 * Propagation : Firebase Hosting sert le nouveau contenu très vite, mais pas instantanément
 * partout. On réessaie donc quelques fois avant de conclure — sans quoi ce garde-fou
 * deviendrait un signal rouge aléatoire, c'est-à-dire un signal qu'on finit par ignorer.
 */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ORIGIN = process.env.SITE_ORIGIN ?? 'https://galaxy.adrianguichard.dev';
const ATTEMPTS = Number(process.env.ATTEMPTS ?? 6);
const DELAY_MS = Number(process.env.DELAY_MS ?? 10_000);

/** Le nom haché de l'entrée applicative dans le build local. */
async function localEntryName() {
  const dir = resolve(process.cwd(), 'dist/assets');
  const files = await readdir(dir);
  const entry = files.find(
    (f) => f.startsWith('SolarSystemApp-') && f.endsWith('.js')
  );
  if (!entry)
    throw new Error(
      "dist/assets ne contient aucun SolarSystemApp-*.js : le build n'a pas tourné ?"
    );
  return entry;
}

/** Le nom haché que la production référence réellement dans son index.html. */
async function servedEntryName() {
  // `cache: 'no-store'` : l'index est servi avec un max-age court, mais on veut la vérité de
  // l'instant, pas ce qu'un cache intermédiaire a bien voulu garder.
  const response = await fetch(`${ORIGIN}/`, { cache: 'no-store' });
  if (!response.ok)
    throw new Error(
      `${ORIGIN}/ répond ${response.status} ${response.statusText}`
    );
  const html = await response.text();
  const match = html.match(/assets\/(SolarSystemApp-[A-Za-z0-9_-]+\.js)/);
  if (!match)
    throw new Error(
      "l'index servi ne référence aucun SolarSystemApp-*.js — structure du build changée ?"
    );
  return match[1];
}

/**
 * Une vignette de partage NE DOIT PAS être mise en cache comme un asset versionné.
 *
 * `firebase.json` pose un cache immuable d'UN AN sur `/assets/**`, ce qui est juste : leurs
 * noms portent un hachage, donc un nouveau contenu a toujours un nouveau nom. Les vignettes,
 * elles, ont un nom STABLE (`/social/bennu.jpg`) et des octets réécrits à chaque build. Les
 * ranger sous `/assets/` — ou étendre la règle par inadvertance — figerait pendant un an une
 * image qu'on ne pourrait plus corriger, chez tous ceux qui l'ont déjà vue.
 *
 * C'est exactement le genre d'invariant qu'on vérifie une fois à la main puis jamais plus.
 */
async function assertCardIsNotImmutable() {
  const response = await fetch(`${ORIGIN}/social/earth.jpg`, {
    cache: 'no-store',
  });
  if (!response.ok)
    return `/social/earth.jpg répond ${response.status} — vignette absente ?`;
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (/immutable/i.test(cacheControl) || /max-age=(\d{7,})/.test(cacheControl))
    return (
      `/social/earth.jpg est servie avec « ${cacheControl} ».\n` +
      `  Son nom est STABLE et ses octets sont reecrits a chaque build : un cache long\n` +
      `  fige une image qu'on ne pourra plus corriger. Verifier la regle /assets/** dans\n` +
      `  firebase.json — les vignettes doivent rester en dehors.`
    );
  console.log(`OK — vignettes servies avec « ${cacheControl} », non figees`);
  return null;
}

const expected = await localEntryName();
let served = null;

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    served = await servedEntryName();
  } catch (error) {
    console.log(`tentative ${attempt}/${ATTEMPTS} : ${error.message}`);
  }
  if (served === expected) break;
  if (attempt < ATTEMPTS) {
    console.log(
      `tentative ${attempt}/${ATTEMPTS} : en ligne ${served ?? '(illisible)'}, attendu ${expected} — nouvelle tentative dans ${DELAY_MS / 1000}s`
    );
    await new Promise((ok) => setTimeout(ok, DELAY_MS));
  }
}

// `process.exitCode` et NON `process.exit()`. Sous Windows, quitter abruptement pendant qu'une
// connexion `fetch` est encore ouverte fait planter Node dans libuv
// (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`) et rend un code 127 : l'étape CI
// échouerait alors que la vérification vient de réussir. Mesuré, pas supposé — c'est ce qu'a
// fait la toute première version de ce script. On laisse la boucle d'événements se vider.
if (served === expected) {
  console.log(`OK — ${ORIGIN} sert bien ${expected}`);
  const cacheProblem = await assertCardIsNotImmutable();
  if (cacheProblem) {
    console.error(`\nCACHE DES VIGNETTES : ${cacheProblem}\n`);
    process.exitCode = 1;
  }
} else {
  console.error(
    `\nLA PRODUCTION NE SERT PAS CE BUILD.\n` +
      `  construit : ${expected}\n` +
      `  en ligne  : ${served ?? '(illisible)'}\n\n` +
      `Le deploiement a echoue, n'a pas eu lieu, ou une ancienne version a ete restauree.\n` +
      `Ne pas se fier au resultat global du run : lire le job « Verify and build », c'est lui\n` +
      `qui deploie (gh run view <id> --json jobs).\n`
  );
  process.exitCode = 1;
}
