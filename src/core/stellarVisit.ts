/**
 * LA VISITE GUIDÉE DU VOISINAGE SOLAIRE (GAL-UNIVERSE-005) : ce que la visite sait dire d'une étoile, et
 * RIEN d'autre. Module PUR (ni DOM ni Three.js).
 *
 * Règle de rigueur : aucun nombre n'est écrit dans un texte de visite. Les phrases portent des
 * emplacements (`{ly}`, `{pm}`…) que ce module remplit à partir des fichiers livrés (`neighbours.json`,
 * `exoplanets.json`), et une étape choisit son étoile par une RÈGLE LUE dans les données (« la plus
 * proche », « le plus grand mouvement propre ») ou par son nom, jamais par un rang. Ainsi un texte ne
 * peut pas affirmer ce que les données ne disent pas, et un test confronte chaque étape aux fichiers.
 *
 * Quatre natures d'information, que la visite distingue à l'écran (`StepReading`) :
 *   - MESURÉ : position, mouvement propre, vitesse radiale, type spectral (Gaia DR3 ou HYG) ;
 *   - CATALOGUÉ : les planètes listées par la NASA Exoplanet Archive pour cette étoile (un instantané
 *     daté, avec le statut que l'archive leur donne) ;
 *   - CALCULÉ : la position à une autre année (mouvement rectiligne uniforme, borné à ±10 000 ans) ;
 *   - ILLUSTRATIF : les points sont des symboles ; aucune planète ni texture n'est dessinée.
 * Ce qui n'est pas dans les fichiers (rayon, masse, âge d'une étoile) est dit INCONNU, jamais déduit.
 */
import type { ExoplanetFile, ExoplanetSystem } from './exoplanets';
import {
  distanceFacts,
  systemPrimary,
  totalProperMotionArcsecPerYear,
  type NeighbourRow,
  type NeighbourSystem,
} from './neighbours';
import { starSlug } from './stellarPermalink';

export type VisitLocale = 'en' | 'fr' | 'es' | 'pt-BR';
export const VISIT_LOCALES: readonly VisitLocale[] = [
  'en',
  'fr',
  'es',
  'pt-BR',
];
export type VisitText = Record<VisitLocale, string>;

/** Comment une étape désigne son étoile : une RÈGLE lue dans les données, ou un nom. */
export type StarChoice =
  | { pick: 'nearest' }
  | { pick: 'fastestProperMotion' }
  | { pick: 'brightest' }
  | { pick: 'fastestRadial' }
  | { name: string };

export interface VisitStep {
  /** Absent : l'étape regarde le Soleil et l'échelle (pas d'étoile choisie). */
  star?: StarChoice;
  /** Décalage de temps (années depuis la date de la scène), appliqué par l'étape ; absent = 0. */
  years?: number;
  /** Distance de la caméra à son centre, en parsecs. */
  distancePc: number;
  title: VisitText;
  /** Le texte, avec des emplacements : voir `fillPlaceholders`. */
  body: VisitText;
  /**
   * Ce que le texte de l'étape SUPPOSE des données : un test le confronte aux fichiers livrés, donc une
   * étape ne peut pas affirmer ce que le catalogue ne dit plus après une régénération.
   */
  requires?: {
    /** L'archive liste au moins une planète pour cette étoile. */
    archivePlanets?: true;
    /** Une composante du système a un type spectral qui commence ainsi (« D » : naine blanche). */
    memberSpectralPrefix?: string;
    /** La vitesse radiale est publiée pour l'étoile. */
    radialVelocity?: true;
  };
}

export interface Visit {
  id: string;
  title: VisitText;
  summary: VisitText;
  steps: readonly VisitStep[];
}

/** Les emplacements que le texte d'une étape peut contenir. */
export const PLACEHOLDERS = [
  'name',
  'ly',
  'au',
  'spectral',
  'pm',
  'rv',
  'planets',
  'vmag',
  'approach',
  'members',
  'memberList',
  'nearestName',
  'nearestLy',
  'nearestAu',
  'years',
  'year',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** Le rang du système qui répond au choix, ou -1. Départage : le plus proche d'abord. */
export function pickSystem(
  systems: readonly NeighbourSystem[],
  choice: StarChoice
): number {
  if ('name' in choice) {
    const wanted = starSlug(choice.name);
    return systems.findIndex((s) =>
      s.members.some((m) => starSlug(m[0]) === wanted)
    );
  }
  const radial = (system: NeighbourSystem): number => {
    const values = system.members
      .map((m) => m[10])
      .filter((v): v is number => v !== null)
      .map(Math.abs);
    return values.length ? Math.max(...values) : Number.NEGATIVE_INFINITY;
  };
  const score = (system: NeighbourSystem): number => {
    switch (choice.pick) {
      // Le plus proche de tous ses membres : `Proxima` pour son système, pas son primaire.
      case 'nearest':
        return -Math.min(...system.members.map((m) => m[5]));
      case 'fastestProperMotion':
        return Math.max(...system.members.map(totalProperMotionArcsecPerYear));
      case 'brightest':
        return -Math.min(...system.members.map((m) => m[7]));
      case 'fastestRadial':
        return radial(system);
    }
  };
  let best = -1;
  let top = Number.NEGATIVE_INFINITY;
  systems.forEach((system, i) => {
    const value = score(system);
    if (value > top) {
      top = value;
      best = i;
    }
  });
  return best;
}

export interface ArchiveMatch {
  /** Le nom de l'hôte dans l'archive. */
  host: string;
  planets: string[];
}

/** Séparation angulaire (secondes d'arc) entre une étoile voisine et un hôte de l'archive. */
function separationArcsec(row: NeighbourRow, system: ExoplanetSystem): number {
  const rad = Math.PI / 180;
  const cos =
    Math.sin(row[4] * rad) * Math.sin(system[2] * rad) +
    Math.cos(row[4] * rad) *
      Math.cos(system[2] * rad) *
      Math.cos((row[3] - system[1]) * rad);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI) * 3600;
}

/**
 * Les systèmes de l'archive qui sont CETTE étoile, reconnus par leur DIRECTION seule. Aucun rapprochement par
 * le nom (les noms diffèrent d'un catalogue à l'autre), et aucun par la distance : l'archive donne à GJ 411
 * (Lalande 21185, 2,55 pc) une distance de 5,68 pc, et un critère de distance lui aurait refusé ses deux
 * planètes, ce que la visite aurait affiché comme « aucune ». À cette tolérance, une autre étoile derrière
 * la même direction est improbable (environ 0,004 hôte attendu par cercle de recherche : 4 847 hôtes sur le ciel).
 *
 * La tolérance suit le mouvement propre : l'archive donne la position de chaque hôte à une époque récente
 * (Gaia, ~2016), le catalogue des voisines à J2000. Barnard (10,4″ par an) est à 161″ de sa position d'archive ;
 * une tolérance fixe de 120″ la manquait et la visite disait « aucune planète » : une AFFIRMATION FAUSSE
 * (l'archive en liste quatre). Tolérance : 60″ + mouvement propre × 30 ans.
 */
export function archiveMatches(
  system: NeighbourSystem,
  archive: readonly ExoplanetSystem[]
): ArchiveMatch[] {
  const found = new Map<string, ArchiveMatch>();
  for (const member of system.members) {
    const tolerance =
      60 + totalProperMotionArcsecPerYear(member) * MATCH_EPOCH_SPAN_YEARS;
    for (const host of archive) {
      if (separationArcsec(member, host) > tolerance) continue;
      found.set(host[0], { host: host[0], planets: host[7].map((p) => p[0]) });
    }
  }
  return [...found.values()];
}

/** L'écart d'époque entre le catalogue des voisines (J2000) et les positions de l'archive, majoré. */
const MATCH_EPOCH_SPAN_YEARS = 30;

export function archivePlanetCount(matches: readonly ArchiveMatch[]): number {
  return matches.reduce((n, m) => n + m.planets.length, 0);
}

/** Le nombre dans un texte de la langue : la mise en forme est celle de l'interface, passée par l'appelant. */
export interface Formatter {
  number(value: number, significantDigits: number): string;
  fixed(value: number, digits: number): string;
}

/** Ce que les données disent d'une étoile, prêt à remplir un texte. */
export function placeholderValues(
  systems: readonly NeighbourSystem[],
  index: number | null,
  years: number,
  format: Formatter,
  planets: number | null,
  absoluteYear: number,
  approachWords: { approaching: string; receding: string }
): Record<Placeholder, string> {
  const nearest = pickSystem(systems, { pick: 'nearest' });
  const nearestRow =
    nearest >= 0
      ? [...systems[nearest]!.members].sort((a, b) => a[5] - b[5])[0]!
      : null;
  const nearestFacts = nearestRow ? distanceFacts(nearestRow) : null;
  const row =
    index !== null && index >= 0 ? systemPrimary(systems[index]!) : null;
  const facts = row ? distanceFacts(row) : null;
  return {
    name: row ? row[0] : '',
    ly: facts ? format.fixed(facts.lightYears, 2) : '',
    au: facts ? format.number(facts.au, 3) : '',
    spectral: row?.[2] ?? '',
    pm: row ? format.number(Math.hypot(row[8], row[9]), 4) : '',
    rv: row && row[10] !== null ? format.fixed(Math.abs(row[10]), 1) : '',
    vmag: row ? format.fixed(row[7], 2) : '',
    approach:
      row && row[10] !== null && row[10] !== 0
        ? row[10] < 0
          ? approachWords.approaching
          : approachWords.receding
        : '',
    members:
      index !== null && index >= 0
        ? String(systems[index]!.members.length)
        : '',
    memberList:
      index !== null && index >= 0
        ? systems[index]!.members.map((m) =>
            m[2] ? `${m[0]} (${m[2]})` : m[0]
          ).join(', ')
        : '',
    planets: planets === null ? '' : String(planets),
    nearestName: nearestRow ? nearestRow[0] : '',
    nearestLy: nearestFacts ? format.fixed(nearestFacts.lightYears, 2) : '',
    nearestAu: nearestFacts ? format.number(nearestFacts.au, 3) : '',
    years: format.number(Math.abs(years), 4),
    year: format.number(absoluteYear, 4),
  };
}

/** Remplit `{nom}` ; un emplacement inconnu reste tel quel (un test le refuse), jamais « undefined ». */
export function fillPlaceholders(
  text: string,
  values: Readonly<Record<string, string>>
): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? values[key]! : whole
  );
}

/** Les emplacements qu'un texte emploie. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
}

/** Le nombre de planètes de l'archive pour ce système, ou `null` quand l'archive n'est pas lue. */
export function archiveCount(
  system: NeighbourSystem,
  file: ExoplanetFile | null
): number | null {
  return file ? archivePlanetCount(archiveMatches(system, file.systems)) : null;
}

const isText = (value: unknown): value is VisitText =>
  typeof value === 'object' &&
  value !== null &&
  VISIT_LOCALES.every((l) => {
    const text = (value as Record<string, unknown>)[l];
    return typeof text === 'string' && text.trim().length > 0;
  });

/**
 * Lit une fiche de visite et REFUSE ce qui n'a pas la forme attendue (un texte sans ses quatre langues,
 * une étape sans distance, un choix d'étoile inconnu) : une fiche mal formée est une erreur au
 * chargement, pas une visite à moitié affichée.
 */
export function parseVisit(raw: unknown): Visit {
  const r = raw as Record<string, unknown>;
  const fail = (what: string): never => {
    throw new Error(`visite du voisinage : ${what}`);
  };
  if (typeof r?.['id'] !== 'string' || !/^[a-z0-9-]+$/.test(r['id']))
    fail('identifiant absent ou mal formé');
  if (!isText(r['title']) || !isText(r['summary']))
    fail('titre ou résumé sans les quatre langues');
  if (!Array.isArray(r['steps']) || r['steps'].length === 0)
    fail('aucune étape');
  const picks = [
    'nearest',
    'fastestProperMotion',
    'brightest',
    'fastestRadial',
  ];
  const steps = (r['steps'] as Record<string, unknown>[]).map((s, i) => {
    if (!isText(s['title']) || !isText(s['body']))
      fail(`étape ${i} : titre ou texte sans les quatre langues`);
    if (!(typeof s['distancePc'] === 'number' && s['distancePc'] > 0))
      fail(`étape ${i} : distance de caméra absente`);
    const star = s['star'] as Record<string, unknown> | undefined;
    if (
      star !== undefined &&
      !(
        typeof star['name'] === 'string' ||
        (typeof star['pick'] === 'string' && picks.includes(star['pick']))
      )
    )
      fail(`étape ${i} : choix d'étoile inconnu`);
    return s as unknown as VisitStep;
  });
  return {
    id: r['id'] as string,
    title: r['title'] as VisitText,
    summary: r['summary'] as VisitText,
    steps,
  };
}
