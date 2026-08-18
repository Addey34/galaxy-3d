/**
 * Client partagé pour les grilles scalaires Open-Meteo.
 *
 * Les couches nuages, température et pluie ont le même cycle : plan temporel, choix forecast/
 * archive, découpage POST, index horaire puis parsing. Ce module centralise ce cycle afin qu'une
 * correction de fenêtre ou de lot soit appliquée à toutes les couches.
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

export interface MeteoGridFetchOptions {
  variable: string;
  forecastGrid: MeteoGridOptions;
  archiveGrid: MeteoGridOptions;
  now?: Date;
  /** Réglages réseau facultatifs, principalement utiles aux tests déterministes. */
  network?: MeteoNetworkOptions;
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
}
const DEFAULT_NETWORK: Required<Omit<MeteoNetworkOptions, 'sleep'>> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  cacheTtlMs: 5 * 60 * 1000,
};

const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightRequests = new Map<string, Promise<unknown>>();

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

async function fetchJson(
  endpoint: string,
  body: object,
  options: MeteoNetworkOptions = {}
): Promise<unknown> {
  const network = { ...DEFAULT_NETWORK, ...options };
  const key = requestKey(endpoint, body);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) responseCache.delete(key);

  const pending = inFlightRequests.get(key);
  if (pending) return pending;

  const request = (async (): Promise<unknown> => {
    for (
      let attempt = 0;
      attempt < Math.max(1, network.maxAttempts);
      attempt++
    ) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
    }
    throw new Error('Open-Meteo request exhausted retries');
  })();

  inFlightRequests.set(key, request);
  try {
    return await request;
  } finally {
    inFlightRequests.delete(key);
  }
}

/** Vide le cache mémoire du client, notamment entre deux scénarios de test. */
export function clearMeteoClientCache(): void {
  responseCache.clear();
  inFlightRequests.clear();
}

/** Charge une grille scalaire à la date demandée, via forecast ou archive ERA5. */
export async function fetchMeteoGrid(
  simDate: Date,
  options: MeteoGridFetchOptions
): Promise<MeteoGridData> {
  const now = options.now ?? new Date();
  const plan = planMeteoRequest(simDate, { now });
  const realDate = simDate.toISOString();

  if (plan.outOfRange) return { grid: null, plan, realDate };

  const isArchive = plan.source === 'archive';
  const gridOptions = isArchive ? options.archiveGrid : options.forecastGrid;
  const endpoint = isArchive ? OPEN_METEO_ARCHIVE : OPEN_METEO_FORECAST;
  const payloads = buildMeteoPayloads(options.variable, {
    ...gridOptions,
    ...(isArchive
      ? { date: plan.date }
      : { pastDays: plan.pastDays, forecastDays: plan.forecastDays }),
  });
  const responses = await Promise.all(
    payloads.map((body) => fetchJson(endpoint, body, options.network))
  );
  const hour = isArchive
    ? archiveHourIndex(simDate)
    : meteoHourIndex(simDate, now, plan.pastDays);
  const grid = parseScalarGrid(responses, options.variable, gridOptions, hour);
  return { grid, plan, realDate };
}
