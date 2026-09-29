#!/usr/bin/env node
/* global console, process, fetch, URL */
/**
 * NE GARDER QUE LES N DERNIERES VERSIONS DE CHAQUE SITE, AUTOMATIQUEMENT.
 *
 * POURQUOI CE SCRIPT EXISTE, et ce n'est pas le quota. Firebase Hosting n'a AUCUNE retention
 * automatique : chaque deploiement empile une version de plus, pour toujours. Le quota de
 * stockage du projet finit donc par sauter, et la seule issue etait une purge A LA MAIN dans la
 * console — une trentaine de minutes tous les quatre jours, sur une centaine de versions.
 * C'est cette corvee que ce script supprime, pas l'incident du jour.
 *
 * ET LE QUOTA EST CELUI DU PROJET, PAS D'UN SITE. Le projet heberge PLUSIEURS sites qui se
 * partagent les memes 10 Go — sept au 2026-09-29, dont un seul est Galaxy. Elaguer le seul
 * site de Galaxy ne garantirait donc rien : la liste des sites se LIT au projet a chaque
 * execution, et tous sont elagues. Un site ajoute demain l'est sans que personne y pense.
 *
 * TROIS SECURITES, parce que ce script SUPPRIME chez un hebergeur de production.
 *
 *   1. Il ne touche JAMAIS la version actuellement servie. Elle est identifiee par la release
 *      en cours du canal `live`, lue a la source, et jamais deduite d'un ordre de tri.
 *   2. Il REFUSE d'agir sur une reponse qu'il ne reconnait pas. Une API qui change de forme fait
 *      echouer le script ; elle ne le fait pas supprimer au hasard. C'est la difference entre
 *      « je n'ai pas compris » et « il n'y avait rien a garder ».
 *   3. Il est en SIMULATION par defaut. Rien n'est supprime sans `--apply`, ce qui rend un
 *      lancement d'essai sans consequence.
 *
 * `--keep N` (defaut 5), `--site <id>` pour n'en faire qu'un, `--apply` pour supprimer vraiment.
 * Le jeton vient de `FIREBASE_TOKEN` ou de `--token`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Versions conservees par site, EN PLUS de celle qui est servie. */
export const KEEP_PER_SITE = 5;

const API = 'https://firebasehosting.googleapis.com/v1beta1';

/**
 * L'identifiant du projet se LIT dans `.firebaserc`, il ne se recopie pas ici : c'est le meme
 * fichier qui fait autorite pour le deploiement, donc les deux ne peuvent pas diverger.
 */
function defaultProject() {
  const rc = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '.firebaserc'),
      'utf8'
    )
  );
  const id = rc?.projects?.default;
  if (!id) throw new Error('.firebaserc ne declare pas de projet par defaut');
  return id;
}

/**
 * Les versions a SUPPRIMER, dans l'ordre de la plus ancienne a la plus recente.
 *
 * Pure, et c'est la seule partie qui decide quoi que ce soit — donc la seule qu'on puisse
 * confronter a des cas sans reseau. Les regles, dans l'ordre ou elles s'appliquent :
 *
 *   - une version SERVIE ne se supprime pas, quel que soit son age ;
 *   - une version qui n'est pas `FINALIZED` ne se supprime pas non plus : `CREATED` est un
 *     deploiement EN COURS, et le supprimer casserait une mise en ligne en vol ;
 *   - parmi le reste, on garde les `keep` plus recentes et on rend les autres.
 *
 * Le tri se fait sur `createTime`, qui est la seule date que l'API garantit ; l'ordre de
 * pagination, lui, n'est pas un contrat.
 */
export function versionsToDelete(
  versions,
  liveVersionName,
  keep = KEEP_PER_SITE
) {
  if (!Array.isArray(versions))
    throw new TypeError('versions: tableau attendu');
  if (!Number.isInteger(keep) || keep < 1)
    throw new RangeError(`keep doit etre un entier positif, recu ${keep}`);
  const candidates = versions
    .filter((v) => v && typeof v.name === 'string')
    .filter((v) => v.name !== liveVersionName)
    .filter((v) => v.status === 'FINALIZED')
    .sort((a, b) =>
      String(b.createTime ?? '').localeCompare(String(a.createTime ?? ''))
    );
  return candidates.slice(keep).reverse();
}

/** Un appel a l'API, qui REFUSE une reponse inattendue plutot que de deviner. */
async function api(path, token, init = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${path} : HTTP ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} : reponse illisible (${text.slice(0, 120)})`);
  }
}

/** Toutes les versions d'un site, paginees jusqu'au bout. */
async function allVersions(site, token) {
  const out = [];
  let pageToken = '';
  do {
    const q = `pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const page = await api(`sites/${site}/versions?${q}`, token);
    if (page.versions !== undefined && !Array.isArray(page.versions))
      throw new Error(`sites/${site}/versions : champ \`versions\` inattendu`);
    out.push(...(page.versions ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Le nom de la version SERVIE, lu a la source et jamais deduit. */
async function liveVersion(site, token) {
  const releases = await api(`sites/${site}/releases?pageSize=1`, token);
  const first = (releases.releases ?? [])[0];
  return first?.version?.name ?? null;
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

export async function main() {
  const token = flag('--token', process.env.FIREBASE_TOKEN);
  if (!token) {
    console.error(
      'aucun jeton : passer --token, ou definir FIREBASE_TOKEN.\n' +
        "Je n'invente pas de credential, et sans mesure je ne supprime rien."
    );
    process.exit(2);
  }
  const project = flag('--project', defaultProject());
  const keep = Number.parseInt(flag('--keep', String(KEEP_PER_SITE)), 10);
  const apply = args.includes('--apply');
  const only = flag('--site', null);

  // La liste des sites se LIT au projet : un site ajoute demain est elague sans que personne
  // y pense, et aucune liste n'est tenue a la main ici.
  const sites = (await api(`projects/${project}/sites?pageSize=100`, token))
    .sites;
  if (!Array.isArray(sites) || sites.length === 0)
    throw new Error(`projet ${project} : aucun site lu, on s'arrete`);

  let freed = 0;
  let removed = 0;
  for (const site of sites) {
    const id = site.name.split('/').pop();
    if (only && id !== only) continue;
    const versions = await allVersions(id, token);
    const live = await liveVersion(id, token);
    const doomed = versionsToDelete(versions, live, keep);
    const bytes = doomed.reduce(
      (sum, v) => sum + Number(v.versionBytes ?? 0),
      0
    );
    freed += bytes;
    console.log(
      `${id.padEnd(22)} ${String(versions.length).padStart(4)} versions, ` +
        `${String(doomed.length).padStart(4)} a supprimer, ` +
        `${(bytes / 1024 / 1024).toFixed(1).padStart(8)} Mo`
    );
    if (!apply) continue;
    for (const v of doomed) {
      await api(v.name, token, { method: 'DELETE' });
      removed += 1;
    }
  }

  console.log(
    `\n${apply ? `${removed} versions SUPPRIMEES` : 'SIMULATION, rien supprime'} — ` +
      `${(freed / 1024 / 1024).toFixed(1)} Mo ${apply ? 'liberes' : 'liberables'}, ` +
      `${keep} versions gardees par site en plus de celle qui est servie.`
  );
  if (!apply) console.log('Relancer avec --apply pour supprimer.');
}

// Fermeture de l'execution : sans cela, l'importer depuis la garde lancerait des appels reseau
// a chaque `pnpm verify`. Meme protection que `scripts/check-source-health.mjs`.
if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
