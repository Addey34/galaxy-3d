/**
 * Résolution MULTI-CANDIDATS des couches d'imagerie datée (étape B). Pour une date de
 * simulation, une couche ne dépend plus d'UNE source unique mais d'une LISTE ORDONNÉE de
 * candidats (par préférence décroissante). Le socle `datedTextureLayer` essaie chaque
 * candidat dans l'ordre et retient le premier NON VIDE — d'où « jamais de tuile vide,
 * toujours la meilleure donnée réelle existante ».
 *
 * Module PUR (dates → URLs/chaînes) : réutilise les fabriques d'URL/date existantes de
 * `gibsClouds` / `gibsPrecip` (endpoints WMS déjà génériques) et reste unit-testable.
 */
import {
  GIBS_DEFAULT_LAYER,
  GIBS_MIN_DATE,
  GIBS_MODIS_TERRA_LAYER,
  GIBS_MODIS_AQUA_LAYER,
  GIBS_MODIS_TERRA_MIN_DATE,
  GIBS_MODIS_AQUA_MIN_DATE,
  GIBS_CLOUD_FRACTION_DAY_LAYER,
  GIBS_CLOUD_FRACTION_DAY_MIN_DATE,
  GIBS_CLOUD_FRACTION_NIGHT_LAYER,
  GIBS_CLOUD_FRACTION_NIGHT_MIN_DATE,
  GIBS_LST_LAYER,
  GIBS_LST_MIN_DATE,
  gibsCloudDateFor,
  gibsCloudUrl,
  gibsMonthlyDateFor,
  toGibsDateString,
} from './gibsClouds';
import {
  IMERG_LAYER,
  IMERG_DAILY_LAYER,
  IMERG_COVERAGE,
  IMERG_MIN_DATE,
  imergEndForDate,
  imergUrl,
  snapToHalfHour,
} from './gibsPrecip';

/** Un candidat de source pour une date : ce qu'on tente de charger et sa traçabilité. */
export interface SourceCandidate {
  /** Clé stable (source + date réelle) : sert de clé de cache/gating dans le socle. */
  id: string;
  /** Libellé court de la source pour le badge (ex. « VIIRS », « MODIS Terra », « IMERG »). */
  label: string;
  /** URL WMS à charger. */
  url: string;
  /** Date/instant réellement chargé (ISO), pour le badge. */
  realDate: string;
  /** true si on s'est éloigné de la date demandée (date/source approchée) → badge « approché ». */
  approx: boolean;
  /**
   * Domaine natif connu de la source. La politique native-alpha-no-extrapolation
   * conserve les pixels no-data transparents au lieu de les remplir.
   */
  coverage?: {
    minLatitude: number;
    maxLatitude: number;
    productVersion?: string;
    policy: 'native-alpha-no-extrapolation';
  };
}

/** Résout la liste ordonnée de candidats pour une date de simulation. */
export type LayerSourceResolver = (
  simDate: Date,
  now?: Date
) => SourceCandidate[];

const HALF_HOUR_MS = 30 * 60 * 1000;

/** true si la date `iso` (YYYY-MM-DD…) est >= la borne basse `min` (YYYY-MM-DD). */
function isOnOrAfter(iso: string, min: string): boolean {
  return iso.slice(0, 10) >= min.slice(0, 10);
}

export interface CloudResolveOptions {
  /**
   * Latence de publication en jours : « aujourd'hui » vise J-latencyDays. L'imagerie VIIRS/MODIS
   * est une fauchée ORBITALE : la tuile de J-1 est souvent INCOMPLÈTE (dernière orbite non finie
   * → bande no-data → « calvitie » une fois mappée sur la sphère). J-2 est complète → défaut 2.
   */
  latencyDays?: number;
}

/**
 * NUAGES : VIIRS SNPP (≥ ~2015, préféré) → MODIS Terra (≥2000) → MODIS Aqua (≥2002). Chaque
 * candidat n'est ajouté que si la date demandée est dans son archive. `approx` reste false
 * (même jour, source différente) — la traçabilité passe par `label`.
 *
 * La latence par défaut est 2 jours (image satellite COMPLÈTE, cf. `CloudResolveOptions`). Pour le
 * temps réel sans trou et le futur, préférer la couche MODÉLISÉE (famille B, Open-Meteo).
 */
export function resolveCloudSources(
  simDate: Date,
  now: Date = new Date(),
  options: CloudResolveOptions = {}
): SourceCandidate[] {
  const latencyDays = options.latencyDays ?? 2;
  const out: SourceCandidate[] = [];
  const add = (layer: string, label: string, minDate: string): void => {
    const date = gibsCloudDateFor(simDate, { now, minDate, latencyDays });
    if (date === null) return;
    out.push({
      id: `${layer}:${date}`,
      label,
      url: gibsCloudUrl(date, { layer }),
      realDate: date,
      approx: false,
    });
  };
  add(GIBS_DEFAULT_LAYER, 'VIIRS', GIBS_MIN_DATE);
  add(GIBS_MODIS_TERRA_LAYER, 'MODIS Terra', GIBS_MODIS_TERRA_MIN_DATE);
  add(GIBS_MODIS_AQUA_LAYER, 'MODIS Aqua', GIBS_MODIS_AQUA_MIN_DATE);
  return out;
}

/**
 * Résout la couche satellite de fraction nuageuse nocturne. Elle ne remplace pas le True Color :
 * elle sert uniquement de masque de secours dans les zones sans lumière (pôles/nuit polaire).
 */
/**
 * Résout la fraction nuageuse satellite diurne MODIS Aqua.
 * La donnée est une palette scientifique PNG : le shader la décode, son alpha
 * indique les pixels réellement couverts par le produit.
 */
export function resolveCloudFractionDaySource(
  simDate: Date,
  now: Date = new Date(),
  options: CloudResolveOptions & { resolution?: number } = {}
): SourceCandidate | null {
  const date = gibsCloudDateFor(simDate, {
    now,
    minDate: GIBS_CLOUD_FRACTION_DAY_MIN_DATE,
    latencyDays: options.latencyDays ?? 2,
  });
  if (date === null) return null;
  return {
    id: `${GIBS_CLOUD_FRACTION_DAY_LAYER}:${date}`,
    label: 'MODIS Aqua cloud fraction day',
    url: gibsCloudUrl(date, {
      layer: GIBS_CLOUD_FRACTION_DAY_LAYER,
      width: options.resolution,
      format: 'image/png',
    }),
    realDate: date,
    approx: false,
  };
}

export function resolveCloudFractionNightSource(
  simDate: Date,
  now: Date = new Date(),
  options: CloudResolveOptions & { resolution?: number } = {}
): SourceCandidate | null {
  const date = gibsCloudDateFor(simDate, {
    now,
    minDate: GIBS_CLOUD_FRACTION_NIGHT_MIN_DATE,
    latencyDays: options.latencyDays ?? 2,
  });
  if (date === null) return null;
  return {
    id: `${GIBS_CLOUD_FRACTION_NIGHT_LAYER}:${date}`,
    label: 'MODIS Aqua cloud fraction night',
    url: gibsCloudUrl(date, {
      layer: GIBS_CLOUD_FRACTION_NIGHT_LAYER,
      width: options.resolution,
      format: 'image/png',
    }),
    realDate: date,
    approx: false,
  };
}
export interface PrecipResolveOptions {
  latencyHours?: number;
  minDate?: string;
  /** Nombre de pas de 30 min à reculer pour combler un trou de latence/donnée. Défaut 6 (3 h). */
  stepBack?: number;
  resolution?: number;
}

/**
 * PLUIE : IMERG 30 min à l'instant demandé, puis reculs successifs de 30 min (comble le trou
 * de latence/donnée), enfin l'IMERG QUOTIDIEN du même jour en dernier recours. Le premier
 * candidat (instant exact) est `approx:false` ; tout recul ou passage au quotidien = `approx:true`.
 * Note : GIBS n'expose pas de runs Early/Late/Final séparés — `_30min` sert déjà le meilleur run.
 */
export function resolvePrecipSources(
  simDate: Date,
  now: Date = new Date(),
  options: PrecipResolveOptions = {}
): SourceCandidate[] {
  const dateOpts = {
    now,
    latencyHours: options.latencyHours,
    minDate: options.minDate ?? IMERG_MIN_DATE,
  };
  const urlOpts = { layer: IMERG_LAYER, width: options.resolution };
  const stepBack = options.stepBack ?? 6;

  const end = imergEndForDate(simDate, dateOpts);
  if (end === null) return [];

  const out: SourceCandidate[] = [];
  for (let i = 0; i <= stepBack; i++) {
    const t = new Date(end.getTime() - i * HALF_HOUR_MS);
    // Le recul ne doit pas passer sous la borne basse.
    const clamped = imergEndForDate(t, dateOpts);
    if (clamped === null) break;
    const iso = clamped.toISOString();
    out.push({
      id: `${IMERG_LAYER}:${iso}`,
      label: 'IMERG',
      url: imergUrl(clamped, urlOpts),
      realDate: iso,
      approx: i > 0,
      coverage: IMERG_COVERAGE,
    });
  }

  // Dernier recours : IMERG quotidien du jour de `end` (plus robuste).
  const day = toGibsDateString(snapToHalfHour(end));
  out.push({
    id: `${IMERG_DAILY_LAYER}:${day}`,
    label: 'IMERG (jour)',
    url: imergUrl(end, { ...urlOpts, layer: IMERG_DAILY_LAYER }),
    realDate: day,
    approx: true,
    coverage: IMERG_COVERAGE,
  });
  return out;
}

export interface ThermalResolveOptions {
  latencyMonths?: number;
  minDate?: string;
  /** Nombre de mois à reculer pour trouver un mois publié. Défaut 3. */
  stepBackMonths?: number;
  resolution?: number;
}

/**
 * TEMPÉRATURE : MERRA-2 mensuel au mois demandé, puis reculs de mois jusqu'à trouver un mois
 * publié. Premier candidat = `approx:false` ; tout mois reculé = `approx:true`.
 */
export function resolveThermalSources(
  simDate: Date,
  now: Date = new Date(),
  options: ThermalResolveOptions = {}
): SourceCandidate[] {
  const minDate = options.minDate ?? GIBS_LST_MIN_DATE;
  const steps = options.stepBackMonths ?? 3;
  const latencyMonths = options.latencyMonths ?? 0;

  // Mois de BASE : la date demandée normalisée + clampée au dernier mois publié (gère le futur
  // → dernier disponible). On recule ENSUITE à partir de ce mois clampé (et non de simDate),
  // sinon un futur reste clampé au même mois à chaque itération.
  const base = gibsMonthlyDateFor(simDate, { now, minDate, latencyMonths });
  if (base === null) return [];
  const [by, bm] = base.split('-').map(Number); // YYYY-MM-01

  const out: SourceCandidate[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = new Date(Date.UTC(by, bm - 1 - i, 1));
    const date = toGibsDateString(d);
    if (!isOnOrAfter(date, minDate)) break;
    out.push({
      id: `${GIBS_LST_LAYER}:${date}`,
      label: 'MERRA-2',
      url: gibsCloudUrl(date, {
        layer: GIBS_LST_LAYER,
        width: options.resolution,
        format: 'image/png',
      }),
      realDate: date,
      // Le premier candidat (mois de base) correspond à la date demandée/clampée (exact) ;
      // les reculs de mois suivants sont marqués approché.
      approx: i > 0,
    });
  }
  return out;
}
