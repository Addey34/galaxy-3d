/**
 * MODÈLE TEMPOREL de Galaxy : ce qu'une donnée affichée dit du temps, et comment le dire
 * honnêtement. Module PUR (dates → catégorie), sans DOM ni réseau. Il remplace l'ancien
 * `core/dataStatus.ts`, qui classait la météo sur la seule date et appelait donc « observé » une
 * réanalyse (contrat complet : `docs/ARCHITECTURE.md` § « Modèle temporel »).
 *
 * Les temps, jamais confondus :
 *   - simulationTime : l'instant que la SCÈNE représente (`SimulationClock.date`), un seul ;
 *   - validTime      : l'INTERVALLE que décrit la donnée (une tuile couvre un jour, MERRA-2 un
 *                      mois, une position un instant). Il peut différer de simulationTime :
 *                      une image satellite n'existe pas pour une scène en 2030, la dernière
 *                      image réelle est servie, et cet écart doit se voir ;
 *   - observationTime / publicationTime : quand la mesure a été prise, quand la source l'a
 *                      publiée. Pas encore portés par `DatedProduct` : aucune catégorie n'en
 *                      dépend aujourd'hui (les faits du lot 4 portent leur `asOf`) ;
 *   - now            : l'instant RÉEL. Lui seul sépare ce qui a pu être observé de ce qui ne
 *                      peut être qu'une prédiction.
 *
 * La CATÉGORIE dit la nature de la donnée ; la précision mesurée (km, lot 2) est un axe à part,
 * jamais fondu dedans : une éphéméride de Jupiter en 2050 et une prévision météo à 12 jours
 * sont toutes deux « prédites », et n'ont rien de commun en exactitude.
 */

/** Ce qu'est le produit, déclaré par la source : c'est lui qui décide mesure ou modèle. */
export type ProductKind =
  /** Capteur à l'instant décrit (imagerie satellite, IMERG). */
  | 'measurement'
  /** Modèle qui assimile des observations sur le passé (ERA5, MERRA-2). */
  | 'reanalysis'
  /** Run de prévision : analyse sur le présent, prévision au-delà. */
  | 'forecastModel'
  /** Position calculée (éphéméride numérique, théorie analytique, éléments képlériens). */
  | 'ephemeris';

/** Catégories visibles, de la plus directe à l'absence de donnée. */
export type TemporalCategory =
  /** La scène est au présent et la donnée décrit ce présent. */
  | 'live'
  /** Mesure d'un instant passé. */
  | 'observed'
  /** Modèle ajusté aux observations, sur un instant passé ou présent. */
  | 'reconstructed'
  /** Modèle sur un instant futur, dans la couverture où sa source fait foi. */
  | 'predicted'
  /** Calcul hors de toute fenêtre où son écart à une référence a été mesuré. */
  | 'extrapolated'
  /** Aucune donnée pour cet instant : rien n'est affiché. */
  | 'unavailable';

export const TEMPORAL_CATEGORIES: readonly TemporalCategory[] = [
  'live',
  'observed',
  'reconstructed',
  'predicted',
  'extrapolated',
  'unavailable',
];

/** Intervalle de temps [from, to], en ms UTC. `from === to` décrit un instant. */
export interface TimeInterval {
  from: number;
  to: number;
}

/** Fenêtre éventuellement ouverte (null = pas de borne de ce côté). */
export interface OpenInterval {
  from: number | null;
  to: number | null;
}

export interface DatedProduct {
  kind: ProductKind;
  /** L'intervalle que décrit la donnée affichée. */
  validTime: TimeInterval;
  /**
   * Fenêtre où l'écart de la source à une référence a été MESURÉ. Hors de cette fenêtre :
   * `extrapolated`. Absente : la source ne sait rien produire hors de sa couverture (une image,
   * un binaire échantillonné), donc rien à signaler. Mesuré ne veut pas dire exact : l'écart
   * lui-même s'affiche à part.
   */
  measured?: OpenInterval;
  /**
   * Prévision : au-delà de `now + reliableHorizonMs`, la confiance est réduite (la catégorie
   * reste `predicted`, c'est la confiance qui baisse).
   */
  reliableHorizonMs?: number;
  /**
   * Tolérance (ms) pour `live` : la scène ET la donnée à moins de cette distance de `now`.
   * Absente : la source n'est jamais « en direct » (une tuile satellite a des jours de latence).
   */
  liveToleranceMs?: number;
  /**
   * Écart toléré (ms) entre validTime et simulationTime avant de le signaler : le pas de la
   * source. Défaut 0 (tout écart hors de l'intervalle décrit est signalé).
   */
  offsetToleranceMs?: number;
}

export interface TemporalStamp {
  category: TemporalCategory;
  /** `reduced` : prévision au-delà de son horizon fiable. */
  confidence: 'nominal' | 'reduced';
  /**
   * Distance signée de simulationTime à validTime (ms) : > 0 si la donnée décrit un instant
   * POSTÉRIEUR à la scène, < 0 si antérieur, 0 si la scène tombe dans l'intervalle décrit.
   */
  offsetMs: number;
  /** true si |offsetMs| dépasse la tolérance de la source : l'écart doit être affiché. */
  offset: boolean;
}

/**
 * Distance signée d'un instant à un intervalle (0 dedans, bornes comprises) : > 0 si
 * l'intervalle est APRÈS l'instant, < 0 s'il est avant.
 */
export function signedDistanceToInterval(
  instant: number,
  interval: TimeInterval
): number {
  if (instant < interval.from) return interval.from - instant;
  if (instant > interval.to) return interval.to - instant;
  return 0;
}

function outside(interval: TimeInterval, window: OpenInterval): boolean {
  if (window.from !== null && interval.from < window.from) return true;
  if (window.to !== null && interval.to > window.to) return true;
  return false;
}

/**
 * Qualifie une donnée affichée pour une scène à `simulationTime`, à l'instant réel `now`.
 *
 * Ordre des règles, et pourquoi cet ordre :
 *  1. hors de la fenêtre mesurée → `extrapolated`, avant tout : un calcul dont personne n'a
 *     mesuré l'écart à cette date n'est ni « en direct » ni « prédit » au sens où sa source
 *     en répondrait ;
 *  2. `live` si la source l'autorise et que scène et donnée sont au présent ;
 *  3. passé/futur par rapport à `now` : l'intervalle décrit commence-t-il avant maintenant ?
 *     Oui : une mesure est `observed`, un modèle `reconstructed`. Non : `predicted` (une
 *     mesure future n'existe pas ; l'appelant ne la construit pas, et si elle arrive quand
 *     même elle est traitée comme un modèle, jamais comme une observation).
 */
export function classifyTemporal(
  product: DatedProduct,
  simulationTime: Date,
  now: Date
): TemporalStamp {
  const nowMs = now.getTime();
  const simMs = simulationTime.getTime();
  const { validTime } = product;

  const offsetMs = signedDistanceToInterval(simMs, validTime);
  const offset = Math.abs(offsetMs) > (product.offsetToleranceMs ?? 0);

  const stamp = (
    category: TemporalCategory,
    confidence: TemporalStamp['confidence'] = 'nominal'
  ): TemporalStamp => ({ category, confidence, offsetMs, offset });

  if (product.measured && outside(validTime, product.measured)) {
    return stamp('extrapolated');
  }

  const tolerance = product.liveToleranceMs;
  if (
    tolerance !== undefined &&
    Math.abs(simMs - nowMs) <= tolerance &&
    Math.abs(signedDistanceToInterval(nowMs, validTime)) <= tolerance
  ) {
    return stamp('live');
  }

  if (validTime.from <= nowMs) {
    return stamp(product.kind === 'measurement' ? 'observed' : 'reconstructed');
  }

  const reduced =
    product.reliableHorizonMs !== undefined &&
    validTime.from - nowMs > product.reliableHorizonMs;
  return stamp('predicted', reduced ? 'reduced' : 'nominal');
}

const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Intervalle [start, start + durationMs] (pas temporel d'une source). */
export function spanInterval(
  startMs: number,
  durationMs: number
): TimeInterval {
  return { from: startMs, to: startMs + durationMs };
}

/** Le jour UTC d'une date `YYYY-MM-DD…` : [00:00, 24:00]. */
export function utcDayInterval(isoDay: string): TimeInterval {
  return spanInterval(Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`), DAY_MS);
}

/** Le mois UTC d'une date `YYYY-MM-…` : [1er 00:00, 1er du mois suivant 00:00]. */
export function utcMonthInterval(isoDay: string): TimeInterval {
  const year = Number(isoDay.slice(0, 4));
  const month = Number(isoDay.slice(5, 7)) - 1;
  return { from: Date.UTC(year, month, 1), to: Date.UTC(year, month + 1, 1) };
}

/** L'heure UTC qui contient `date` : [HH:00, HH+1:00]. */
export function utcHourInterval(date: Date): TimeInterval {
  return spanInterval(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS, HOUR_MS);
}

/** Stamp d'une donnée ABSENTE : rien n'est affiché, et l'étiquette le dit. */
export const UNAVAILABLE_STAMP: TemporalStamp = {
  category: 'unavailable',
  confidence: 'nominal',
  offsetMs: 0,
  offset: false,
};

/** Clé i18n du libellé d'une catégorie (résolue côté UI via `t()`). */
export function temporalCategoryLabelKey(category: TemporalCategory): string {
  return `time.category.${category}`;
}
