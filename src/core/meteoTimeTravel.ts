/**
 * VOYAGE DANS LE TEMPS de la couche météo modélisée (famille B). Pour une date de simulation,
 * décide QUELLE source Open-Meteo interroger et sur QUELLE fenêtre, puis qualifie la donnée
 * réellement disponible (date réelle + statut honnête). Module PUR (dates → plan, pas de réseau)
 * → unit-testable.
 *
 * Deux endpoints Open-Meteo se partagent l'axe du temps :
 * - `forecast` (api.open-meteo.com) : de ~quelques jours de passé (analyse) jusqu'à l'horizon de
 *   prévision (~16 j). Fenêtre pilotée par `past_days` / `forecast_days`.
 * - `archive` ERA5 (archive-api.open-meteo.com) : réanalyse de 1940 jusqu'à ~5 j avant aujourd'hui.
 *   Fenêtre pilotée par `start_date` / `end_date`.
 *
 * Au-delà de l'horizon de prévision (futur lointain), aucune donnée fiable → statut `climatology`
 * (l'appelant peut choisir de ne rien afficher ou une moyenne) ; avant 1940 → `unavailable`.
 * On ne présente JAMAIS une prévision lointaine comme une certitude (invariant produit).
 */
import { dataStatusFor, type DataStatus } from './dataStatus';

/** Endpoint Open-Meteo à utiliser pour une date. */
export type MeteoSource = 'forecast' | 'archive';

export interface MeteoTimePlanOptions {
  /** « Maintenant » injectable (tests). Défaut new Date(). */
  now?: Date;
  /**
   * Bascule archive↔forecast : nombre de jours avant `now` en-dessous duquel on passe à l'archive
   * ERA5. ERA5 s'arrête ~5 j avant le présent ; le forecast couvre cette zone via l'analyse. Défaut 5.
   */
  archiveCutoffDays?: number;
  /** Horizon de prévision fiable au-delà du présent (jours). Défaut 16 (limite des modèles). */
  forecastHorizonDays?: number;
  /** Première date de la réanalyse ERA5. Défaut 1940-01-01. */
  archiveMinDate?: string;
}

export interface MeteoTimePlan {
  /** Endpoint à interroger. */
  source: MeteoSource;
  /** Pour `forecast` : jours de passé/futur à demander autour de `now`. */
  pastDays?: number;
  forecastDays?: number;
  /** Pour `archive` : jour à demander (start=end), ISO `YYYY-MM-DD`. */
  date?: string;
  /**
   * true si la donnée modélisée n'existe pas pour cette date (futur au-delà de l'horizon, ou avant
   * 1940) → l'appelant n'affiche rien / une climatologie. Les autres champs sont alors indicatifs.
   */
  outOfRange: boolean;
  /** Statut temporel honnête de la donnée servie (observed/analysis/forecast/…). */
  status: DataStatus;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Clé horaire UTC partagée par les couches Open-Meteo horaires. */
export function meteoHourKey(date: Date): string {
  return date.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

/**
 * Établit le plan de requête pour une date de simulation.
 *
 * - date < now − archiveCutoffDays → `archive` (ERA5), jour = date de simulation.
 * - sinon (zone récente + futur ≤ horizon) → `forecast`, fenêtre couvrant now → date.
 * - futur > horizon → `outOfRange`, statut `climatology`.
 * - avant archiveMinDate → `outOfRange`, statut `unavailable`.
 */
export function planMeteoRequest(
  simDate: Date,
  options: MeteoTimePlanOptions = {}
): MeteoTimePlan {
  const now = options.now ?? new Date();
  const archiveCutoffDays = options.archiveCutoffDays ?? 5;
  const forecastHorizonDays = options.forecastHorizonDays ?? 16;
  const archiveMin = new Date(`${options.archiveMinDate ?? '1940-01-01'}T00:00:00Z`);

  const status = dataStatusFor(simDate, {
    now,
    forecastDays: 7,
    uncertainDays: forecastHorizonDays,
  });

  // Avant la réanalyse → aucune donnée.
  if (simDate.getTime() < archiveMin.getTime()) {
    return { source: 'archive', outOfRange: true, status: 'unavailable' };
  }

  const deltaDays = (simDate.getTime() - now.getTime()) / DAY_MS;

  // Futur au-delà de l'horizon des modèles → climatologie (pas de prévision fiable).
  if (deltaDays > forecastHorizonDays) {
    return { source: 'forecast', outOfRange: true, status: 'climatology' };
  }

  // Passé lointain → archive ERA5 (jour ciblé).
  if (deltaDays < -archiveCutoffDays) {
    return { source: 'archive', date: isoDay(simDate), outOfRange: false, status };
  }

  // Zone récente + futur dans l'horizon → forecast. La fenêtre couvre de `pastDays` avant now
  // jusqu'à `forecastDays` après, en englobant la date demandée.
  const pastDays = Math.min(
    archiveCutoffDays + 1,
    Math.max(1, Math.ceil(-deltaDays) + 1)
  );
  const forecastDays = Math.min(
    forecastHorizonDays,
    Math.max(1, Math.ceil(deltaDays) + 1)
  );
  return { source: 'forecast', pastDays, forecastDays, outOfRange: false, status };
}

/**
 * Index horaire d'une date dans une série `archive` (ERA5) : la série démarre à minuit UTC du
 * `start_date` (= le jour de la date). Renvoie l'heure du jour [0..23].
 */
export function archiveHourIndex(simDate: Date): number {
  return simDate.getUTCHours();
}
