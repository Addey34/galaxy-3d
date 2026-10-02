/**
 * ACCÈS À LA DÉCOUVERTE D'UN CORPS ET AUX LUNES DE SON SYSTÈME — façade unique, RIEN au démarrage.
 *
 * Même forme que `config/missions.ts`, dont elle reprend les deux règles payées :
 *   - l'INDEX (`config/discoveryIndex.json`, écrit par `pnpm discovery:generate`) est importé
 *     DYNAMIQUEMENT : personne ne le télécharge sans ouvrir une fiche ;
 *   - la LISTE des satellites d'un système (`public/assets/discovery/{parent}.json`) n'arrive qu'à
 *     l'ouverture de la fiche de ce parent, à une adresse ABSOLUE, parce que le corps est porté
 *     par le chemin de l'URL (`/jupiter`) et qu'une adresse relative y rendrait 404.
 */
import type {
  DiscoveryClaim,
  RefutedClaim,
  SatelliteDiscovery,
} from '@/core/discovery';
import Logger from '@/utils/Logger';

/** Une source citée par les affirmations, telle que l'index la décrit. */
export interface DiscoverySourceInfo {
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
}

interface DiscoveryIndex {
  readonly sources: Record<string, DiscoverySourceInfo>;
  readonly bodies: Record<
    string,
    | {
        readonly claims: readonly DiscoveryClaim[];
        readonly refuted?: readonly RefutedClaim[];
      }
    | { readonly notApplicable: true }
  >;
  readonly systems: Record<string, SatelliteSystemInfo>;
}

/**
 * Une liste de satellites, telle que l'index la décrit. Deux sources possibles (ligne 22.10,
 * pas 2) : la table du JPL pour les six systèmes qu'elle couvre, SBDB pour les petits corps
 * qu'elle n'a pas en section. Le compte de la fiche dépend de laquelle, et sa note le dit.
 */
export interface SatelliteSystemInfo {
  readonly source: 'jpl-sats' | 'sbdb';
  readonly url: string;
  readonly total: number;
  readonly bytes: number;
  readonly retrieved: string;
  /** Satellites que la source déclare NON confirmés : jamais comptés, mais la fiche les nomme. */
  readonly unconfirmed?: readonly SatelliteDiscovery[];
}

let index: DiscoveryIndex | null = null;
let indexPromise: Promise<DiscoveryIndex | null> | null = null;

/** L'index, chargé une seule fois ; un échec n'est pas retenu, la fiche le redemandera. */
export function loadDiscoveryIndex(): Promise<DiscoveryIndex | null> {
  if (index) return Promise.resolve(index);
  indexPromise ??= import('./discoveryIndex.json')
    .then((module) => {
      index = module.default as unknown as DiscoveryIndex;
      return index;
    })
    .catch((error: unknown) => {
      indexPromise = null;
      Logger.warn(`[Découverte] index indisponible : ${String(error)}`);
      return null;
    });
  return indexPromise;
}

/**
 * Ce que l'index déclare pour ce corps. Trois réponses, et la distinction compte :
 *   - des AFFIRMATIONS : le corps est au catalogue et au moins une source date sa découverte ;
 *   - `notApplicable` : la question n'a pas de sens (le Soleil, la Terre), raison écrite dans
 *     `scripts/discovery-targets.json` ;
 *   - `null` : l'index n'a pas répondu, ou ce n'est pas un corps du catalogue (une SONDE ou un
 *     objet interstellaire ouvrent la même fiche). Le bloc reste masqué.
 */
export async function loadDiscovery(
  body: string
): Promise<readonly DiscoveryClaim[] | 'notApplicable' | null> {
  const loaded = await loadDiscoveryIndex();
  const entry = loaded?.bodies[body];
  if (!entry) return null;
  return 'notApplicable' in entry ? 'notApplicable' : entry.claims;
}

/**
 * Les croyances réfutées que l'index déclare pour ce corps (ligne 22.10, front des croyances),
 * ou une liste vide : la plupart des corps n'en ont pas, et la raison des cas non couverts est
 * écrite dans `scripts/discovery-targets.json`.
 */
export async function loadRefutedClaims(
  body: string
): Promise<readonly RefutedClaim[]> {
  const loaded = await loadDiscoveryIndex();
  const entry = loaded?.bodies[body];
  return entry && 'claims' in entry ? (entry.refuted ?? []) : [];
}

const systems = new Map<string, readonly SatelliteDiscovery[]>();
const failed = new Set<string>();

/**
 * Les satellites d'un système, tels que leur source les recense (la table du JPL, ou SBDB pour un
 * petit corps), avec ce que l'index en dit. `null` quand ce corps n'a pas de liste (la plupart),
 * ou si la liste n'a pas pu être lue : la ligne des lunes connues reste alors absente.
 */
export async function loadSatelliteDiscoveries(body: string): Promise<{
  satellites: readonly SatelliteDiscovery[];
  system: SatelliteSystemInfo;
} | null> {
  const loaded = await loadDiscoveryIndex();
  const system = loaded?.systems[body];
  if (!system) return null;
  const cached = systems.get(body);
  if (cached) return { satellites: cached, system };
  if (failed.has(body)) return null;
  try {
    const res = await fetch(`/assets/discovery/${body}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()) as SatelliteDiscovery[];
    systems.set(body, list);
    return { satellites: list, system };
  } catch (error: unknown) {
    failed.add(body);
    Logger.warn(`[Découverte] ${body} indisponible : ${String(error)}`);
    return null;
  }
}
