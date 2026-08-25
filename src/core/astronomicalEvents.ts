import {
  Body,
  NextGlobalSolarEclipse,
  NextLunarEclipse,
  NextMoonQuarter,
  NextPlanetApsis,
  SearchGlobalSolarEclipse,
  SearchLunarEclipse,
  SearchMoonQuarter,
  SearchPlanetApsis,
  SearchRelativeLongitude,
  Seasons,
  type EclipseKind,
} from 'astronomy-engine';

export type AstronomicalEventKind =
  | 'new-moon'
  | 'first-quarter'
  | 'full-moon'
  | 'third-quarter'
  | 'solar-eclipse'
  | 'lunar-eclipse'
  | 'march-equinox'
  | 'june-solstice'
  | 'september-equinox'
  | 'december-solstice'
  | 'perihelion'
  | 'aphelion'
  | 'opposition'
  | 'conjunction';

export interface AstronomicalEvent {
  kind: AstronomicalEventKind;
  date: Date;
  eclipseKind?: EclipseKind;
  /** Éclipse : fraction obscurcie (0–1) de l'astre au pic. */
  obscuration?: number;
  /** Éclipse solaire : position du pic de totalité (lat/lon), où l'ombre passe. */
  peakLatitude?: number;
  peakLongitude?: number;
  /**
   * Corps concerné (clé catalogue en minuscules, ex. « mars ») — uniquement pour
   * `opposition`/`conjunction`, où le corps varie d'un événement à l'autre (contrairement
   * aux phases lunaires ou éclipses, toujours Terre/Lune).
   */
  body?: string;
}

export interface AstronomicalEventOptions {
  count?: number;
  horizonDays?: number;
}

const DEFAULT_COUNT = 8;
const DEFAULT_HORIZON_DAYS = 730;
const QUARTER_KINDS: AstronomicalEventKind[] = [
  'new-moon',
  'first-quarter',
  'full-moon',
  'third-quarter',
];
const DAY_MS = 86_400_000;

function addMoonQuarters(
  events: AstronomicalEvent[],
  start: Date,
  end: Date
): void {
  let quarter = SearchMoonQuarter(start);
  while (quarter.time.date <= end) {
    if (quarter.time.date > start) {
      events.push({
        kind: QUARTER_KINDS[quarter.quarter] ?? 'new-moon',
        date: new Date(quarter.time.date),
      });
    }
    quarter = NextMoonQuarter(quarter);
  }
}

function addSolarEclipses(
  events: AstronomicalEvent[],
  start: Date,
  end: Date
): void {
  let eclipse = SearchGlobalSolarEclipse(start);
  while (eclipse.peak.date <= end) {
    if (eclipse.peak.date > start) {
      events.push({
        kind: 'solar-eclipse',
        date: new Date(eclipse.peak.date),
        eclipseKind: eclipse.kind,
        obscuration: eclipse.obscuration,
        peakLatitude: eclipse.latitude,
        peakLongitude: eclipse.longitude,
      });
    }
    eclipse = NextGlobalSolarEclipse(eclipse.peak);
  }
}

function addLunarEclipses(
  events: AstronomicalEvent[],
  start: Date,
  end: Date
): void {
  let eclipse = SearchLunarEclipse(start);
  while (eclipse.peak.date <= end) {
    if (eclipse.peak.date > start) {
      events.push({
        kind: 'lunar-eclipse',
        date: new Date(eclipse.peak.date),
        eclipseKind: eclipse.kind,
        obscuration: eclipse.obscuration,
      });
    }
    eclipse = NextLunarEclipse(eclipse.peak);
  }
}

/** Équinoxes et solstices sur la fenêtre (via Seasons, une passe par année civile). */
function addSeasons(events: AstronomicalEvent[], start: Date, end: Date): void {
  for (
    let year = start.getUTCFullYear();
    year <= end.getUTCFullYear();
    year += 1
  ) {
    const s = Seasons(year);
    const points: Array<[AstronomicalEventKind, Date]> = [
      ['march-equinox', s.mar_equinox.date],
      ['june-solstice', s.jun_solstice.date],
      ['september-equinox', s.sep_equinox.date],
      ['december-solstice', s.dec_solstice.date],
    ];
    for (const [kind, date] of points) {
      if (date > start && date <= end) events.push({ kind, date });
    }
  }
}

/** Périhélie / aphélie de la Terre (distance min/max au Soleil). */
function addEarthApsides(
  events: AstronomicalEvent[],
  start: Date,
  end: Date
): void {
  let apsis = SearchPlanetApsis(Body.Earth, start);
  while (apsis.time.date <= end) {
    if (apsis.time.date > start) {
      // kind 0 = périhélie (au plus proche), 1 = aphélie (au plus loin).
      events.push({
        kind: apsis.kind === 0 ? 'perihelion' : 'aphelion',
        date: new Date(apsis.time.date),
      });
    }
    apsis = NextPlanetApsis(Body.Earth, apsis);
  }
}

interface AlignmentSearch {
  /** Clé catalogue en minuscules (config/bodies.ts). */
  name: string;
  body: Body;
  kind: AstronomicalEventKind;
  /** Cf. doc de SearchRelativeLongitude : 0 ou 180 selon le type d'alignement recherché. */
  targetRelLon: number;
}

// Planètes supérieures (Mars→Neptune) : targetRelLon=0 = OPPOSITION — Terre entre Soleil et
// planète, la meilleure fenêtre d'observation (au plus près, visible toute la nuit).
// Planètes inférieures (Mercure, Vénus) : targetRelLon=0 = CONJONCTION INFÉRIEURE — la planète
// passe entre Terre et Soleil (parfois un transit). On laisse de côté la conjonction
// SUPÉRIEURE (targetRelLon=180, planète derrière le Soleil) : rien à observer, elle
// n'apporterait que du bruit à la liste. Pluton (planète naine) n'est pas inclus ici — hors
// scope des « planètes » au sens classique de ce panneau.
const ALIGNMENT_SEARCHES: AlignmentSearch[] = [
  { name: 'mars', body: Body.Mars, kind: 'opposition', targetRelLon: 0 },
  { name: 'jupiter', body: Body.Jupiter, kind: 'opposition', targetRelLon: 0 },
  { name: 'saturn', body: Body.Saturn, kind: 'opposition', targetRelLon: 0 },
  { name: 'uranus', body: Body.Uranus, kind: 'opposition', targetRelLon: 0 },
  { name: 'neptune', body: Body.Neptune, kind: 'opposition', targetRelLon: 0 },
  { name: 'mercury', body: Body.Mercury, kind: 'conjunction', targetRelLon: 0 },
  { name: 'venus', body: Body.Venus, kind: 'conjunction', targetRelLon: 0 },
];
// Garde-fou par corps : borne le nombre d'itérations de la boucle "recherche puis avance
// d'un jour" si jamais une recherche stagnait — largement au-dessus du nécessaire (même
// Mercure, la période synodique la plus courte à ~116 j, tient en ~6 occurrences par horizon
// de 2 ans).
const MAX_ALIGNMENTS_PER_SEARCH = 50;

/**
 * Oppositions et conjonctions inférieures des planètes. `SearchRelativeLongitude` ne fournit
 * pas de variante « Next » enchaînable comme les autres recherches de ce fichier (une seule
 * occurrence par appel) : on ré-interroge depuis (résultat + 1 jour) jusqu'à dépasser `end`.
 */
function addPlanetaryAlignments(
  events: AstronomicalEvent[],
  start: Date,
  end: Date
): void {
  for (const { name, body, kind, targetRelLon } of ALIGNMENT_SEARCHES) {
    let cursor: Date = start;
    for (let i = 0; i < MAX_ALIGNMENTS_PER_SEARCH; i++) {
      const time = SearchRelativeLongitude(body, targetRelLon, cursor);
      if (time.date > end) break;
      if (time.date > start) {
        events.push({ kind, date: new Date(time.date), body: name });
      }
      cursor = new Date(time.date.getTime() + DAY_MS);
    }
  }
}

/** Retourne les prochains événements célestes dans une fenêtre déterministe. */
export function findUpcomingAstronomicalEvents(
  startDate: Date,
  options: AstronomicalEventOptions = {}
): AstronomicalEvent[] {
  const count = Math.max(1, Math.floor(options.count ?? DEFAULT_COUNT));
  const horizonDays = Math.max(1, options.horizonDays ?? DEFAULT_HORIZON_DAYS);
  const start = new Date(startDate.getTime());
  const end = new Date(start.getTime() + horizonDays * DAY_MS);
  const events: AstronomicalEvent[] = [];

  addMoonQuarters(events, start, end);
  addSolarEclipses(events, start, end);
  addLunarEclipses(events, start, end);
  addSeasons(events, start, end);
  addEarthApsides(events, start, end);
  addPlanetaryAlignments(events, start, end);

  return events
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, count);
}
