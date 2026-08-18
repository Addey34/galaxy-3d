/**
 * STATUT TEMPOREL d'une donnée météo affichée : dérive, depuis la date RÉELLE de la donnée
 * chargée et l'instant présent, comment la qualifier honnêtement à l'utilisateur. Module PUR
 * (dates → statut, pas de DOM/réseau) → unit-testable comme les autres modules `core/`.
 *
 * Invariant produit : on ne présente JAMAIS une prévision lointaine comme une certitude. Au-delà
 * de l'horizon des modèles (~16 j), une valeur n'est plus une prévision mais une climatologie —
 * étiquetée comme telle. Symétriquement, une donnée passée est « observée » (mesure/réanalyse).
 */

/** Statut temporel honnête d'une donnée, du plus fiable au moins fiable. */
export type DataStatus =
  | 'observed' // passé/présent mesuré (satellite, réanalyse ERA5)
  | 'analysis' // meilleure estimation du présent (run d'analyse le plus récent)
  | 'forecast' // futur modélisé fiable (≤ ~7 j)
  | 'forecast_uncertain' // futur modélisé incertain (~7–16 j)
  | 'climatology' // au-delà de l'horizon des modèles → moyenne climatique, pas une prévision
  | 'unavailable'; // aucune donnée vérifiable → l'appelant n'affiche rien

export interface DataStatusOptions {
  /** Demi-fenêtre (heures) autour de `now` considérée comme « analyse » (présent). Défaut 6 h. */
  analysisWindowHours?: number;
  /** Horizon (jours) de prévision fiable au-delà du présent. Défaut 7 j. */
  forecastDays?: number;
  /** Horizon (jours) de prévision incertaine (borne haute). Défaut 16 j (limite des modèles). */
  uncertainDays?: number;
  /** « Maintenant » injectable pour les tests. Défaut new Date(). */
  now?: Date;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Qualifie une donnée dont la date RÉELLE est `dataDate` par rapport à `now`.
 *
 * - passé (au-delà de la fenêtre d'analyse) → `observed`.
 * - autour du présent (± analysisWindowHours) → `analysis`.
 * - futur ≤ forecastDays → `forecast`.
 * - futur ≤ uncertainDays → `forecast_uncertain`.
 * - au-delà → `climatology`.
 *
 * `dataDate` null (aucune donnée résolue) → `unavailable`.
 */
export function dataStatusFor(
  dataDate: Date | null,
  options: DataStatusOptions = {}
): DataStatus {
  if (dataDate === null) return 'unavailable';
  const now = options.now ?? new Date();
  const analysisWindowMs = (options.analysisWindowHours ?? 6) * HOUR_MS;
  const forecastMs = (options.forecastDays ?? 7) * DAY_MS;
  const uncertainMs = (options.uncertainDays ?? 16) * DAY_MS;

  const delta = dataDate.getTime() - now.getTime(); // >0 = futur, <0 = passé

  if (delta < -analysisWindowMs) return 'observed';
  if (delta <= analysisWindowMs) return 'analysis';
  if (delta <= forecastMs) return 'forecast';
  if (delta <= uncertainMs) return 'forecast_uncertain';
  return 'climatology';
}

/** Clé i18n du libellé d'un statut (résolue côté UI via `t()`). */
export function dataStatusLabelKey(status: DataStatus): string {
  return `weather.status.${status}`;
}
