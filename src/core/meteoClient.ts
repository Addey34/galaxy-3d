/**
 * Client partagé pour les grilles scalaires Open-Meteo.
 *
 * Les couches nuages, température et pluie ont le même cycle : plan temporel, choix forecast/
 * archive, découpage POST, index horaire puis parsing. Ce module centralise ce cycle afin qu'une
 * correction de fenêtre ou de lot soit appliquée à toutes les couches.
 *
 * DEPUIS LE LOT 46 (2026-10-12), le SERVICE DE DONNÉES de Galaxy passe d'abord : le modèle GFS de
 * la NOAA au pas de 1°, récupéré une fois par cycle et servi à tous (`core/galaxyData.ts`). Open-
 * Meteo ne sert plus que ce que le service ne couvre pas (l'archive au-delà de sa fenêtre), ou
 * quand il ne répond pas : son quota se compte par adresse IP, et une grille mondiale l'épuisait.
 */
import {
  OPEN_METEO_ARCHIVE,
  OPEN_METEO_FORECAST,
  buildMeteoPayloads,
  meteoHourIndex,
  parseScalarGrid,
  type MeteoGridOptions,
  type ScalarGrid,
} from './meteoGrid';
import {
  archiveHourIndex,
  planMeteoRequest,
  type MeteoTimePlan,
} from './meteoTimeTravel';
import {
  GALAXY_DATA_MANIFEST,
  GALAXY_DATA_VARIABLES,
  composeVariable,
  decodeGxf,
  galaxyDataFieldUrl,
  pickGalaxyDataTime,
  stampToMs,
  type GalaxyDataManifest,
} from './galaxyData';
import type { DatedProduct } from './temporal';

export interface MeteoGridFetchOptions {
  variable: string;
  forecastGrid: MeteoGridOptions;
  archiveGrid: MeteoGridOptions;
  now?: Date;
  /** Annule ce consommateur ; le fetch partagé n'est aborté que si aucun autre ne l'attend. */
  signal?: AbortSignal;
  /** Réglages réseau facultatifs, principalement utiles aux tests déterministes. */
  network?: MeteoNetworkOptions;
  /** Open-Meteo seulement, sans le service de données : les tests de ce chemin. */
  skipGalaxyData?: boolean;
}

export interface MeteoNetworkOptions {
  /** Nombre total d'essais, première requête comprise. */
  maxAttempts?: number;
  /** Délai initial entre deux essais transitoires (429/5xx). */
  baseDelayMs?: number;
  /** Délai maximal entre deux essais. */
  maxDelayMs?: number;
  /** Durée de conservation d'une réponse réussie en mémoire. 0 désactive le cache. */
  cacheTtlMs?: number;
  /** Sommeil injectable pour les tests. */
  sleep?: (delayMs: number) => Promise<void>;
}

export interface MeteoGridData {
  grid: ScalarGrid | null;
  plan: MeteoTimePlan;
  realDate: string;
  /** Le fournisseur RÉELLEMENT interrogé, quand ce n'est pas Open-Meteo (« NOAA GFS »). */
  provider?: string;
}
const DEFAULT_NETWORK: Required<Omit<MeteoNetworkOptions, 'sleep'>> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  cacheTtlMs: 5 * 60 * 1000,
};

const responseCache = new Map<string, { expiresAt: number; value: unknown }>();

interface SharedRequest {
  key: string;
  promise: Promise<unknown>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}

const inFlightRequests = new Map<string, SharedRequest>();

function requestKey(endpoint: string, body: object): string {
  return endpoint + '|' + JSON.stringify(body);
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('Retry-After');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(0, timestamp - Date.now())
    : null;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Requête annulée', 'AbortError');
}

function consumeSharedRequest(
  request: SharedRequest,
  signal?: AbortSignal
): Promise<unknown> {
  request.consumers++;

  return new Promise((resolve, reject) => {
    let finished = false;

    const release = (): void => {
      request.consumers = Math.max(0, request.consumers - 1);
      if (request.consumers === 0 && !request.settled) {
        if (inFlightRequests.get(request.key) === request)
          inFlightRequests.delete(request.key);
        request.controller.abort();
      }
    };
    const finish = (
      callback: (value: unknown) => void,
      value: unknown
    ): void => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      release();
      callback(value);
    };
    const onAbort = (): void => finish(reject, abortReason(signal));

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    void request.promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

async function fetchJson(
  endpoint: string,
  body: object,
  options: MeteoNetworkOptions = {},
  signal?: AbortSignal
): Promise<unknown> {
  const network = { ...DEFAULT_NETWORK, ...options };
  const key = requestKey(endpoint, body);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) responseCache.delete(key);

  const pending = inFlightRequests.get(key);
  if (pending) return consumeSharedRequest(pending, signal);

  const controller = new AbortController();
  const requestPromise = (async (): Promise<unknown> => {
    for (
      let attempt = 0;
      attempt < Math.max(1, network.maxAttempts);
      attempt++
    ) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok) {
        const value = (await response.json()) as unknown;
        if (network.cacheTtlMs > 0) {
          responseCache.set(key, {
            expiresAt: Date.now() + network.cacheTtlMs,
            value,
          });
        }
        return value;
      }

      const transient = response.status === 429 || response.status >= 500;
      const lastAttempt = attempt + 1 >= Math.max(1, network.maxAttempts);
      if (!transient || lastAttempt) throw new Error('HTTP ' + response.status);

      const exponential = Math.min(
        network.baseDelayMs * 2 ** attempt,
        network.maxDelayMs
      );
      const delay = retryAfterMs(response) ?? exponential;
      await (network.sleep ?? wait)(Math.max(0, delay));
      if (controller.signal.aborted) throw abortReason(controller.signal);
    }
    throw new Error('Open-Meteo request exhausted retries');
  })();

  const request: SharedRequest = {
    key,
    promise: requestPromise,
    controller,
    consumers: 0,
    settled: false,
  };
  inFlightRequests.set(key, request);
  void requestPromise
    .finally(() => {
      request.settled = true;
      if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
    })
    .catch(() => {});

  return consumeSharedRequest(request, signal);
}

let manifestCache: {
  value: GalaxyDataManifest | null;
  expiresAt: number;
} | null = null;

/**
 * Le manifeste du service, gardé cinq minutes comme son `Cache-Control`. Une panne est gardée
 * aussi, une minute : sans cela, chaque couche et chaque heure re-sonderaient un service
 * injoignable avant de passer à Open-Meteo.
 */
async function galaxyDataManifest(
  signal?: AbortSignal
): Promise<GalaxyDataManifest | null> {
  if (manifestCache && manifestCache.expiresAt > Date.now())
    return manifestCache.value;
  let value: GalaxyDataManifest | null = null;
  try {
    const response = await fetch(GALAXY_DATA_MANIFEST, { signal });
    if (response.ok) {
      const json = (await response.json()) as GalaxyDataManifest;
      value = json.format === 'GXF1' ? json : null;
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  manifestCache = {
    value,
    expiresAt: Date.now() + (value ? 5 * 60_000 : 60_000),
  };
  return value;
}

/** Les champs déjà décodés, par URL : un champ publié ne change jamais (immuable). */
const fieldCache = new Map<string, ReturnType<typeof decodeGxf>>();
const FIELD_CACHE_MAX = 24;

/**
 * Les grilles servies par le service de données, ou `null` pour passer à Open-Meteo : variable
 * que le service ne rend pas, instant hors de sa fenêtre, service injoignable ou champ invalide.
 * Le produit rendu dit ce qui est RÉELLEMENT servi : l'instant du champ (au pas de 3 h ou 6 h,
 * donc parfois décalé de la scène, ce que le badge montre), une analyse du passé ou une prévision.
 */
async function fromGalaxyData(
  simDate: Date,
  variables: readonly string[],
  options: { now?: Date; signal?: AbortSignal }
): Promise<{
  grids: Record<string, ScalarGrid>;
  plan: MeteoTimePlan;
  realDate: string;
  provider: string;
} | null> {
  if (!variables.every((v) => v in GALAXY_DATA_VARIABLES)) return null;
  const manifest = await galaxyDataManifest(options.signal);
  if (!manifest) return null;
  const fields = [
    ...new Set(variables.map((v) => GALAXY_DATA_VARIABLES[v]!.field)),
  ];
  const picked = pickGalaxyDataTime(manifest, simDate.getTime(), fields);
  if (!picked) return null;
  try {
    const decoded = new Map<string, ReturnType<typeof decodeGxf>>();
    for (const field of fields) {
      const url = galaxyDataFieldUrl(
        manifest,
        picked.stamp,
        picked.cycle,
        field
      );
      let entry = fieldCache.get(url);
      if (!entry) {
        const response = await fetch(url, { signal: options.signal });
        if (!response.ok) return null;
        entry = decodeGxf(await response.arrayBuffer());
        fieldCache.set(url, entry);
        if (fieldCache.size > FIELD_CACHE_MAX)
          fieldCache.delete(fieldCache.keys().next().value!);
      }
      decoded.set(field, entry);
    }
    const grids = Object.fromEntries(
      variables.map((v) => [
        v,
        composeVariable(v, decoded.get(GALAXY_DATA_VARIABLES[v]!.field)!),
      ])
    );
    const servedMs = stampToMs(picked.stamp);
    const plan = planMeteoRequest(new Date(servedMs), {
      now: options.now ?? new Date(),
    });
    const product: DatedProduct =
      picked.kind === 'analysis'
        ? {
            kind: 'reanalysis',
            validTime: { from: servedMs, to: servedMs },
            offsetToleranceMs: 3_600_000,
          }
        : {
            kind: 'forecastModel',
            validTime: { from: servedMs, to: servedMs },
            offsetToleranceMs: 3_600_000,
            ...(plan.product?.reliableHorizonMs
              ? { reliableHorizonMs: plan.product.reliableHorizonMs }
              : {}),
          };
    return {
      grids,
      plan: { ...plan, product },
      realDate: new Date(servedMs).toISOString(),
      provider: 'NOAA GFS',
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return null;
  }
}

/** Vide le cache mémoire du client, notamment entre deux scénarios de test. */
export function clearMeteoClientCache(): void {
  manifestCache = null;
  fieldCache.clear();
  responseCache.clear();
  [...inFlightRequests.values()].forEach(({ controller }) =>
    controller.abort()
  );
  inFlightRequests.clear();
}

/** Charge une grille scalaire à la date demandée, via forecast ou archive ERA5. */
export async function fetchMeteoGrid(
  simDate: Date,
  options: MeteoGridFetchOptions
): Promise<MeteoGridData> {
  const { grids, plan, realDate, provider } = await fetchMeteoGrids(simDate, {
    ...options,
    variables: [options.variable],
  });
  return {
    grid: grids?.[options.variable] ?? null,
    plan,
    realDate,
    ...(provider ? { provider } : {}),
  };
}

/**
 * Plusieurs variables d'un même instant, dans les MÊMES requêtes : le vent a besoin de sa vitesse
 * et de sa direction, et les demander séparément doublerait les appels pour deux grilles qui
 * doivent décrire la même heure. Même plan temporel, même découpage, même cache que
 * `fetchMeteoGrid`, qui n'en est que le cas à une variable.
 */
export async function fetchMeteoGrids(
  simDate: Date,
  options: Omit<MeteoGridFetchOptions, 'variable'> & {
    variables: readonly string[];
  }
): Promise<{
  grids: Record<string, ScalarGrid> | null;
  plan: MeteoTimePlan;
  realDate: string;
  provider?: string;
}> {
  const now = options.now ?? new Date();
  const plan = planMeteoRequest(simDate, { now });
  const realDate = simDate.toISOString();

  if (plan.outOfRange) return { grids: null, plan, realDate };

  if (!options.skipGalaxyData) {
    const served = await fromGalaxyData(simDate, options.variables, options);
    if (served) return served;
  }

  const isArchive = plan.source === 'archive';
  const gridOptions = isArchive ? options.archiveGrid : options.forecastGrid;
  const endpoint = isArchive ? OPEN_METEO_ARCHIVE : OPEN_METEO_FORECAST;
  const payloads = buildMeteoPayloads(options.variables, {
    ...gridOptions,
    ...(isArchive
      ? { date: plan.date }
      : { pastDays: plan.pastDays, forecastDays: plan.forecastDays }),
  });
  const responses = await Promise.all(
    payloads.map((body) =>
      fetchJson(endpoint, body, options.network, options.signal)
    )
  );
  const hour = isArchive
    ? archiveHourIndex(simDate)
    : meteoHourIndex(simDate, now, plan.pastDays);
  const grids = Object.fromEntries(
    options.variables.map((variable) => [
      variable,
      parseScalarGrid(responses, variable, gridOptions, hour),
    ])
  );
  return { grids, plan, realDate };
}
