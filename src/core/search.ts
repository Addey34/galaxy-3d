/**
 * LA RECHERCHE UNIVERSELLE TYPÉE (lot 47, 2026-10-12). Module PUR : il prépare l'index livré par
 * `scripts/generate-search-index.mjs` et y cherche, sans DOM ni réseau.
 *
 * Six types en plus des corps (que la palette cherche déjà en mémoire) : les couches de données
 * de l'application (qu'un résultat ACTIVE), les formations nommées par l'UAI, les missions du
 * PDS, les instruments d'une sonde, les survols, les mises en orbite, les périhélies et les contacts mesurés
 * (lot 49) et les découvertes (on cherche « Herschel »
 * et on trouve les lunes qu'il a vues).
 * Chaque résultat porte ce qu'il faut pour AGIR (le corps, la sonde, la date), pas seulement un
 * libellé : la recherche est une navigation, pas un annuaire.
 */

export type SearchKind =
  | 'dataset'
  | 'place'
  | 'mission'
  | 'instrument'
  | 'flyby'
  | 'orbitInsertion'
  | 'perihelion'
  | 'perijove'
  | 'contact'
  | 'discovery';

/** L'ordre d'affichage des types, sous les corps. */
const SEARCH_KINDS: readonly SearchKind[] = [
  'dataset',
  'place',
  'mission',
  'instrument',
  'flyby',
  'orbitInsertion',
  'perihelion',
  'perijove',
  'contact',
  'discovery',
];

/** La forme du fichier livré, écrite par le générateur. */
export interface SearchIndexFile {
  format: 1;
  places: Record<string, string[]>;
  missions: [string, string, string | null, string | null][];
  instruments: [string, string][];
  flybys: [string, string, string][];
  /** [sonde, corps, premier instant lié] (lot 49). */
  orbitInsertions?: [string, string, string][];
  /** [sonde, Soleil, instant du périhélie] (lot 69), même forme que les mises en orbite. */
  perihelia?: [string, string, string][];
  /** [sonde, planète, instant du périjove] (Juno), même forme que les périhélies. */
  perijoves?: [string, string, string][];
  /** [sonde, corps, instant du contact] (lot 49, pas 3). */
  contacts?: [string, string, string][];
  /** [nom ou null (alors celui du corps), corps à montrer, jour ou année, découvreurs ou null] */
  discoveries?: [string | null, string, string, string | null][];
}

export type SearchHit =
  | { kind: 'dataset'; label: string; id: string; body: string }
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
    }
  | {
      kind: 'orbitInsertion';
      label: string;
      probe: string;
      body: string;
      at: string;
    }
  | {
      kind: 'perihelion';
      label: string;
      probe: string;
      body: string;
      at: string;
    }
  | {
      kind: 'perijove';
      label: string;
      probe: string;
      body: string;
      at: string;
    }
  | {
      kind: 'contact';
      label: string;
      probe: string;
      body: string;
      at: string;
    }
  | {
      kind: 'discovery';
      label: string;
      body: string;
      when: string;
      who: string | null;
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
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ʻʼ’'`´]/g, '')
    .replace(/[-‐‑–_/]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Une couche de données de l'application : son identifiant, son libellé traduit, son corps. */
export interface SearchDataset {
  id: string;
  label: string;
  body: string;
}

/**
 * Prépare l'index une fois : les noms des corps et des sondes viennent de l'appelant, dans la
 * langue courante, pour que « Lune » et « Moon » trouvent les formations lunaires. Les couches
 * de données ne sont pas dans le fichier : elles sont dans l'application, qui les donne.
 */
export function prepareSearchIndex(
  file: SearchIndexFile,
  nameOf: (id: string) => string,
  datasets: readonly SearchDataset[] = []
): PreparedIndex {
  const prepared: PreparedIndex = {
    dataset: [],
    place: [],
    mission: [],
    instrument: [],
    flyby: [],
    orbitInsertion: [],
    perihelion: [],
    perijove: [],
    contact: [],
    discovery: [],
  };
  const add = (hit: SearchHit, context: string): void => {
    const label = fold(hit.label);
    prepared[hit.kind].push({
      hit,
      label,
      haystack: context ? `${label} ${fold(context)}` : label,
    });
  };
  for (const { id, label, body } of datasets)
    add({ kind: 'dataset', label, id, body }, nameOf(body));
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
  for (const [probe, body, at] of file.orbitInsertions ?? []) {
    const label = `${nameOf(probe)} · ${nameOf(body)} · ${at.slice(0, 10)}`;
    add({ kind: 'orbitInsertion', label, probe, body, at }, `${probe} ${body}`);
  }
  for (const [probe, body, at] of file.perihelia ?? []) {
    const label = `${nameOf(probe)} · ${nameOf(body)} · ${at.slice(0, 10)}`;
    // Le mot du type, dans les quatre langues : on cherche « périhélie » sans connaître le nom
    // d'une sonde. Les accents sont repliés par `fold`, donc « perihelie » trouve « périhélie ».
    add(
      { kind: 'perihelion', label, probe, body, at },
      `${probe} ${body} perihelion perihelie perihelio perielio`
    );
  }
  for (const [probe, body, at] of file.perijoves ?? []) {
    const label = `${nameOf(probe)} · ${nameOf(body)} · ${at.slice(0, 10)}`;
    add(
      { kind: 'perijove', label, probe, body, at },
      `${probe} ${body} perijove perijoves perijovo`
    );
  }
  for (const [probe, body, at] of file.contacts ?? []) {
    const label = `${nameOf(probe)} · ${nameOf(body)} · ${at.slice(0, 10)}`;
    add({ kind: 'contact', label, probe, body, at }, `${probe} ${body}`);
  }
  for (const [name, body, when, who] of file.discoveries ?? []) {
    const label = name ?? nameOf(body);
    add(
      { kind: 'discovery', label, body, when, who },
      [who, when, nameOf(body)].filter(Boolean).join(' ')
    );
  }
  return prepared;
}

/**
 * Qualité d'une correspondance, 0 si aucune. Tous les mots de la requête doivent se trouver
 * dans le texte cherché ; le score se lit sur le LIBELLÉ : nom exact, puis début du nom, puis
 * début d'un mot, puis n'importe où, puis seulement dans le contexte.
 */
function matchScore(
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
const MIN_QUERY_LENGTH = 2;

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
