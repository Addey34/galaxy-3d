/**
 * Petits corps : éléments osculateurs de milliers d'astéroïdes et de comètes, issus du JPL
 * Small-Body Database. Ils alimentent la couche instrument 2D (`SmallBodyField`) — jamais des
 * meshes : leur taille physique réelle resterait invisible, conformément à l'invariant du mode
 * Exploration.
 *
 * **L'APPLICATION NE CONTACTE PLUS JPL.** Elle l'a fait jusqu'au lot 8b, et cela n'a jamais
 * fonctionné en production : `ssd-api.jpl.nasa.gov` répond HTTP 200 sans en-tête
 * `Access-Control-Allow-Origin` (mesuré quatre fois le 2026-09-20 avec l'`Origin` du site), le
 * navigateur jette donc la réponse et la couche restait vide, en silence, alors qu'elle se
 * remplissait en développement. La CSP n'y était pour rien : elle autorisait l'hôte.
 *
 * Les quatre requêtes sont désormais tirées AU BUILD par
 * `scripts/generate-small-body-dataset.mjs`, qui écrit `public/assets/small-bodies/dataset.json`
 * dans la forme même de l'API. `parseSbdbRows` la lit sans conversion. La donnée est un
 * INSTANTANÉ DATÉ, et le panneau le dit : `loadSmallBodies` renvoie la date avec les corps.
 *
 * Réf. : https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html
 */
import type { OrbitalElements } from './kepler';
import { DEG_TO_RAD as D2R } from './MathConstants';

/** Catégorie de petit corps — pilote le jeu de paramètres de requête SBDB (voir `sbdbQueryUrl`). */
export type SmallBodyCategory = 'main-belt' | 'neo' | 'comet' | 'tno';

/** Un petit corps chargé depuis SBDB : nom lisible + éléments orbitaux. */
export interface ParsedSmallBody {
  name: string;
  elements: OrbitalElements;
  /** Absent pour un appel bas niveau direct (`fetchSmallBodies`) ; posé par `fetchAllSmallBodies`. */
  category?: SmallBodyCategory;
}

/** Convertit une date julienne (JD, TDB≈UTC à cette précision) en Date JavaScript. */
export function julianDateToDate(jd: number): Date {
  // JD 2440587.5 = 1970-01-01T00:00:00Z (epoch Unix).
  return new Date((jd - 2_440_587.5) * 86_400_000);
}

/** Champs SBDB requis pour propager une orbite képlérienne. */
const REQUIRED_FIELDS = ['a', 'e', 'i', 'om', 'w', 'ma', 'epoch'] as const;

/**
 * Convertit la réponse tabulaire SBDB (`fields` + `data`) en corps exploitables.
 * Robuste : ignore silencieusement les lignes aux éléments manquants/non finis ou
 * non elliptiques (a ≤ 0, e ≥ 1 — voir la raison dans la boucle), et renvoie `[]` si un
 * champ requis est absent.
 *
 * Unités SBDB : a en UA ; i, om (Ω), w (ω), ma (M) en degrés ; epoch en JD.
 */
export function parseSbdbRows(
  fields: string[],
  data: string[][]
): ParsedSmallBody[] {
  const idx = (name: string): number => fields.indexOf(name);
  const cols = Object.fromEntries(
    REQUIRED_FIELDS.map((f) => [f, idx(f)])
  ) as Record<(typeof REQUIRED_FIELDS)[number], number>;
  if (Object.values(cols).some((i) => i < 0)) return [];

  const nameCol = idx('full_name') >= 0 ? idx('full_name') : idx('name');
  const out: ParsedSmallBody[] = [];

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const a = Number(row[cols.a]);
    const e = Number(row[cols.e]);
    const i = Number(row[cols.i]);
    const om = Number(row[cols.om]);
    const w = Number(row[cols.w]);
    const ma = Number(row[cols.ma]);
    const epochJd = Number(row[cols.epoch]);

    if (![a, e, i, om, w, ma, epochJd].every(Number.isFinite)) continue;
    // Orbites elliptiques uniquement — et plus faute de solveur : `kepler.ts` résout les
    // hyperboles. C'est la DONNÉE qui ne suffit pas. SBDB arrondit `ma` au centième de degré ;
    // pour une comète quasi parabolique (C/1847 J1 : a = −2926 UA, e = 1,0007, ma = « -0.00 »),
    // le mouvement moyen vaut 6e-6 °/jour, donc cet arrondi laisse la date du périhélie libre
    // de ±800 jours. Les propager placerait ces comètes à des années près, sans erreur visible.
    // Il faudrait `tp` et `q` pour les positionner ; les objets interstellaires, eux, viennent
    // d'éléments Horizons à pleine précision (`registry/interstellar/`).
    if (a <= 0 || e >= 1) continue;

    const rawName = nameCol >= 0 ? row[nameCol] : `sb-${r}`;
    out.push({
      name: (rawName ?? `sb-${r}`).trim(),
      elements: {
        semiMajorAxisAU: a,
        eccentricity: e,
        inclinationRad: i * D2R,
        ascendingNodeRad: om * D2R,
        argPerihelionRad: w * D2R,
        meanAnomalyAtEpochRad: ma * D2R,
        epoch: julianDateToDate(epochJd),
      },
    });
  }
  return out;
}

/**
 * La CONSTRUCTION des quatre requêtes vit maintenant dans
 * `scripts/generate-small-body-dataset.mjs`, avec le reste de ce qui parle à JPL. Elle était
 * ici tant que le navigateur interrogeait l'API ; l'y laisser aurait livré à chaque visiteur
 * du code que plus rien n'appelle, pour une URL que plus rien ne demande.
 */

export const ALL_SMALL_BODY_CATEGORIES: readonly SmallBodyCategory[] = [
  'main-belt',
  'neo',
  'comet',
  'tno',
];

/** Où le build dépose l'instantané ; nom STABLE, donc servi « réseau d'abord » par le SW. */
export const SMALL_BODY_DATASET_URL = '/assets/small-bodies/dataset.json';

/** Forme du fichier commité : celle de l'API, une entrée par catégorie. */
export interface SmallBodyDatasetFile {
  retrieved: string;
  limitPerCategory: number;
  categories: Partial<
    Record<SmallBodyCategory, { fields: string[]; data: string[][] }>
  >;
}

/** Ce que l'application obtient : les corps, et la DATE de leur relevé. */
export interface SmallBodyDataset {
  retrieved: string | null;
  bodies: ParsedSmallBody[];
}

/** Instantané vide : aucune donnée, aucune date à afficher. Jamais une exception. */
const EMPTY_DATASET: SmallBodyDataset = { retrieved: null, bodies: [] };

/** Conversion PURE du fichier en corps tagués de leur catégorie. */
export function parseSmallBodyDataset(
  file: SmallBodyDatasetFile
): SmallBodyDataset {
  const bodies: ParsedSmallBody[] = [];
  for (const category of ALL_SMALL_BODY_CATEGORIES) {
    const table = file.categories?.[category];
    if (!table?.fields || !table.data) continue;
    for (const body of parseSbdbRows(table.fields, table.data))
      bodies.push({ ...body, category });
  }
  return { retrieved: file.retrieved ?? null, bodies };
}

/**
 * Charge l'instantané livré. Dégradation propre, comme l'ancien appel réseau : toute erreur
 * rend un lot vide plutôt qu'une exception, et l'application démarre sans la couche.
 */
export async function loadSmallBodies(
  fetchImpl: typeof fetch = fetch,
  url: string = SMALL_BODY_DATASET_URL
): Promise<SmallBodyDataset> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return EMPTY_DATASET;
    return parseSmallBodyDataset((await res.json()) as SmallBodyDatasetFile);
  } catch {
    return EMPTY_DATASET;
  }
}
