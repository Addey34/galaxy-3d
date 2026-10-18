/**
 * CE QU'UNE ACTIVITÉ PEUT MESURER DANS LA SCÈNE (lot 58). Module PUR, sans DOM.
 *
 * Une réponse de corrigé ne se tape pas : elle cite un fait sourcé de la fiche d'un corps, ou une
 * valeur que CE module calcule. Et il la calcule par le même chemin que l'application : les dates
 * des équinoxes, des solstices et des apsides sont celles du panneau des événements et de l'étape
 * `jumpToEvent` (`findUpcomingAstronomicalEvents`), les positions sont celles d'astronomy-engine,
 * dans la convention de temps que la scène installe (`core/timeScale.ts`). Ce qu'un élève lit dans
 * la scène est donc ce que le corrigé affirme.
 *
 * Le vocabulaire est FERMÉ, comme celui des visites : une fiche d'activité choisit une mesure par
 * son nom, elle n'écrit pas de calcul.
 */
import './timeScale';
import {
  Body,
  Equator,
  HelioDistance,
  Observer,
  SearchRiseSet,
} from 'astronomy-engine';
import {
  findUpcomingAstronomicalEvents,
  type AstronomicalEventKind,
} from './astronomicalEvents';

/** Les quatre tournants de l'année, ceux que la visite des saisons visite. */
export const SEASON_EVENTS = [
  'march-equinox',
  'june-solstice',
  'september-equinox',
  'december-solstice',
] as const satisfies readonly AstronomicalEventKind[];
export type SeasonEvent = (typeof SEASON_EVENTS)[number];

export const APSIS_EVENTS = [
  'perihelion',
  'aphelion',
] as const satisfies readonly AstronomicalEventKind[];
export type ApsisEvent = (typeof APSIS_EVENTS)[number];

const DAY_MS = 86_400_000;

/**
 * La première occurrence de `kind` dans l'année civile `year` (UTC), telle que l'application la
 * trouve. Lève si l'année n'en contient pas : chacune de ces formes revient une fois par an, et
 * une absence serait un défaut de la recherche, pas une réponse.
 */
export function eventInYear(kind: AstronomicalEventKind, year: number): Date {
  const start = new Date(Date.UTC(year, 0, 1));
  const found = findUpcomingAstronomicalEvents(start, {
    count: 400,
    horizonDays: 366,
  }).find(
    (event) => event.kind === kind && event.date.getUTCFullYear() === year
  );
  if (!found) throw new Error(`aucun « ${kind} » en ${year}`);
  return found.date;
}

/**
 * La latitude où le Soleil est au zénith à cet instant, en degrés : sa déclinaison VRAIE de la
 * date, vue du centre de la Terre. Au solstice de juin, c'est le tropique du Cancer.
 */
export function subsolarLatitudeDeg(date: Date): number {
  return Equator(Body.Sun, date, new Observer(0, 0, 0), true, true).dec;
}

/**
 * La latitude au-delà de laquelle le Soleil ne se couche pas de la journée, en degrés : le
 * complément de la latitude subsolaire. Géométrique, sans réfraction : c'est le cercle polaire
 * tel qu'on l'enseigne, pas le premier lieu où l'on voit le Soleil à minuit.
 */
export function polarDayLatitudeDeg(date: Date): number {
  return 90 - Math.abs(subsolarLatitudeDeg(date));
}

/**
 * De combien, en pour cent, la Terre est plus près du Soleil à son périhélie de `year` qu'à
 * l'aphélie qui le suit.
 */
export function apsisGapPercent(year: number): number {
  const perihelion = eventInYear('perihelion', year);
  const aphelion = eventInYear('aphelion', year);
  const near = HelioDistance(Body.Earth, perihelion);
  const far = HelioDistance(Body.Earth, aphelion);
  return ((far - near) / far) * 100;
}

/**
 * De combien, en pour cent, le flux solaire reçu par la Terre est plus fort à son périhélie de
 * `year` qu'à l'aphélie qui le suit : il varie comme l'inverse du carré de la distance.
 */
export function apsisFluxGainPercent(year: number): number {
  const near = HelioDistance(Body.Earth, eventInYear('perihelion', year));
  const far = HelioDistance(Body.Earth, eventInYear('aphelion', year));
  return ((far / near) ** 2 - 1) * 100;
}

/**
 * La durée du jour, en heures, au lieu donné et le jour civil LOCAL qui contient `date` : du
 * lever au coucher du bord supérieur du Soleil, réfraction comprise (`SearchRiseSet`). Le jour
 * local commence à minuit solaire moyen, `longitude / 15` heures avant minuit UTC.
 */
export function dayLengthHours(
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number
): number {
  const observer = new Observer(latitudeDeg, longitudeDeg, 0);
  const offsetMs = (longitudeDeg / 15) * 3_600_000;
  const localMidnight = new Date(
    Math.floor((date.getTime() + offsetMs) / DAY_MS) * DAY_MS - offsetMs
  );
  const rise = SearchRiseSet(Body.Sun, observer, +1, localMidnight, 1);
  if (!rise) throw new Error('aucun lever ce jour-là (jour ou nuit polaire)');
  const set = SearchRiseSet(Body.Sun, observer, -1, rise, 1);
  if (!set) throw new Error('aucun coucher après le lever');
  return (set.date.getTime() - rise.date.getTime()) / 3_600_000;
}
