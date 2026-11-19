/**
 * INSPECTION D'UN POINT du globe dans les grilles météo DÉJÀ chargées (GAL-METEO-INSPECT-002).
 *
 * Module PUR : ni DOM, ni three, ni réseau. Il lit, il ne charge jamais. Une couche garde la
 * RÉFÉRENCE de sa grille courante (`HeldField`, jamais une copie) et répond à `inspect(lat, lon)`
 * par une lecture qui dit AUSSI ce que vaut cette valeur : quel fournisseur, quel produit, pour
 * quelle heure, à quelle résolution, et si elle décrit encore la scène.
 *
 * RÈGLES, chacune tenue par un test :
 *   - une valeur NaN est INDISPONIBLE (`missing`), jamais zéro ; un vrai zéro est lu comme tel ;
 *   - rien n'est extrapolé hors de la grille : latitude au-delà de ses bornes ou coordonnée non
 *     finie = `outOfCoverage` (`sampleScalar` clamperait en silence) ;
 *   - une grille chargée pour une AUTRE heure que la scène (changement de date, échec de
 *     chargement, réponse en retard) est `stale` et NE REND AUCUNE VALEUR : une ancienne donnée
 *     n'est jamais présentée comme actuelle ;
 *   - un écart entre l'heure demandée et la date effective du champ (GFS : pas de 3 h) est une
 *     différence LÉGITIME du fournisseur, portée par `provenance.effectiveOffsetMs`, et ne rend
 *     pas la donnée `stale` ;
 *   - la direction du vent se déduit des composantes u/v INTERPOLÉES, jamais d'une interpolation
 *     d'angles (359° et 1° ne font pas 180°) ; un vent calme n'a pas de direction ;
 *   - le taux GFS (mm/h instantané) et le cumul de l'heure précédente d'Open-Meteo et d'ERA5 sont
 *     deux natures : l'unité et `nature` les distinguent.
 */
import {
  classifyTemporal,
  type DatedProduct,
  type TemporalCategory,
} from './temporal';
import { sampleScalar, type ScalarGrid } from './meteoGrid';
import { sampleWind, type WindGrid } from './windField';
import { meteoHourKey, type MeteoTimePlan } from './meteoTimeTravel';
import type { MeteoLayerPhase } from './meteoDiagnostics';
import { PROVIDER_NAMES } from './providerNames';
import { RAD_TO_DEG } from './MathConstants';

export type InspectVariable =
  | 'temperature'
  | 'pressure'
  | 'humidity'
  | 'precipitation'
  | 'cloudCover'
  | 'wind';

/**
 * Pourquoi une lecture ne rend pas de valeur :
 *  - `missing`        : la cellule est absente ou invalide à ce point (NaN) ;
 *  - `outOfCoverage`  : le point est hors de la grille (latitude au-delà de ses bornes, coordonnée
 *                       non finie) ;
 *  - `stale`          : la grille décrit une AUTRE heure que la scène ;
 *  - `noData`         : la couche est active mais n'a aucune grille pour la scène (chargement
 *                       initial, date hors plage du modèle, échec sans donnée antérieure) ;
 *  - `inactive`       : la couche est masquée ; l'inspection ne l'active jamais.
 */
export type Availability =
  'available' | 'missing' | 'outOfCoverage' | 'stale' | 'noData' | 'inactive';

/** Pourquoi une couche active n'a pas de grille : date hors plage, ou pas encore reçue. */
export type EmptyReason = 'outOfRange' | 'notLoaded';

/** Nature d'une précipitation : instantanée (GFS) ou cumulée sur l'heure qui précède. */
export type PrecipitationNature = 'instantRate' | 'precedingHourAccumulation';

/** Ce que dit une valeur du temps et de sa source. */
export interface FieldProvenance {
  /** Fournisseur RÉEL (« NOAA GFS », « Open-Meteo », « ECMWF ERA5 »…), pas celui qu'on visait. */
  provider: string;
  /** Nature du produit : mesure, réanalyse, analyse, run de prévision. */
  productKind: DatedProduct['kind'] | null;
  /** Catégorie visible pour la scène (`reconstructed`, `predicted`…), `null` sans produit. */
  temporalCategory: TemporalCategory | null;
  /** `reduced` : prévision au-delà de son horizon fiable. */
  confidence: 'nominal' | 'reduced' | null;
  /** Endpoint qui a servi la grille : prévision ou archive ERA5. */
  planSource: MeteoTimePlan['source'];
  /** L'heure (UTC, ISO) pour laquelle la grille a été DEMANDÉE : celle de la scène à ce moment. */
  requestedHour: string;
  /** La date que décrit EFFECTIVEMENT le champ (ISO). Peut différer de `requestedHour`. */
  effectiveDate: string;
  /** effectiveDate − requestedHour (ms) : 0 pour Open-Meteo (valeur horaire de HH:00). */
  effectiveOffsetMs: number;
  /**
   * Pas de la grille SERVIE en degrés (1° GFS, grille de requête Open-Meteo, 9° d'archive) : ce n'est
   * PAS la résolution native du modèle, souvent plus fine ; l'interpolation ne la dépasse pas.
   */
  stepDegrees: number;
}

interface ReadingBase {
  variable: InspectVariable;
  availability: Availability;
  /** `null` pour `inactive` et `noData` : il n'y a pas de champ à décrire. */
  provenance: FieldProvenance | null;
  /** État de chargement de la couche (`error` : le dernier chargement a échoué). */
  phase: MeteoLayerPhase;
  /** Renseigné quand `availability === 'noData'`. */
  emptyReason?: EmptyReason;
}

export interface ScalarReading extends ReadingBase {
  kind: 'scalar';
  /** Unité de la valeur (`°C`, `hPa`, `%`, `mm/h`, `mm`). */
  unit: string;
  /** `null` dès que `availability !== 'available'`. */
  value: number | null;
  /** Seulement pour la précipitation. */
  nature?: PrecipitationNature;
}

export interface WindReading extends ReadingBase {
  kind: 'wind';
  /** Vitesse à 10 m en km/h, depuis les composantes u/v interpolées. */
  speedKmh: number | null;
  /** Direction D'OÙ VIENT le vent, 0 = nord, sens horaire. `null` au calme ou sans valeur. */
  directionDeg: number | null;
  /** `true` sous {@link CALM_SPEED_KMH} : aucune direction significative. */
  calm: boolean | null;
}

export type FieldReading = ScalarReading | WindReading;

/** Sous cette vitesse (km/h, Beaufort 0), la direction n'a pas de sens : vent calme. */
export const CALM_SPEED_KMH = 1;

/** Une grille GARDÉE par une couche (par référence), avec ce qu'il faut pour la lire honnêtement. */
export interface HeldField<G> {
  grid: G;
  /** Clé horaire de la scène pour laquelle la grille a été chargée (`meteoHourKey`). */
  requestedKey: string;
  provider: string;
  plan: Pick<MeteoTimePlan, 'source' | 'product'>;
  /** `realDate` de la réponse : la date effective du champ. */
  realDate: string;
  /** `true` si la grille vient du service de données de Galaxy (GFS, ERA5). */
  viaService: boolean;
}

/** Ce que la lecture doit savoir de l'instant et de la couche, jamais d'une grille. */
export interface ReadContext {
  /** La date de la scène, lue à l'instant de la lecture. */
  sceneDate: Date;
  /** « Maintenant », injectable (tests). */
  now?: Date;
  /** La couche est-elle visible ? Sinon `inactive`, sans toucher à rien. */
  active: boolean;
  phase: MeteoLayerPhase;
  /** Pourquoi la couche n'a pas de grille, si elle n'en a pas. */
  emptyReason?: EmptyReason;
}

/** Construit ce qu'une couche garde, depuis la réponse de `fetchMeteoGrid(s)` et la clé demandée. */
export function holdField<G>(
  grid: G,
  requestedKey: string,
  data: {
    plan: Pick<MeteoTimePlan, 'source' | 'product'>;
    realDate: string;
    provider?: string;
  }
): HeldField<G> {
  const viaService = data.provider !== undefined;
  return {
    grid,
    requestedKey,
    provider:
      data.provider ??
      (data.plan.source === 'archive'
        ? PROVIDER_NAMES.era5
        : PROVIDER_NAMES.openMeteo),
    plan: { source: data.plan.source, product: data.plan.product },
    realDate: data.realDate,
    viaService,
  };
}

const requestedHourIso = (key: string): string => `${key}:00:00.000Z`;

function provenanceOf(
  held: HeldField<unknown>,
  stepDegrees: number,
  ctx: ReadContext
): FieldProvenance {
  const stamp = held.plan.product
    ? classifyTemporal(held.plan.product, ctx.sceneDate, ctx.now ?? new Date())
    : null;
  const requested = Date.parse(requestedHourIso(held.requestedKey));
  const effective = Date.parse(held.realDate);
  return {
    provider: held.provider,
    productKind: held.plan.product?.kind ?? null,
    temporalCategory: stamp?.category ?? null,
    confidence: stamp?.confidence ?? null,
    planSource: held.plan.source,
    requestedHour: requestedHourIso(held.requestedKey),
    effectiveDate: held.realDate,
    effectiveOffsetMs: effective - requested,
    stepDegrees,
  };
}

/**
 * Les portes communes aux deux lectures, dans l'ordre : couche masquée, pas de grille, grille
 * d'une autre heure. Rend l'`availability` qui s'impose, ou `null` si la grille peut être lue.
 */
function gate(
  held: HeldField<unknown> | null,
  ctx: ReadContext
): { availability: Availability; emptyReason?: EmptyReason } | null {
  if (!ctx.active) return { availability: 'inactive' };
  if (!held)
    return {
      availability: 'noData',
      emptyReason: ctx.emptyReason ?? 'notLoaded',
    };
  if (held.requestedKey !== meteoHourKey(ctx.sceneDate))
    return { availability: 'stale' };
  return null;
}

/** Le point est-il DANS la grille ? Pas d'extrapolation silencieuse au-delà de ses bornes. */
function covers(
  grid: Pick<ScalarGrid, 'step' | 'latMin' | 'nLat'>,
  lat: number,
  lon: number
): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const latMax = grid.latMin + (grid.nLat - 1) * grid.step;
  return lat >= grid.latMin - 1e-9 && lat <= latMax + 1e-9;
}

function precipitationNature(held: HeldField<unknown>): PrecipitationNature {
  // Le taux de GFS est instantané ; ERA5 (service) et Open-Meteo rendent le cumul de l'heure
  // qui PRÉCÈDE l'instant. Le service convertit déjà les deux en mm/h : pas de conversion ici.
  return held.provider === PROVIDER_NAMES.gfs
    ? 'instantRate'
    : 'precedingHourAccumulation';
}

/** Lit une variable SCALAIRE à (lat, lon) dans la grille gardée par une couche. */
export function readScalar(
  variable: Exclude<InspectVariable, 'wind'>,
  unit: string,
  held: HeldField<ScalarGrid> | null,
  ctx: ReadContext,
  lat: number,
  lon: number
): ScalarReading {
  const base = { kind: 'scalar' as const, variable, phase: ctx.phase };
  const nature =
    variable === 'precipitation' && held
      ? precipitationNature(held)
      : undefined;
  const unitOf =
    nature === 'precedingHourAccumulation'
      ? 'mm'
      : variable === 'precipitation'
        ? 'mm/h'
        : unit;
  const closed = gate(held, ctx);
  const provenance =
    held && closed?.availability !== 'inactive'
      ? provenanceOf(held, held.grid.step, ctx)
      : null;
  const none = (availability: Availability, emptyReason?: EmptyReason) => ({
    ...base,
    unit: unitOf,
    availability,
    value: null,
    provenance,
    ...(nature ? { nature } : {}),
    ...(emptyReason ? { emptyReason } : {}),
  });
  if (closed) return none(closed.availability, closed.emptyReason);
  if (!held) return none('noData'); // inatteignable : `gate` l'a traité
  if (!covers(held.grid, lat, lon)) return none('outOfCoverage');
  const value = sampleScalar(held.grid, lat, lon);
  if (!Number.isFinite(value)) return none('missing');
  return {
    ...base,
    unit: unitOf,
    availability: 'available',
    value,
    provenance,
    ...(nature ? { nature } : {}),
  };
}

/** Lit le VENT à (lat, lon) : u/v interpolés, puis vitesse et direction qu'on en déduit. */
export function readWind(
  held: HeldField<WindGrid> | null,
  ctx: ReadContext,
  lat: number,
  lon: number
): WindReading {
  const base = {
    kind: 'wind' as const,
    variable: 'wind' as const,
    phase: ctx.phase,
  };
  const closed = gate(held, ctx);
  const provenance =
    held && closed?.availability !== 'inactive'
      ? provenanceOf(held, held.grid.step, ctx)
      : null;
  const none = (availability: Availability, emptyReason?: EmptyReason) => ({
    ...base,
    availability,
    speedKmh: null,
    directionDeg: null,
    calm: null,
    provenance,
    ...(emptyReason ? { emptyReason } : {}),
  });
  if (closed) return none(closed.availability, closed.emptyReason);
  if (!held) return none('noData');
  if (!covers(held.grid, lat, lon)) return none('outOfCoverage');
  const { u, v } = sampleWind(held.grid, lat, lon);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return none('missing');
  const speedKmh = Math.hypot(u, v);
  const calm = speedKmh < CALM_SPEED_KMH;
  // u : vers l'est, v : vers le nord. La direction météo est celle D'OÙ vient l'air.
  const directionDeg = calm
    ? null
    : (Math.atan2(-u, -v) * RAD_TO_DEG + 360) % 360;
  return {
    ...base,
    availability: 'available',
    speedKmh,
    directionDeg,
    calm,
    provenance,
  };
}
