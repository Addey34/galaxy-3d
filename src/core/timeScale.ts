/**
 * LA convention d'échelle de temps de Galaxy : d'une `Date` JavaScript (UTC) vers TT et TDB.
 *
 * Pourquoi un module. Trois chemins convertissaient la même date chacun à sa façon :
 *   - `HorizonsEphemerisService` : table des secondes intercalaires, TT−UTC figé à 69,184 s
 *     après 2017 (ce que fait Horizons pour `TIME_TYPE=UT`) ;
 *   - `SpkKernel.etSecondsFromDate` : ΔT d'astronomy-engine, EXTRAPOLÉ (Espenak-Meeus),
 *     383 s en 2175 et 1 056 s en 2400 ;
 *   - astronomy-engine lui-même (planètes, Lune, événements), avec ce même ΔT extrapolé.
 * Même date, deux instants physiques différents de plusieurs minutes dans le futur : mesuré
 * contre Horizons, Titan via le noyau SPK était à 1 733 km de sa position en 2175, pour une
 * erreur de noyau de quelques kilomètres.
 *
 * Convention retenue, UNIQUE, celle d'Horizons :
 *   - depuis 1972 : UTC + table TT−UTC (TAI−UTC + 32,184 s), constante après la dernière
 *     seconde intercalaire. Pour une date future, c'est aussi l'hypothèse la plus défendable
 *     aujourd'hui : la CGPM a décidé en 2022 d'abandonner les secondes intercalaires d'ici
 *     2035, et une extrapolation de ΔT décrit UT1, pas le temps civil qu'affiche l'horloge ;
 *   - avant 1972 : la date est lue comme UT1, et ΔT = TT − UT1 vient du modèle d'Espenak et
 *     Meeus livré avec astronomy-engine (qui reproduit les valeurs historiques).
 *
 * Installée dans astronomy-engine par `SetDeltaTFunction` DÈS l'import de ce module : tout
 * module qui passe une date à astronomy-engine doit donc l'importer (vérifié par
 * `timeScale.test.ts`, qui parcourt `src/`). Le Worker SPK l'hérite par `SpkKernel.ts`.
 *
 * Ce qui n'en dépend PAS : la rotation de la Terre (`SiderealTime`) se lit sur UT, pas sur TT.
 */
import { DeltaT_EspenakMeeus, SetDeltaTFunction } from 'astronomy-engine';

const MS_PER_DAY = 86_400_000;
const J2000_UT_MS = Date.UTC(2000, 0, 1, 12);
const J2000_JD = 2_451_545;

/** Dates d'effet et valeurs TT−UTC (TAI−UTC + 32,184 s). */
export const TT_MINUS_UTC: readonly [number, number][] = [
  [Date.UTC(1972, 0, 1), 42.184],
  [Date.UTC(1972, 6, 1), 43.184],
  [Date.UTC(1973, 0, 1), 44.184],
  [Date.UTC(1974, 0, 1), 45.184],
  [Date.UTC(1975, 0, 1), 46.184],
  [Date.UTC(1976, 0, 1), 47.184],
  [Date.UTC(1977, 0, 1), 48.184],
  [Date.UTC(1978, 0, 1), 49.184],
  [Date.UTC(1979, 0, 1), 50.184],
  [Date.UTC(1980, 0, 1), 51.184],
  [Date.UTC(1981, 6, 1), 52.184],
  [Date.UTC(1982, 6, 1), 53.184],
  [Date.UTC(1983, 6, 1), 54.184],
  [Date.UTC(1985, 6, 1), 55.184],
  [Date.UTC(1988, 0, 1), 56.184],
  [Date.UTC(1990, 0, 1), 57.184],
  [Date.UTC(1991, 0, 1), 58.184],
  [Date.UTC(1992, 6, 1), 59.184],
  [Date.UTC(1993, 6, 1), 60.184],
  [Date.UTC(1994, 6, 1), 61.184],
  [Date.UTC(1996, 0, 1), 62.184],
  [Date.UTC(1997, 6, 1), 63.184],
  [Date.UTC(1999, 0, 1), 64.184],
  [Date.UTC(2006, 0, 1), 65.184],
  [Date.UTC(2009, 0, 1), 66.184],
  [Date.UTC(2012, 6, 1), 67.184],
  [Date.UTC(2015, 6, 1), 68.184],
  [Date.UTC(2017, 0, 1), 69.184],
];

/**
 * TT − (UTC ou UT1), en secondes, pour `ut` jours depuis J2000 — la signature qu'attend
 * `SetDeltaTFunction`.
 */
export function galaxyDeltaT(ut: number): number {
  const utcMs = J2000_UT_MS + ut * MS_PER_DAY;
  if (utcMs < TT_MINUS_UTC[0][0]) return DeltaT_EspenakMeeus(ut);
  let offset = TT_MINUS_UTC[0][1];
  for (const [effectiveMs, value] of TT_MINUS_UTC) {
    if (utcMs < effectiveMs) break;
    offset = value;
  }
  return offset;
}

SetDeltaTFunction(galaxyDeltaT);

/** Jours TT depuis J2000 pour une date. */
export function ttDaysFromDate(date: Date): number {
  const ut = (date.getTime() - J2000_UT_MS) / MS_PER_DAY;
  return ut + galaxyDeltaT(ut) / 86_400;
}

/** TDB − TT (s), approximation standard (amplitude < 1,7 ms), bien en dessous du km. */
function tdbMinusTtSeconds(ttDays: number): number {
  const meanAnomaly = (357.53 + 0.985_600_3 * ttDays) * (Math.PI / 180);
  return (
    0.001_657 * Math.sin(meanAnomaly) + 0.000_022 * Math.sin(2 * meanAnomaly)
  );
}

/** Jour julien TDB (échelle des binaires Horizons). */
export function jdTdbFromDate(date: Date): number {
  const ttDays = ttDaysFromDate(date);
  return J2000_JD + ttDays + tdbMinusTtSeconds(ttDays) / 86_400;
}

/** Secondes TDB depuis J2000 (« ET » SPICE, échelle des noyaux SPK). */
export function etSecondsFromDate(date: Date): number {
  // En secondes directement : passer par des jours arrondit un écart d'une seconde exacte
  // en 1,0000001 s, ce que l'extrapolation par la vitesse de la façade SPK reproduit.
  const utSeconds = (date.getTime() - J2000_UT_MS) / 1000;
  const ttSeconds = utSeconds + galaxyDeltaT(utSeconds / 86_400);
  return ttSeconds + tdbMinusTtSeconds(ttSeconds / 86_400);
}
