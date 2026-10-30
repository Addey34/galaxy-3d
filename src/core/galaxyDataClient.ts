/**
 * Le CLIENT RÉSEAU du service de données de Galaxy (lot 46), séparé de `meteoClient.ts` pour être
 * chargé À LA DEMANDE : aucune couche de modèle n'est active au démarrage, et le budget JS du
 * démarrage était dépassé de 1 039 octets quand ce code y entrait (mesuré le 2026-10-12).
 */
import {
  ARCHIVE_PROVIDER,
  GALAXY_DATA_MANIFEST,
  GALAXY_DATA_VARIABLES,
  composeVariable,
  decodeGxf,
  galaxyDataFieldUrl,
  pickGalaxyDataArchive,
  pickGalaxyDataTime,
  stampToMs,
  type GalaxyDataManifest,
} from './galaxyData';
import type { ScalarGrid } from './meteoGrid';
import { planMeteoRequest, type MeteoTimePlan } from './meteoTimeTravel';
import type { DatedProduct } from './temporal';
import { PROVIDER_NAMES } from './providerNames';

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

/** Un champ, depuis le cache ou le réseau ; `null` si le service ne le rend pas (404, 503…). */
async function loadField(
  url: string,
  signal?: AbortSignal
): Promise<ReturnType<typeof decodeGxf> | null> {
  const cached = fieldCache.get(url);
  if (cached) return cached;
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  const entry = decodeGxf(await response.arrayBuffer());
  fieldCache.set(url, entry);
  if (fieldCache.size > FIELD_CACHE_MAX)
    fieldCache.delete(fieldCache.keys().next().value!);
  return entry;
}

/** Tous les champs demandés, ou `null` dès qu'un seul manque. */
async function loadFields(
  urls: Record<string, string>,
  signal?: AbortSignal
): Promise<Map<string, ReturnType<typeof decodeGxf>> | null> {
  const entries = await Promise.all(
    Object.entries(urls).map(
      async ([field, url]) => [field, await loadField(url, signal)] as const
    )
  );
  if (entries.some(([, entry]) => !entry)) return null;
  return new Map(entries as [string, ReturnType<typeof decodeGxf>][]);
}

/**
 * Les grilles servies par le service de données, ou `null` pour passer à Open-Meteo : variable
 * que le service ne rend pas, instant hors de sa couverture, service injoignable, plafond de
 * l'archive atteint ou champ invalide. Dans l'ordre : l'ARCHIVE ERA5 (réanalyse horaire, de 1940
 * à environ une semaine avant aujourd'hui), puis GFS (les analyses qui font le pont, puis la
 * prévision). Le produit rendu dit ce qui est RÉELLEMENT servi : l'instant du champ (au pas
 * d'une heure pour ERA5, de 3 h pour GFS, donc parfois décalé de la scène, ce que le badge
 * montre), une réanalyse, une analyse ou une prévision.
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
  const now = options.now ?? new Date();
  try {
    const archive = pickGalaxyDataArchive(manifest, simDate.getTime(), fields);
    if (archive) {
      const decoded = await loadFields(archive.urls, options.signal);
      if (decoded) {
        const servedMs = stampToMs(archive.stamp);
        return served(
          variables,
          decoded,
          servedMs,
          now,
          {
            kind: 'reanalysis',
            validTime: { from: servedMs, to: servedMs },
            offsetToleranceMs: 1_800_000,
          },
          ARCHIVE_PROVIDER[archive.version]
        );
      }
    }

    const picked = pickGalaxyDataTime(manifest, simDate.getTime(), fields);
    if (!picked) return null;
    const decoded = await loadFields(
      Object.fromEntries(
        fields.map((field) => [
          field,
          galaxyDataFieldUrl(manifest, picked.stamp, picked.cycle, field),
        ])
      ),
      options.signal
    );
    if (!decoded) return null;
    const servedMs = stampToMs(picked.stamp);
    const plan = planMeteoRequest(new Date(servedMs), { now });
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
    return served(
      variables,
      decoded,
      servedMs,
      now,
      product,
      PROVIDER_NAMES.gfs
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return null;
  }
}

function served(
  variables: readonly string[],
  decoded: Map<string, ReturnType<typeof decodeGxf>>,
  servedMs: number,
  now: Date,
  product: DatedProduct,
  provider: string
): {
  grids: Record<string, ScalarGrid>;
  plan: MeteoTimePlan;
  realDate: string;
  provider: string;
} {
  const grids = Object.fromEntries(
    variables.map((v) => [
      v,
      composeVariable(v, decoded.get(GALAXY_DATA_VARIABLES[v]!.field)!),
    ])
  );
  const plan = planMeteoRequest(new Date(servedMs), { now });
  return {
    grids,
    plan: { ...plan, product },
    realDate: new Date(servedMs).toISOString(),
    provider,
  };
}
