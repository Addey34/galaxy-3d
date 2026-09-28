/**
 * LA DATE DE LECTURE APPARTIENT À LA RÉPONSE, PAS À L'EXÉCUTION (ligne 23.1 de la file).
 *
 * `factSources.snapshot.json` portait un seul `retrieved`, écrit avec `new Date()` à la fin du
 * relevé. Un cache chaud héritait donc de la date du JOUR : le relevé livré au lot 23 annonçait
 * le 2026-09-28 pour les HUIT réponses d'articles lues le 2026-09-20 (mesuré, pas supposé : six
 * résumés arXiv, la page Nature et le PDF d'Haumea, soit neuf fichiers de cache datés du 20, le
 * PDF en occupant deux). Et ce défaut est PUBLIÉ : la fiche d'un corps écrit « en septembre 2026 »
 * (`fact.asOf`) derrière son nombre de lunes, et vingt fiches portaient cette date d'exécution.
 *
 * La correction n'est pas de vider le cache — c'est ce qui a été tenté le 2026-09-28, et cela
 * rend le relevé dépendant de la disponibilité de chaque source, `.cache/` étant ignoré par git :
 * quatre fiches du NSSDCA sont devenues illisibles dans la foulée et l'ancien contenu n'existait
 * plus nulle part. La correction est d'HORODATER la réponse quand elle arrive, et de ne plus
 * jamais demander l'heure ensuite.
 *
 * Une entrée déjà en cache n'a pas d'horodatage à côté d'elle : sa date est alors LUE dans la
 * date de modification de son fichier, c'est-à-dire l'instant où la réponse a été écrite, puis
 * FIXÉE dans un fichier `.at` pour que cette lecture ne se refasse jamais. C'est un relevé, pas
 * une supposition, et il ne coûte aucune requête.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const CACHE_DIR = '.cache/fact-sources';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Le jour d'un instant, en UTC. Une date de lecture est un JOUR, jamais une heure. */
export const day = (at) => new Date(at).toISOString().slice(0, 10);

/** Clé de cache d'une URL : la même qu'avant ce lot, pour ne rien réinvalider. */
export const cacheKey = (url) =>
  createHash('sha1').update(url).digest('hex').slice(0, 16);

/**
 * L'horodatage voisin d'une réponse. L'extension est retirée : le PDF d'un article et le texte
 * qu'on en extrait sont UNE réponse, donc une seule date.
 */
const stampPath = (path) => `${path.replace(/\.[^./]+$/, '')}.at`;

/**
 * La date de lecture d'une réponse en cache : l'horodatage à côté d'elle, ou, pour une entrée
 * héritée, la date d'écriture de son fichier, fixée à côté d'elle au passage.
 *
 * Un horodatage illisible fait ÉCHOUER : il vaut mieux refuser de dater que dater faux, et c'est
 * exactement la faute que ce module corrige.
 */
export function stampOf(path) {
  const at = stampPath(path);
  if (existsSync(at)) {
    const stamped = readFileSync(at, 'utf8').trim();
    if (!DAY.test(stamped))
      throw new Error(`date de lecture illisible : ${at} (« ${stamped} »)`);
    return stamped;
  }
  const inherited = day(statSync(path).mtime);
  writeFileSync(at, `${inherited}\n`);
  return inherited;
}

/** Écrit une réponse ET sa date de lecture, qui est celle de l'instant où elle arrive. */
export function stampNow(path, at = new Date()) {
  const stamped = day(at);
  writeFileSync(stampPath(path), `${stamped}\n`);
  return stamped;
}

/**
 * Les dates de lecture d'une section, DÉRIVÉES de ses réponses : toutes les valeurs `retrieved`
 * qu'elle porte, distinctes et triées. Rien n'est stocké en double, donc rien ne peut dériver.
 */
export function sectionDates(section) {
  const found = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'retrieved' && typeof value === 'string') found.add(value);
      else walk(value);
    }
  };
  walk(section);
  return [...found].sort();
}

/**
 * Toute réponse relevée porte sa date : un objet qui cite une `url` sans dire QUAND elle a été
 * lue est le défaut d'origine, en plus petit. La garde vit dans le relevé lui-même, pas
 * seulement dans un test, parce qu'un relevé écrit à moitié daté ne doit pas s'écrire du tout.
 */
export function assertEveryUrlDated(snapshot) {
  const orphans = [];
  const walk = (node, path) => {
    if (Array.isArray(node))
      return node.forEach((item, k) => walk(item, `${path}[${k}]`));
    if (!node || typeof node !== 'object') return;
    // Une entrée REPRISE d'un relevé précédent est le seul cas où la date manque, et elle le
    // DÉCLARE (`carriedOver`). Sans cette déclaration, une date absente reste une faute.
    if (
      typeof node.url === 'string' &&
      typeof node.retrieved !== 'string' &&
      !(node.retrieved === null && node.carriedOver === true)
    )
      orphans.push(path || '(racine)');
    for (const [key, value] of Object.entries(node))
      if (key !== 'url') walk(value, path ? `${path}.${key}` : key);
  };
  walk(snapshot, '');
  if (orphans.length)
    throw new Error(
      `réponses citées sans date de lecture : ${orphans.join(', ')}`
    );
  return snapshot;
}
