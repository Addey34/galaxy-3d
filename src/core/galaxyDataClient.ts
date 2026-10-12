/**
 * Le CLIENT RÉSEAU du service de données de Galaxy (lot 46), séparé de `meteoClient.ts` pour être
 * chargé À LA DEMANDE : aucune couche de modèle n'est active au démarrage, et le budget JS du
 * démarrage était dépassé de 1 039 octets quand ce code y entrait (mesuré le 2026-10-12).
 */
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
import type { ScalarGrid } from './meteoGrid';
import { planMeteoRequest, type MeteoTimePlan } from './meteoTimeTravel';
import type { DatedProduct } from './temporal';

/** L'époque des caches : `clearMeteoClientCache` la change, et les caches se vident alors. */
let epochSeen = -1;

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
export async function fromGalaxyData(
  simDate: Date,
  variables: readonly string[],
  options: { now?: Date; signal?: AbortSignal },
  epoch = 0
): Promise<{
  grids: Record<string, ScalarGrid>;
  plan: MeteoTimePlan;
  realDate: string;
  provider: string;
} | null> {
  if (epoch !== epochSeen) {
    epochSeen = epoch;
    manifestCache = null;
    fieldCache.clear();
  }
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
