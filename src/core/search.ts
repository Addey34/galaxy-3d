/**
 * LA RECHERCHE UNIVERSELLE TYPÉE (lot 47, 2026-10-12). Module PUR : il prépare l'index livré par
 * `scripts/generate-search-index.mjs` et y cherche, sans DOM ni réseau.
 *
 * Quatre types en plus des corps (que la palette cherche déjà en mémoire) : les formations
 * nommées par l'UAI, les missions du PDS, les instruments d'une sonde et les survols mesurés.
 * Chaque résultat porte ce qu'il faut pour AGIR (le corps, la sonde, la date), pas seulement un
 * libellé : la recherche est une navigation, pas un annuaire.
 */

export type SearchKind = 'place' | 'mission' | 'instrument' | 'flyby';

/** L'ordre d'affichage des types, sous les corps. */
export const SEARCH_KINDS: readonly SearchKind[] = [
  'place',
  'mission',
  'instrument',
  'flyby',
];

/** La forme du fichier livré, écrite par le générateur. */
export interface SearchIndexFile {
  format: 1;
  places: Record<string, string[]>;
  missions: [string, string, string | null, string | null][];
  instruments: [string, string][];
  flybys: [string, string, string][];
}

export type SearchHit =
  | { kind: 'place'; label: string; body: string }
  | {
      kind: 'mission';
      label: string;
      slug: string;
      probe: string | null;
      body: string | null;
    }
  | { kind: 'instrument'; label: string; probe: string }
  | {
      kind: 'flyby';
      label: string;
      probe: string;
      body: string;
      closestAt: string;
    };

interface Prepared {
  hit: SearchHit;
  /** Le libellé plié : c'est sur lui que se mesure la qualité d'une correspondance. */
  label: string;
  /** Tout ce qui peut correspondre : libellé plus contexte (corps, sonde, date), plié. */
  haystack: string;
}

export type PreparedIndex = Record<SearchKind, Prepared[]>;

/**
 * Casse et accents pliés, apostrophes et tirets unifiés : « Ōkina », « ʻOumuamua » ou « Rhéa »
 * se trouvent comme on les tape sur un clavier sans accents.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ʻʼ’'`´]/g, '')
    .replace(/[-‐‑–_/]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Prépare l'index une fois : les noms des corps et des sondes viennent de l'appelant, dans la
 * langue courante, pour que « Lune » et « Moon » trouvent les formations lunaires.
 */
export function prepareSearchIndex(
  file: SearchIndexFile,
  nameOf: (id: string) => string
): PreparedIndex {
  const prepared: PreparedIndex = {
    place: [],
    mission: [],
    instrument: [],
    flyby: [],
  };
  const add = (hit: SearchHit, context: string): void => {
    const label = fold(hit.label);
    prepared[hit.kind].push({
      hit,
      label,
      haystack: context ? `${label} ${fold(context)}` : label,
    });
  };
  for (const [body, names] of Object.entries(file.places)) {
    const bodyName = nameOf(body);
    for (const name of names)
      add({ kind: 'place', label: name, body }, `${bodyName} ${body}`);
  }
  for (const [label, slug, probe, body] of file.missions)
    add(
      { kind: 'mission', label, slug, probe, body },
      [probe && nameOf(probe), body && nameOf(body)].filter(Boolean).join(' ')
    );
  for (const [label, probe] of file.instruments)
    add({ kind: 'instrument', label, probe }, nameOf(probe));
  for (const [probe, body, closestAt] of file.flybys) {
    const label = `${nameOf(probe)} · ${nameOf(body)} · ${closestAt.slice(0, 10)}`;
    add({ kind: 'flyby', label, probe, body, closestAt }, `${probe} ${body}`);
  }
  return prepared;
}

/**
 * Qualité d'une correspondance, 0 si aucune. Tous les mots de la requête doivent se trouver
 * dans le texte cherché ; le score se lit sur le LIBELLÉ : nom exact, puis début du nom, puis
 * début d'un mot, puis n'importe où, puis seulement dans le contexte.
 */
export function matchScore(
  entry: { label: string; haystack: string },
  words: readonly string[],
  whole: string
): number {
  for (const word of words) if (!entry.haystack.includes(word)) return 0;
  if (entry.label === whole) return 5;
  if (entry.label.startsWith(whole)) return 4;
  if (entry.label.includes(` ${whole}`)) return 3;
  if (entry.label.includes(whole)) return 2;
  return 1;
}

/** Une requête trop courte rendrait des milliers de lieux sans rien apprendre au visiteur. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Les meilleurs résultats de chaque type, au plus `perKind`, dans l'ordre : score, puis libellé
 * le plus court (le nom le plus proche de ce qu'on a tapé), puis ordre alphabétique, pour qu'une
 * même frappe rende toujours la même liste.
 */
export function searchPrepared(
  index: PreparedIndex,
  query: string,
  perKind = 5
): SearchHit[] {
  const whole = fold(query);
  if (whole.length < MIN_QUERY_LENGTH) return [];
  const words = whole.split(' ');
  const hits: SearchHit[] = [];
  for (const kind of SEARCH_KINDS) {
    const scored: { entry: Prepared; score: number }[] = [];
    for (const entry of index[kind]) {
      const score = matchScore(entry, words, whole);
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.entry.label.length - b.entry.label.length ||
        a.entry.label.localeCompare(b.entry.label)
    );
    hits.push(...scored.slice(0, perKind).map(({ entry }) => entry.hit));
  }
  return hits;
}
