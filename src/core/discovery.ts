/**
 * CE QU'ON SAVAIT D'UN CORPS À UNE DATE (lot 44, ligne 22.10). Module PUR (affirmations + date →
 * état), sans DOM ni réseau, comme `core/missions.ts`.
 *
 * UN CORPS NE PORTE PAS UNE DATE DE DÉCOUVERTE, IL PORTE DES AFFIRMATIONS, chacune datée par sa
 * source. C'est ce que la mesure du 2026-10-01 a imposé, sur trois cas réels :
 *   - une source qui ne donne que l'ANNÉE (la table des satellites du JPL) ;
 *   - une source qui donne DEUX années pour un même satellite (Janus « 1966, 1980 ») ;
 *   - deux sources qui divergent sur un même corps (Pluton : 1930-01-23 selon SBDB, 1930-02-18
 *     selon le NSSDCA).
 * Une seule règle les couvre tous : avant la PREMIÈRE date publiée, le corps n'était pas encore
 * connu ; après la DERNIÈRE, il l'était ; entre les deux, la réponse dépend de la source, et
 * l'application le dit au lieu de trancher. Une année seule vaut l'année entière : l'application
 * ne sait pas quel jour de 1655 Huygens a vu Titan, donc elle ne le prétend pas.
 *
 * CE QUE CE MODULE NE DIT PAS : ce que l'on CROYAIT à une date. La table du JPL ne recense que les
 * satellites reconnus aujourd'hui, si bien qu'une lune annoncée puis réfutée n'y figure pas. Le
 * compte est donc « ce que l'on avait déjà vu de ce qui est reconnu aujourd'hui », et la fiche
 * l'écrit sous le compte.
 */

/** Qui publie une affirmation. Les cinq sources sont décrites dans `config/discoveryIndex.json`. */
export type DiscoverySource =
  'jpl-sats' | 'sbdb' | 'nssdca' | 'jpl-planets' | 'nasa-science';

/** Une affirmation de découverte, telle que sa source la déclare. */
export type DiscoveryClaim = {
  readonly source: DiscoverySource;
  readonly url: string;
  /** Le jour où la RÉPONSE a été lue (lot 25), jamais une date déclarée par la page. */
  readonly retrieved: string;
} & (
  | {
      /** Un jour publié (SBDB, NSSDCA). */
      readonly form: 'day';
      readonly day: string;
      readonly who?: string | null;
      readonly where?: string | null;
      /**
       * `predictedReturn` : la source dit « découverte », une autre source citée MOT POUR MOT dit
       * que c'est le retour prédit d'un objet observé bien avant (Halley, 1758).
       */
      readonly role?: 'predictedReturn';
      readonly roleUrl?: string;
      readonly roleRetrieved?: string;
    }
  | {
      /** Une ou plusieurs années (table des satellites du JPL). */
      readonly form: 'years';
      readonly years: readonly number[];
      readonly who?: string | null;
      readonly ref?: string | null;
    }
  | {
      /** « Prehistoric » (fiches du NSSDCA). */
      readonly form: 'prehistoric';
    }
  | {
      /** « known to mankind since ancient times » (JPL, pour la Lune). */
      readonly form: 'ancient';
    }
  | {
      /** « connected to ancient observations going back more than 2,000 years » (Halley). */
      readonly form: 'ancientObservations';
    }
);

/** L'état d'un corps à la date de la scène. */
export type DiscoveryStanding =
  /** Connu de toute date que l'application sait afficher : une source le déclare. */
  | 'knownSinceAntiquity'
  /** La scène est avant la première date publiée. */
  | 'notYetKnown'
  /** La scène tombe entre la première et la dernière date publiée : la réponse dépend de la source. */
  | 'withinPublishedDates'
  /** La scène est après la dernière date publiée. */
  | 'known';

export const DISCOVERY_STANDINGS: readonly DiscoveryStanding[] = [
  'knownSinceAntiquity',
  'notYetKnown',
  'withinPublishedDates',
  'known',
];

const ANCIENT_FORMS: ReadonlySet<DiscoveryClaim['form']> = new Set([
  'prehistoric',
  'ancient',
  'ancientObservations',
]);

/** Une année sur quatre chiffres, comme l'écrit un jour ISO. */
const isoYear = (year: number): string => String(year).padStart(4, '0');

/**
 * Les bornes, en jours ISO, de ce qu'une affirmation date. Une année vaut l'année entière. Une
 * affirmation sans date (antiquité) n'a pas de borne.
 */
function spans(claim: DiscoveryClaim): readonly [string, string][] {
  if (claim.form === 'day') return [[claim.day, claim.day]];
  if (claim.form === 'years')
    return claim.years.map((y) => [
      `${isoYear(y)}-01-01`,
      `${isoYear(y)}-12-31`,
    ]);
  return [];
}

/** Le jour UTC d'un instant : une borne de découverte est au mieux un jour. */
const utcDay = (date: Date): string => {
  const year = date.getUTCFullYear();
  // `toISOString` écrit « +010000 » ou « -000001 » hors de 0..9999 ; ces dates sont alors
  // avant ou après toute borne publiée, et le signe suffit à les classer.
  if (year < 0) return '0000-00-00';
  if (year > 9999) return '9999-99-99';
  return date.toISOString().slice(0, 10);
};

/**
 * L'état d'un corps à la date de la scène, à partir de TOUTES ses affirmations.
 *
 * Une seule affirmation « depuis l'Antiquité » suffit à rendre `knownSinceAntiquity` : c'est le
 * cas de Halley, dont la date de SBDB est un retour prédit, et que NASA Science rattache à des
 * observations de plus de 2 000 ans. Sans affirmation datée ni ancienne, `null` : rien à dire.
 */
export function discoveryStanding(
  claims: readonly DiscoveryClaim[],
  sceneDate: Date
): DiscoveryStanding | null {
  if (claims.some((c) => ANCIENT_FORMS.has(c.form)))
    return 'knownSinceAntiquity';
  const all = claims.flatMap(spans);
  if (all.length === 0) return null;
  const first = all.map(([from]) => from).sort()[0];
  const last = all.map(([, to]) => to).sort()[all.length - 1];
  const at = utcDay(sceneDate);
  if (at < first) return 'notYetKnown';
  if (at > last) return 'known';
  return 'withinPublishedDates';
}

/** Un satellite tel que la table du JPL le recense. */
export interface SatelliteDiscovery {
  /** Le nom UAI, ou la désignation provisoire quand il n'en a pas. */
  readonly name: string;
  readonly provisional?: string;
  readonly years: readonly number[];
  readonly who: string | null;
  readonly ref: string | null;
  /** L'identifiant du catalogue quand ce satellite y est. */
  readonly body?: string;
}

/**
 * Combien de satellites on connaissait à une date : une BORNE, jamais un nombre inventé.
 *
 * `atLeast` compte ceux dont TOUTES les années sont révolues ; `atMost` ceux dont AU MOINS une
 * année est commencée. Les deux diffèrent quand la scène tombe dans une année de découverte (on ne
 * sait pas quel jour), ou entre les deux années d'une ligne qui en porte deux (Thémisto, vue en
 * 1975 puis retrouvée en 2000).
 */
export function satellitesKnownAt(
  satellites: readonly SatelliteDiscovery[],
  sceneDate: Date
): { atLeast: number; atMost: number; total: number } {
  const year = sceneDate.getUTCFullYear();
  let atLeast = 0;
  let atMost = 0;
  for (const s of satellites) {
    if (s.years.every((y) => y < year)) atLeast += 1;
    if (s.years.some((y) => y <= year)) atMost += 1;
  }
  return { atLeast, atMost, total: satellites.length };
}

/**
 * La prochaine année de découverte APRÈS la date de la scène, et les satellites qu'elle apporte
 * (par leur première année). `null` quand tout ce que la table recense était déjà vu.
 */
export function nextSatelliteDiscovery(
  satellites: readonly SatelliteDiscovery[],
  sceneDate: Date
): { year: number; satellites: readonly SatelliteDiscovery[] } | null {
  const year = sceneDate.getUTCFullYear();
  const first = (s: SatelliteDiscovery): number => Math.min(...s.years);
  const later = satellites.filter((s) => first(s) > year);
  if (later.length === 0) return null;
  const next = Math.min(...later.map(first));
  return { year: next, satellites: later.filter((s) => first(s) === next) };
}
