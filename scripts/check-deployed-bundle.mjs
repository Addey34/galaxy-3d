#!/usr/bin/env node
/* global console, process, fetch, setTimeout, AbortSignal */
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
import { readLimits } from './deployed-bundle-limits.mjs';

/*
 * Chaque requete est BORNEE dans le temps et son corps n'est jamais laisse ouvert (2026-11-16).
 * Le run 43885534027 a affiche les quatre « OK » puis plus rien pendant six minutes, jusqu'a
 * l'annulation du job : le script avait fini, mais le processus ne sortait pas. Cause : le corps
 * de `GET /social/earth.jpg` n'etait ni lu ni annule, et la connexion restait occupee jusqu'a ce
 * que le ramasse-miettes finalise la reponse (6 a 8 s mesures en local, ce qui est aussi la duree
 * habituelle de cette etape en CI, et rien du tout le jour ou le GC ne vient pas). Sans delai, un
 * serveur muet aurait de toute facon tenu le processus des minutes. D'ou deux regles :
 *   - `call()` annule le corps de TOUTE reponse non consommee, y compris sur les chemins d'erreur ;
 *   - le signal de delai couvre aussi la LECTURE du corps, pas seulement les en-tetes.
 * On ne force pas la sortie : `process.exit()` plante libuv sous Windows (voir plus bas).
 */
const ORIGIN = process.env.SITE_ORIGIN ?? 'https://galaxy.adrianguichard.dev';
let ATTEMPTS = 6;
let DELAY_MS = 10_000;
let FETCH_TIMEOUT_MS = 15_000;

/** Un controle qui ECHOUE (production divergente, en-tete interdit) : message sans pile. */
class CheckError extends Error {}

/**
 * Une requete bornee. `read(response)` extrait ce dont on a besoin ; ce qui reste du corps est
 * annule dans tous les cas (succes, statut d'erreur, exception). Une expiration ou une erreur
 * reseau devient un message qui dit QUOI, OU et APRES COMBIEN, au lieu d'une pile d'undici.
 */
async function call(label, url, init, read) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return await read(response);
  } catch (error) {
    if (error instanceof CheckError) throw error;
    const timedOut =
      error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const detail = timedOut
      ? `expiration apres ${FETCH_TIMEOUT_MS / 1000} s sans reponse complete`
      : `erreur reseau (${error?.cause?.code ?? error?.message ?? error})`;
    throw new CheckError(`${label} : ${detail} sur ${url}`);
  } finally {
    if (response && !response.bodyUsed)
      await response.body?.cancel().catch(() => undefined);
  }
}

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
  return call(
    'index',
    `${ORIGIN}/`,
    { cache: 'no-store' },
    async (response) => {
      if (!response.ok)
        throw new CheckError(
          `${ORIGIN}/ répond ${response.status} ${response.statusText}`
        );
      const html = await response.text();
      const match = html.match(/assets\/(SolarSystemApp-[A-Za-z0-9_-]+\.js)/);
      if (!match)
        throw new CheckError(
          "l'index servi ne référence aucun SolarSystemApp-*.js — structure du build changée ?"
        );
      return match[1];
    }
  );
}

/**
 * Une vignette de partage NE DOIT PAS être mise en cache comme un asset versionné.
 *
 * `firebase.json` garde un cache immuable d'UN AN sur les assets réellement versionnés, mais
 * les préfixes à nom STABLE (`/assets/textures/**`, `/assets/models/**`) le réécrasent avec
 * une politique de revalidation. Les vignettes ont elles aussi un nom STABLE
 * (`/social/bennu.jpg`) et des octets réécrits à chaque build. Les
 * ranger sous `/assets/` — ou étendre la règle par inadvertance — figerait pendant un an une
 * image qu'on ne pourrait plus corriger, chez tous ceux qui l'ont déjà vue.
 *
 * C'est exactement le genre d'invariant qu'on vérifie une fois à la main puis jamais plus.
 */
async function assertCardIsNotImmutable() {
  // GET et non HEAD : c'est ce qu'un navigateur demande. Seuls les en-tetes comptent, le corps
  // (une image) est annule par `call()`.
  return call(
    'vignette',
    `${ORIGIN}/social/earth.jpg`,
    { cache: 'no-store' },
    async (response) => {
      if (!response.ok)
        return `/social/earth.jpg répond ${response.status} — vignette absente ?`;
      const cacheControl = response.headers.get('cache-control') ?? '';
      if (
        /immutable/i.test(cacheControl) ||
        /max-age=(\d{7,})/.test(cacheControl)
      )
        return (
          `/social/earth.jpg est servie avec « ${cacheControl} ».\n` +
          `  Son nom est STABLE et ses octets sont reecrits a chaque build : un cache long\n` +
          `  fige une image qu'on ne pourra plus corriger. Verifier la regle /assets/** dans\n` +
          `  firebase.json — les vignettes doivent rester en dehors.`
        );
      console.log(
        `OK — vignettes servies avec « ${cacheControl} », non figees`
      );
      return null;
    }
  );
}

/** Les URLs stables qui peuvent changer entre deux releases doivent se revalider rapidement. */
async function assertStableAssetsRevalidate() {
  const paths = [
    '/assets/ephemerides/manifest.json',
    '/assets/textures/earth/earth_surface_1k.jpg',
  ];
  for (const path of paths) {
    const problem = await call(
      path,
      `${ORIGIN}${path}`,
      { method: 'HEAD', cache: 'no-store' },
      async (response) => {
        if (!response.ok) return `${path} répond ${response.status}`;
        const cacheControl = response.headers.get('cache-control') ?? '';
        // `\d` et non `\\d` : l'antislash double cherchait un antislash litteral, donc ce
        // controle ne voyait JAMAIS un `max-age` long sans `immutable` (corrige 2026-11-16).
        if (
          /immutable/i.test(cacheControl) ||
          /max-age=(\d{7,})/.test(cacheControl)
        )
          return `${path} a un nom stable mais est servi avec « ${cacheControl} »`;
        console.log(`OK — ${path} se revalide avec « ${cacheControl} »`);
        return null;
      }
    );
    if (problem) return problem;
  }
  return null;
}

/** Une verification qui ne peut pas se faire (reseau, delai) echoue avec son diagnostic. */
async function guarded(name, check) {
  try {
    return await check();
  } catch (error) {
    if (!(error instanceof CheckError)) throw error;
    return `controle impossible : ${error.message}`;
  }
}

async function main() {
  try {
    const limits = readLimits(process.env);
    ATTEMPTS = limits.attempts;
    DELAY_MS = limits.delayMs;
    FETCH_TIMEOUT_MS = limits.timeoutMs;
  } catch (error) {
    // Code 2 : le script n'a RIEN verifie. Ce n'est pas un « la production diverge » (code 1).
    console.error(
      `Reglage invalide, aucune verification faite : ${error.message}`
    );
    process.exitCode = 2;
    return;
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
    const cacheProblem = await guarded('vignette', assertCardIsNotImmutable);
    const stableAssetProblem = await guarded(
      'assets stables',
      assertStableAssetsRevalidate
    );
    if (cacheProblem) {
      console.error(`
CACHE DES VIGNETTES : ${cacheProblem}
`);
      process.exitCode = 1;
    }
    if (stableAssetProblem) {
      console.error(`
CACHE DES ASSETS STABLES : ${stableAssetProblem}
`);
      process.exitCode = 1;
    }
  } else {
    console.error(
      `
LA PRODUCTION NE SERT PAS CE BUILD.
` +
        `  construit : ${expected}
` +
        `  en ligne  : ${served ?? '(illisible)'}

` +
        `Le deploiement a echoue, n'a pas eu lieu, ou une ancienne version a ete restauree.
` +
        `Ne pas se fier au resultat global du run : lire le job « Verify and build », c'est lui
` +
        `qui deploie (gh run view <id> --json jobs).

` +
        `EN LOCAL, la cause la plus probable est un dist/ PERIME, pas un deploiement rate :
` +
        `ce script compare la production au dernier build LOCAL. Lancer « pnpm build » d'abord.
` +
        `En CI la question ne se pose pas, l'etape suit immediatement le build.
`
    );
    process.exitCode = 1;
  }
}

await main();
