/**
 * Champ SCALAIRE météo mondial sur grille (couverture nuageuse %, température, pression…) —
 * généralisation de `windField` (qui reste le cas VECTORIEL u/v). Module PUR (dates→URL, parse
 * réponse→grille, échantillonnage) → unit-testable, pas de DOM/three/réseau.
 *
 * Source : Open-Meteo (`api.open-meteo.com/v1/forecast`, agrège GFS/ECMWF/ICON/GEM ; CORS ouvert,
 * sans clé, horaire, et — contrairement à l'imagerie satellite — couverture GLOBALE SANS TROU +
 * passé (réanalyse) + futur (prévision)). Une requête multi-points renvoie un tableau de points
 * dans le MÊME ordre que {@link meteoGridCoords}.
 *
 * Chemin B « famille modèle » de docs/private/WEATHER_ARCHITECTURE.md.
 */

export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
/** Endpoint archive (réanalyse ERA5, 1940 → ~5 j avant aujourd'hui). */
export const OPEN_METEO_ARCHIVE =
  'https://archive-api.open-meteo.com/v1/archive';

/**
 * Nombre MAX de points par requête Open-Meteo (contrainte serveur : « Only up to 1000 locations
 * can be requested at once »). Au-delà, on DÉCOUPE en plusieurs requêtes POST (le GET est en plus
 * limité par la taille d'URI, HTTP 414). Voir {@link chunkCoords} / {@link buildMeteoPayloads}.
 */
export const OPEN_METEO_MAX_POINTS = 1000;

export interface MeteoGridOptions {
  /** Pas de la grille en degrés (défaut 4 → ~4186 points pour maxLat 90, 5 requêtes chunkées). */
  step?: number;
  /** Latitude absolue maximale échantillonnée (défaut 90 : couverture pôle à pôle). */
  maxLat?: number;
}

const DEFAULT_STEP = 4;

/** Grille scalaire régulière échantillonnable. Valeurs indexées [row*nLon + col]. */
export interface ScalarGrid {
  step: number;
  latMin: number; // latitude de la rangée 0
  lonMin: number; // longitude de la colonne 0
  nLat: number;
  nLon: number;
  /** Valeurs du champ (unité selon la variable demandée). */
  values: Float32Array;
}

/**
 * Une grille régulière doit tomber EXACTEMENT sur ses bornes : `2 · maxLat / step` et `360 / step`
 * entiers. Sinon le nombre de rangées compté (arrondi) et celui que la requête génère divergent, la
 * dernière rangée n'existe pas dans la réponse, et toute la grille se décale ou se remplit de
 * valeurs inventées. Refus explicite plutôt qu'une grille géographiquement fausse.
 */
export function assertRegularStep(step: number, maxLat: number): void {
  const rows = (2 * maxLat) / step;
  const cols = 360 / step;
  const whole = (x: number): boolean => Math.abs(x - Math.round(x)) < 1e-9;
  if (!(step > 0) || !whole(rows) || !whole(cols))
    throw new Error(
      `pas de grille irrégulier : ${step}° ne tombe pas sur les bornes (±${maxLat}° et 360°)`
    );
}

/** Génère lats/lons de la grille (lat croissante, lon croissante), même ordre que la requête. */
export function meteoGridCoords(options: MeteoGridOptions = {}): {
  lats: number[];
  lons: number[];
} {
  const step = options.step ?? DEFAULT_STEP;
  const maxLat = options.maxLat ?? 90;
  assertRegularStep(step, maxLat);
  const lats: number[] = [];
  const lons: number[] = [];
  for (let la = -maxLat; la <= maxLat + 1e-9; la += step) {
    for (let lo = -180; lo < 180 - 1e-9; lo += step) {
      lats.push(Number(la.toFixed(4)));
      lons.push(Number(lo.toFixed(4)));
    }
  }
  return { lats, lons };
}

/** Dimensions (nLat, nLon) d'une grille pour des options données. */
export function meteoGridDims(options: MeteoGridOptions = {}): {
  nLat: number;
  nLon: number;
} {
  const step = options.step ?? DEFAULT_STEP;
  const maxLat = options.maxLat ?? 90;
  assertRegularStep(step, maxLat);
  return {
    nLat: Math.round((2 * maxLat) / step) + 1,
    nLon: Math.round(360 / step),
  };
}

/**
 * URL Open-Meteo pour un champ scalaire horaire (ex. `cloud_cover`, `temperature_2m`). `pastDays`
 * / `forecastDays` ouvrent la fenêtre temporelle (voyage dans le temps) ; l'index horaire est
 * sélectionné au parse, pas ici.
 */
export function buildMeteoGridUrl(
  variable: string,
  options: MeteoGridOptions & { pastDays?: number; forecastDays?: number } = {}
): string {
  const { lats, lons } = meteoGridCoords(options);
  const params = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lons.join(','),
    hourly: variable,
  });
  if (options.pastDays !== undefined)
    params.set('past_days', String(options.pastDays));
  params.set('forecast_days', String(options.forecastDays ?? 1));
  return `${OPEN_METEO_FORECAST}?${params.toString()}`;
}

/** Un lot de coordonnées (≤ OPEN_METEO_MAX_POINTS) à envoyer en une requête. */
export interface CoordChunk {
  lats: number[];
  lons: number[];
}

/**
 * Découpe les coordonnées de la grille en lots de `maxPoints` (défaut {@link OPEN_METEO_MAX_POINTS})
 * pour respecter la limite serveur « up to 1000 locations at once ». L'ORDRE global est préservé :
 * concaténés, les lots reforment exactement {@link meteoGridCoords}.
 */
export function chunkCoords(
  options: MeteoGridOptions = {},
  maxPoints = OPEN_METEO_MAX_POINTS
): CoordChunk[] {
  const { lats, lons } = meteoGridCoords(options);
  const chunks: CoordChunk[] = [];
  for (let i = 0; i < lats.length; i += maxPoints) {
    chunks.push({
      lats: lats.slice(i, i + maxPoints),
      lons: lons.slice(i, i + maxPoints),
    });
  }
  return chunks;
}

/** Corps JSON d'une requête POST Open-Meteo pour un lot de coordonnées. */
export interface MeteoPayload {
  latitude: number[];
  longitude: number[];
  hourly: string[];
  /** Mode forecast : fenêtre relative à « maintenant ». */
  past_days?: number;
  forecast_days?: number;
  /** Mode archive (ERA5) : un jour absolu par point (tableaux alignés sur latitude/longitude). */
  start_date?: string[];
  end_date?: string[];
}

/**
 * Construit les corps POST (un par lot) pour un champ scalaire horaire, en mode FORECAST (fenêtre
 * relative `pastDays`/`forecastDays`) OU ARCHIVE ERA5 (un jour absolu `date`, requêté sur
 * l'endpoint archive). POST (et non GET) car l'URL d'une grille fine dépasse la limite d'URI (HTTP
 * 414) ; le découpage respecte la limite de 1000 points. Concaténées dans l'ordre, les réponses
 * reforment la grille complète.
 */
const hourlyOf = (variable: string | readonly string[]): string[] =>
  typeof variable === 'string' ? [variable] : [...variable];

export function buildMeteoPayloads(
  /** Une variable, ou plusieurs servies par la MÊME requête (vitesse et direction du vent). */
  variable: string | readonly string[],
  options: MeteoGridOptions & {
    /** Mode forecast. */
    pastDays?: number;
    forecastDays?: number;
    /** Mode archive : jour ISO `YYYY-MM-DD`. Exclusif avec pastDays/forecastDays. */
    date?: string;
  } = {}
): MeteoPayload[] {
  return chunkCoords(options).map((chunk) => {
    if (options.date !== undefined) {
      // Archive ERA5 : start/end en tableaux, un par point du lot.
      const days = chunk.lats.map(() => options.date as string);
      return {
        latitude: chunk.lats,
        longitude: chunk.lons,
        hourly: hourlyOf(variable),
        start_date: days,
        end_date: days,
      };
    }
    return {
      latitude: chunk.lats,
      longitude: chunk.lons,
      hourly: hourlyOf(variable),
      ...(options.pastDays !== undefined
        ? { past_days: options.pastDays }
        : {}),
      forecast_days: options.forecastDays ?? 1,
    };
  });
}

/**
 * Une valeur de série Open-Meteo, ou NaN. Une absence (`null`, série trop courte, texte,
 * Infinity) n'est PAS un zéro : 0 °C, 0 % d'humidité ou 0 hPa sont des mesures, pas des trous.
 */
function seriesValue(series: unknown, hourIndex: number): number {
  if (!Array.isArray(series)) return NaN;
  const raw: unknown = series[hourIndex];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : NaN;
}

/** Nombre de feuilles (points) d'une réponse imbriquée : un objet seul compte pour un point. */
function countLeaves(r: unknown): number {
  return Array.isArray(r)
    ? r.reduce<number>((n, x) => n + countLeaves(x), 0)
    : 1;
}

/** Nombre de cellules à valeur FINIE (un NaN marque une donnée absente ou invalide). */
export function countFiniteCells(values: ArrayLike<number>): number {
  let count = 0;
  for (let i = 0; i < values.length; i++)
    if (Number.isFinite(values[i]!)) count++;
  return count;
}

/**
 * Refuse une grille dont AUCUNE cellule n'est finie : c'est une réponse inutilisable, pas un champ
 * à zéro. L'échec est explicite (la couche passe en erreur) plutôt qu'une carte vide présentée
 * comme une donnée. Une grille PARTIELLE est acceptée : ses trous restent des NaN.
 */
export function assertUsableGrid(grid: ScalarGrid, variable: string): void {
  if (countFiniteCells(grid.values) === 0)
    throw new Error(`grille météo entièrement invalide : ${variable}`);
}

/**
 * Construit une `ScalarGrid` depuis une ou plusieurs réponses Open-Meteo. Chaque réponse est un
 * tableau de points (ou un point unique) ; concaténées DANS L'ORDRE des lots, elles couvrent la
 * grille entière (même ordre que {@link meteoGridCoords}). Accepte donc soit une réponse unique
 * (mode GET hérité), soit un tableau de réponses chunkées (mode POST). `hourIndex` = heure.
 *
 * POLITIQUE DES ABSENCES : une valeur absente ou invalide devient NaN, jamais 0. Un point sans
 * `hourly` (ou nul) OCCUPE SA CELLULE (NaN) au lieu d'être ignoré, car l'ignorer décalerait toutes
 * les cellules suivantes vers une autre position géographique. Si le nombre de points reçus (au
 * total, ou dans un lot de taille connue) ne correspond pas à la grille, l'association cellule →
 * point ne peut plus être garantie : la fonction ÉCHOUE plutôt que de livrer une grille corrompue.
 * Une grille sans aucune cellule finie échoue aussi ({@link assertUsableGrid}).
 */
export function parseScalarGrid(
  response: unknown,
  variable: string,
  options: MeteoGridOptions = {},
  hourIndex = 0
): ScalarGrid {
  const step = options.step ?? DEFAULT_STEP;
  const maxLat = options.maxLat ?? 90;
  const { nLat, nLon } = meteoGridDims({ step, maxLat });
  const expected = nLat * nLon;

  // Aplati : une réponse chunkée est un tableau de tableaux (ou de points). Toute feuille, objet
  // valide ou non, est UN point et garde sa place.
  const slots: unknown[] = [];
  const collect = (r: unknown): void => {
    if (Array.isArray(r)) r.forEach(collect);
    else slots.push(r);
  };
  collect(response);

  // Réponse CHUNKÉE (un lot est un tableau) : exactement le nombre de lots demandés, chacun avec
  // exactement ses points. Un lot trop court, ou un nombre de lots faux dont les tailles se
  // compensent, laisserait le total juste tout en décalant les lots suivants vers d'autres
  // positions : le total seul ne prouve rien. Une réponse plate (GET hérité) n'a pas de lots.
  const chunks = chunkCoords({ step, maxLat });
  if (
    Array.isArray(response) &&
    chunks.length > 1 &&
    response.some(Array.isArray)
  ) {
    if (response.length !== chunks.length)
      throw new Error(
        `réponse météo désalignée : ${response.length} lots au lieu de ${chunks.length} (${variable})`
      );
    response.forEach((chunk, k) => {
      const received = countLeaves(chunk);
      const wanted = chunks[k]!.lats.length;
      if (received !== wanted)
        throw new Error(
          `lot météo ${k + 1}/${chunks.length} incomplet : ${received} points au lieu de ${wanted} (${variable})`
        );
    });
  }
  if (slots.length !== expected)
    throw new Error(
      `réponse météo désalignée : ${slots.length} points au lieu de ${expected} (${variable})`
    );

  const values = new Float32Array(expected);
  for (let i = 0; i < expected; i++) {
    const p = slots[i];
    const hourly =
      p && typeof p === 'object' && 'hourly' in p
        ? (p as { hourly?: Record<string, unknown> }).hourly
        : undefined;
    values[i] = seriesValue(hourly?.[variable], hourIndex);
  }
  const grid: ScalarGrid = {
    step,
    latMin: -maxLat,
    lonMin: -180,
    nLat,
    nLon,
    values,
  };
  assertUsableGrid(grid, variable);
  return grid;
}

/**
 * Index horaire d'une date de simulation dans la série renvoyée par Open-Meteo. La série démarre
 * à minuit UTC du premier jour de la fenêtre (`now - pastDays`), pas à `simDate`. On calcule donc
 * le nombre d'heures écoulées depuis ce minuit de départ. Clampé à [0, série-1] par l'appelant.
 */
export function meteoHourIndex(
  simDate: Date,
  now: Date = new Date(),
  pastDays = 0
): number {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  start.setUTCDate(start.getUTCDate() - pastDays);
  const hours = (simDate.getTime() - start.getTime()) / (60 * 60 * 1000);
  return Math.max(0, Math.round(hours));
}

/**
 * Encode une grille de COUVERTURE NUAGEUSE (0..100 %) en octets RGBA équirectangulaires prêts pour
 * une `alphaMap` : la couverture (0..1, gammaisée pour garder les nuages fins visibles) est écrite
 * en NIVEAUX DE GRIS sur R=G=B (three lit le canal vert d'une alphaMap), A=255. La couleur blanche
 * des nuages vient du `color`/`map` du matériau, pas d'ici. La rangée 0 de la grille est le SUD
 * (lat -90) ; on écrit l'image NORD en haut → inversion verticale (row 0 image = nLat-1 grille).
 * `gamma` < 1 renforce les faibles couvertures. Pur (Uint8ClampedArray, pas de three).
 */
export function cloudCoverToRGBA(
  grid: ScalarGrid,
  gamma = 0.75
): { data: Uint8ClampedArray; width: number; height: number } {
  const { nLat, nLon, values } = grid;
  const data = new Uint8ClampedArray(nLat * nLon * 4);
  for (let row = 0; row < nLat; row++) {
    const srcRow = nLat - 1 - row; // NORD (lat max) en haut de l'image
    for (let col = 0; col < nLon; col++) {
      const raw = values[srcRow * nLon + col]!;
      // Couverture ABSENTE (NaN) : une alphaMap ne sait dire que « nuage » ou « pas de nuage ».
      // Elle écrit 0 (rien n'est ajouté, et le secours ne comble rien à cet endroit), sans que
      // cela veuille dire « ciel dégagé » : la donnée manque, voir `assertUsableGrid`. L'absence
      // est rendue visuellement transparente, sans prétendre à une couverture réellement nulle.
      const cover = Number.isFinite(raw)
        ? Math.max(0, Math.min(1, raw / 100))
        : 0;
      const g = Math.round(Math.pow(cover, gamma) * 255);
      const o = (row * nLon + col) * 4;
      data[o] = g;
      data[o + 1] = g;
      data[o + 2] = g;
      data[o + 3] = 255;
    }
  }
  return { data, width: nLon, height: nLat };
}

function wrapLon(lon: number): number {
  const l = (((lon + 180) % 360) + 360) % 360;
  return l - 180;
}

/**
 * Échantillonne le champ (interpolation bilinéaire) à une position quelconque. Longitude enroulée
 * sur ±180 ; latitude clampée aux bornes de la grille.
 *
 * Valeurs ABSENTES : le résultat est NaN dès qu'une des cellules qui PÈSENT dans l'interpolation
 * (poids > 0) est invalide ; une cellule invalide à poids nul (point exactement sur un nœud ou sur
 * une rangée) ne contamine pas. Aucune cellule n'est remplacée par une voisine : un NaN rendu veut
 * dire « donnée indisponible ici », jamais zéro.
 */
export function sampleScalar(
  grid: ScalarGrid,
  lat: number,
  lon: number
): number {
  const { step, latMin, lonMin, nLat, nLon, values } = grid;
  const clampedLat = Math.max(
    latMin,
    Math.min(latMin + (nLat - 1) * step, lat)
  );
  const fLat = (clampedLat - latMin) / step;
  const fLon = (wrapLon(lon) - lonMin) / step;

  const r0 = Math.floor(fLat);
  const tr = fLat - r0;
  const r1 = tr === 0 ? r0 : Math.min(r0 + 1, nLat - 1);
  const c0 = Math.floor(fLon);
  const tc = fLon - c0;

  const idx = (r: number, c: number): number =>
    r * nLon + (((c % nLon) + nLon) % nLon);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  // Poids nul : on relit la même cellule, pour qu'un voisin invalide ne passe pas dans `lerp`.
  const c1 = tc === 0 ? c0 : c0 + 1;

  const top = lerp(values[idx(r0, c0)]!, values[idx(r0, c1)]!, tc);
  const bot = lerp(values[idx(r1, c0)]!, values[idx(r1, c1)]!, tc);
  const result = lerp(top, bot, tr);
  return Number.isFinite(result) ? result : NaN;
}
