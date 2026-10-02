#!/usr/bin/env node
/* global console, process, fetch, URL, AbortSignal */
/**
 * LES SOURCES DONT CE DÉPÔT DÉPEND SONT-ELLES ENCORE VIVANTES ? Lu, pas supposé.
 *
 * POURQUOI. Trois lots ont été bloqués par une source muette, et les trois fois c'est un sondage
 * À LA MAIN qui l'a révélé : au lot 25, quatre fiches du Master Catalog du NSSDCA servaient leur
 * page « Errors and Messages » en HTTP 200 ; au lot 27, Magellan, Cassini et Galileo faisaient de
 * même. Entre les deux, personne ne regardait. `pnpm ci:health` rend ce service pour la CI ; ce
 * script le rend pour les sources, avec le même principe et les mêmes refus.
 *
 * UN CODE HTTP NE PROUVE RIEN, et c'est tout l'objet. Le NSSDCA sert ses erreurs en 200 ; la
 * réécriture SPA de Firebase rend `index.html` pour tout chemin inconnu. Une source est donc jugée
 * sur un MARQUEUR trouvé dans sa réponse, jamais sur son statut. Chaque marqueur a été LU sur une
 * vraie réponse, et le commentaire dit laquelle.
 *
 * QUATRE VERDICTS, et la distinction est tout l'intérêt :
 *   - VIVANTE : la réponse porte son marqueur ;
 *   - MUETTE : une réponse est arrivée et ne porte PAS son marqueur (code 1). C'est le cas du
 *     NSSDCA, et c'est celui qu'aucun contrôle de statut n'attrape ;
 *   - DÉTOURNÉE : la réponse vient d'un AUTRE hôte, donc d'un portail intercalé (code 2). Mesuré
 *     le 2026-09-29 : nature.com renvoie vers `idp.nature.com/transit`, qui pose un cookie puis
 *     rebondit en JavaScript ; `curl -L` traverse, `fetch` s'arrête là. La dire « muette »
 *     accuserait Nature d'avoir perdu son article, ce qui est faux, et un guetteur qui crie au
 *     loup finit ignoré ;
 *   - NON MESURÉE : rien n'est arrivé, réseau ou délai (code 2). « Je n'ai pas pu mesurer » n'est
 *     PAS « tout va bien », leçon du lot 24 reprise telle quelle.
 *
 * LA LISTE SE DÉRIVE, elle ne s'écrit pas. Elle vient du relevé des faits livré
 * (`src/config/factSources.snapshot.json`, qui enregistre l'`url` de chaque entrée) et des fiches
 * de jeux de tuiles (leur lien `describedby`, c'est-à-dire leurs capabilities WMTS). Ajouter une
 * source au projet l'ajoute donc ici sans que personne y pense, ce qui est exactement ce qui a
 * manqué.
 *
 * Aucune dépendance, aucun `jq` (il n'est pas installé sur la machine de développement), aucun
 * serveur : un `node` nu suffit, comme pour `check-ci-health.mjs`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const asMarkdown = argv.includes('--markdown');
const only = (() => {
  const i = argv.indexOf('--only');
  return i === -1 ? null : argv[i + 1];
})();
const timeoutMs = (() => {
  const i = argv.indexOf('--timeout');
  return i === -1 ? 30_000 : Number(argv[i + 1]);
})();

// ───────────────────────────── les marqueurs ─────────────────────────────

/**
 * Ce qu'une réponse doit contenir pour que la source soit dite vivante.
 *
 * Un marqueur est soit DÉRIVÉ de l'URL (le meilleur cas : rien à maintenir), soit déclaré ici
 * pour un préfixe, avec la date où il a été lu sur une vraie réponse. L'ordre compte : le premier
 * préfixe qui correspond gagne.
 */
const MARKERS = [
  {
    prefix: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/',
    // Lu au lot 25 : c'est LA marque qui distingue une fiche servie d'une page « Errors and
    // Messages », que ce site rend en HTTP 200.
    marker: () => 'NSSDCA/COSPAR ID',
    what: 'fiche du Master Catalog',
  },
  {
    prefix: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/',
    // Lu le 2026-09-29 sur l'index des fiches, présent cinq fois.
    marker: () => 'Planetary Fact Sheet',
    what: 'fiche planétaire',
  },
  {
    prefix: 'https://ssd.jpl.nasa.gov/sats/',
    // Lu le 2026-09-29 : les tables de satellites portent leurs noms.
    marker: () => 'Enceladus',
    what: 'table des satellites',
  },
  {
    prefix: 'https://ssd.jpl.nasa.gov/planets/',
    // Lu le 2026-10-01 : la page des découvertes de planètes porte ce titre de section.
    marker: () => 'Discovery Circumstances',
    what: 'découvertes des planètes (JPL)',
  },
  {
    prefix: 'https://ssd-api.jpl.nasa.gov/sbdb.api',
    marker: () => '"object"',
    what: 'API du Small-Body Database',
  },
  {
    prefix: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/',
    // Lu le 2026-09-29 : le noyau PCK déclare les rayons corps par corps.
    marker: () => 'BODY399_RADII',
    what: 'noyau PCK générique',
  },
  {
    prefix: 'https://science.nasa.gov/',
    // DÉRIVÉ : le dernier segment du chemin est le sujet de la page.
    marker: (url) => {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] ?? '';
    },
    what: 'page NASA Science',
  },
  {
    prefix: 'https://arxiv.org/abs/',
    // DÉRIVÉ : l'identifiant de l'article, que la page affiche en toutes lettres.
    marker: (url) => `arXiv:${new URL(url).pathname.split('/').pop()}`,
    what: 'résumé arXiv',
  },
  {
    prefix: 'https://www.nature.com/articles/',
    // Lu le 2026-09-29 : l'identifiant de l'article figure dans la page servie ; « nature » seul
    // ne vaut rien, il figure aussi dans les pages d'erreur du site.
    marker: (url) => new URL(url).pathname.split('/').pop() ?? '',
    what: 'article Nature',
  },
  {
    prefix: 'https://trek.nasa.gov/tiles/',
    marker: () => '<Capabilities',
    what: 'capabilities WMTS',
  },
  {
    prefix: 'https://oderest.rsl.wustl.edu/',
    /**
     * Lu le 2026-09-30 sur une réponse RÉELLE : l'ODE rend ses erreurs en HTTP 200, avec
     * `"Status": "ERROR"` (« Invalid IIPT »), et ses réponses valides avec `"Status": "Success"`.
     * Le code HTTP ne dit donc rien, et c'est ce statut qui tranche.
     */
    marker: () => '"Status": "Success"',
    what: 'Orbital Data Explorer (PDS Geosciences Node)',
  },
  {
    prefix: 'https://pds.nasa.gov/api/search/',
    /**
     * Lu le 2026-09-30 sur les réponses RÉELLES des requêtes que les générateurs emploient : le
     * NOM de l'entité est la propriété que le registre rend, et son absence voudrait dire que le
     * schéma a changé sous nous. Un code 200 ne suffirait pas : cette API rend 200 avec
     * `hits: 0` pour une requête dont la syntaxe ne correspond à rien, ce que le lot 36 avait
     * déjà payé sur cette même API.
     *
     * LE MARQUEUR SE DÉRIVE DE LA CLASSE INTERROGÉE, il ne s'écrit pas une fois par requête. Le
     * lot 42 interroge `pds:Instrument_Host`, dont la réponse ne contient AUCUN
     * `pds:Investigation.pds:name` : hériter du marqueur des missions par le seul préfixe aurait
     * déclaré cette source MUETTE alors qu'elle répond, et un guetteur qui crie au loup finit
     * ignoré. Une classe nouvelle est donc couverte sans que personne y pense.
     */
    marker: (url) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      const cls = /pds:([A-Za-z_]+)\.pds:/.exec(q)?.[1];
      return cls ? `pds:${cls}.pds:name` : 'pds:Investigation.pds:name';
    },
    what: 'registre de contexte du PDS',
  },
];

export const MARKER_RULES = MARKERS;

/** La règle qui s'applique à cette URL, ou `undefined` si aucune n'est déclarée. */
export const markerFor = (url) => MARKERS.find((m) => url.startsWith(m.prefix));

/**
 * LE VERDICT D'UNE RÉPONSE, sans réseau : c'est la partie qui se teste.
 *
 * `finalUrl` est l'adresse où le client a ATTERRI, qui n'est pas toujours celle demandée.
 */
export function judgeResponse({ url, finalUrl, body, status }) {
  const rule = markerFor(url);
  if (!rule)
    return { url, verdict: 'sans-marqueur', detail: 'aucun marqueur déclaré' };
  const expected = rule.marker(url);
  const alive = String(body)
    .toLowerCase()
    .includes(String(expected).toLowerCase());
  const landedElsewhere = new URL(finalUrl ?? url).host !== new URL(url).host;
  return {
    url,
    what: rule.what,
    verdict: alive ? 'vivante' : landedElsewhere ? 'détournée' : 'muette',
    status,
    bytes: String(body).length,
    expected,
    finalUrl: landedElsewhere ? (finalUrl ?? url) : undefined,
  };
}

/** Le code de sortie que ces résultats commandent. Un seul endroit décide. */
export function exitCodeFor(results) {
  const has = (v) => results.some((r) => r.verdict === v);
  if (has('muette')) return 1;
  if (has('non-mesurée') || has('détournée') || has('sans-marqueur')) return 2;
  return 0;
}

// ───────────────────────────── la liste, DÉRIVÉE ─────────────────────────────

/**
 * Le fragment d'une URL n'est JAMAIS envoyé au serveur : les 22 adresses `sbdb_lookup.html#/?sstr=`
 * du relevé désignent une seule et même page, et la donnée vient en réalité de l'API. On sonde
 * donc l'API, une fois, ce qui est la dépendance réelle.
 */
const SBDB_PAGE = 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html';
const SBDB_API = 'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1&phys-par=1';

export function derivedSources() {
  const urls = new Set();
  const snapshot = JSON.parse(
    readFileSync(join(ROOT, 'src/config/factSources.snapshot.json'), 'utf8')
  );
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.url === 'string') urls.add(value.url.split('#')[0]);
    for (const key of Object.keys(value)) walk(value[key]);
  };
  walk(snapshot);

  if (urls.delete(SBDB_PAGE)) urls.add(SBDB_API);

  /**
   * L'API du registre de contexte du PDS, DÉRIVÉE de l'index des missions (lot 40) : c'est le
   * générateur qui écrit l'URL qu'il interroge, et ce guetteur la relit. Personne ne la tient à
   * deux endroits, donc elle ne peut pas diverger.
   */
  const missions = JSON.parse(
    readFileSync(join(ROOT, 'src/config/missionIndex.json'), 'utf8')
  );
  if (typeof missions.provider?.api === 'string')
    urls.add(missions.provider.api);

  /** Idem pour l'Orbital Data Explorer, DÉRIVÉ de l'index des formations observées (ligne 40.3). */
  const places = JSON.parse(
    readFileSync(join(ROOT, 'src/config/placeObservationIndex.json'), 'utf8')
  );
  if (typeof places.provider?.api === 'string') urls.add(places.provider.api);

  /** Idem pour l'API des porteurs d'instruments, DÉRIVÉE de l'index des instruments (lot 42). */
  const instruments = JSON.parse(
    readFileSync(join(ROOT, 'src/config/instrumentIndex.json'), 'utf8')
  );
  if (typeof instruments.provider?.api === 'string')
    urls.add(instruments.provider.api);

  /**
   * Les sources de la découverte (lot 44), DÉRIVÉES de l'index : chaque affirmation cite l'adresse
   * qu'elle a lue, et l'API de SBDB est sondée une fois, comme pour le relevé des faits.
   */
  const discovery = JSON.parse(
    readFileSync(join(ROOT, 'src/config/discoveryIndex.json'), 'utf8')
  );
  for (const entry of Object.values(discovery.bodies ?? {}))
    for (const claim of entry.claims ?? []) {
      const url = claim.url.split('#')[0];
      urls.add(url === SBDB_PAGE ? SBDB_API : url);
    }
  // Les articles des croyances réfutées (ligne 22.10, front des croyances).
  for (const entry of Object.values(discovery.bodies ?? {}))
    for (const claim of entry.refuted ?? []) urls.add(claim.url);
  // Et chaque liste de satellites, qui DÉCLARE sa source (ligne 22.10, pas 2).
  for (const system of Object.values(discovery.systems ?? {})) {
    const url = system.url.split('#')[0];
    urls.add(url === SBDB_PAGE ? SBDB_API : url);
  }

  const tilesets = join(ROOT, 'src/registry/products/tilesets');
  for (const file of readdirSync(tilesets).filter((f) => f.endsWith('.json'))) {
    const fiche = JSON.parse(readFileSync(join(tilesets, file), 'utf8'));
    for (const link of fiche.links ?? [])
      if (link.rel === 'describedby') urls.add(link.href);
  }
  return [...urls].sort();
}

// ───────────────────────────── le sondage ─────────────────────────────

async function probe(url) {
  const rule = markerFor(url);
  if (!rule)
    return { url, verdict: 'sans-marqueur', detail: 'aucun marqueur déclaré' };
  let response;
  let body;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      // S'IDENTIFIER, sinon un blocage d'agent passe pour une source morte. Mesuré le
      // 2026-09-29 : nature.com rend un 303 puis une page de 3 036 octets à un client anonyme,
      // et 470 508 octets à un client identifié. Un guetteur qui confond les deux crie au loup,
      // et un guetteur qui crie au loup finit ignoré.
      headers: {
        'User-Agent':
          'Galaxy-Source-Health/1.0 (+https://galaxy.adrianguichard.dev)',
      },
    });
    body = await response.text();
  } catch (error) {
    // Rien n'est arrivé : on ne SAIT pas, et on ne prétend pas que tout va bien.
    return {
      url,
      what: rule.what,
      verdict: 'non-mesurée',
      detail: String(error?.message ?? error).slice(0, 120),
    };
  }
  return judgeResponse({
    url,
    finalUrl: response.url,
    body,
    status: response.status,
  });
}

/**
 * L'EXÉCUTION est refermée : importer ce module ne doit rien sonder, sans quoi la garde qui
 * l'éprouve déclencherait soixante requêtes réseau à chaque lancement de `pnpm verify`.
 */
async function main() {
  const sources = derivedSources().filter((u) => !only || u.includes(only));
  const results = [];
  for (const url of sources) results.push(await probe(url));

  const mute = results.filter((r) => r.verdict === 'muette');
  const unmeasured = results.filter((r) => r.verdict === 'non-mesurée');
  const unmarked = results.filter((r) => r.verdict === 'sans-marqueur');
  const diverted = results.filter((r) => r.verdict === 'détournée');
  const alive = results.filter((r) => r.verdict === 'vivante');

  if (asJson) {
    console.log(
      JSON.stringify({ results, mute, unmeasured, unmarked, diverted }, null, 2)
    );
  } else if (asMarkdown) {
    // Corps d'issue : ce que le guetteur ouvre doit se lire sans ouvrir un journal.
    console.log(
      `## Des sources dont Galaxy dépend ne répondent plus

` +
        `${alive.length} vivantes, ${mute.length} muettes, ${unmeasured.length} non mesurées, ` +
        `${diverted.length} détournées, ${unmarked.length} sans marqueur ` +
        `(${results.length} au total, DÉRIVÉES du dépôt).
`
    );
    if (mute.length > 0) {
      console.log(`
### Muettes : une réponse est arrivée SANS son marqueur
`);
      console.log(
        `Un code HTTP ne prouve rien ici : ces adresses répondent, mais ce qu'elles servent ` +
          `n'est pas ce dont le projet dépend.
`
      );
      for (const r of mute)
        console.log(
          `- \`${r.url}\` — ${r.status}, ${r.bytes} octets, sans « ${r.expected} » (${r.what})`
        );
    }
    for (const [title, rows] of [
      ['Détournées : un portail intercalé, pas une source morte', diverted],
      ['Non mesurées : rien n’est arrivé', unmeasured],
      ['Sans marqueur déclaré', unmarked],
    ])
      if (rows.length > 0) {
        console.log(`
### ${title}
`);
        for (const r of rows)
          console.log(
            `- \`${r.url}\`${r.finalUrl ? ` → \`${r.finalUrl}\`` : ''}${r.detail ? ` — ${r.detail}` : ''}`
          );
      }
  } else {
    console.log(
      `SOURCES : ${alive.length} vivantes, ${mute.length} muettes, ` +
        `${unmeasured.length} non mesurées, ${diverted.length} détournées, ` +
        `${unmarked.length} sans marqueur ` +
        `(${results.length} au total, DÉRIVÉES du dépôt)\n`
    );
    for (const r of mute)
      console.log(
        `  MUETTE      ${r.url}\n              ${r.status}, ${r.bytes} octets, ` +
          `sans « ${r.expected} » — ${r.what}`
      );
    for (const r of unmeasured)
      console.log(`  NON MESURÉE ${r.url}\n              ${r.detail}`);
    for (const r of diverted)
      console.log(
        `  DÉTOURNÉE   ${r.url}
                portail intercalé : ${r.finalUrl}`
      );
    for (const r of unmarked) console.log(`  SANS MARQUEUR ${r.url}`);
    if (
      mute.length + unmeasured.length + unmarked.length + diverted.length ===
      0
    )
      console.log('  toutes les sources répondent avec leur marqueur.');
    console.log(
      `\nVERDICT : ${
        mute.length > 0
          ? 'des sources sont MUETTES'
          : unmeasured.length + diverted.length + unmarked.length > 0
            ? 'je n’ai pas pu tout mesurer'
            : 'toutes les sources sont VIVANTES'
      }`
    );
  }

  // UN SEUL endroit décide du code de sortie, et c'est celui que la garde éprouve.
  process.exitCode = exitCodeFor(results);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
