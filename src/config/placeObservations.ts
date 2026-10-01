/**
 * ACCÈS À CE QUE L'ORBITAL DATA EXPLORER A OBSERVÉ SUR CHAQUE FORMATION NOMMÉE — façade unique, et
 * RIEN au démarrage (ligne 40.3).
 *
 * Même partition que les missions du lot 40 :
 *   - l'INDEX (`config/placeObservationIndex.json`, écrit par `pnpm places:generate`) dit quels
 *     corps l'ODE couvre, combien de formations y sont observées et en combien de MORCEAUX le
 *     fichier est coupé. Il est importé DYNAMIQUEMENT ;
 *   - le MORCEAU d'une formation (`public/assets/place-observations/{corps}/{k}.json`, avec
 *     `k = iauId % shards`) n'arrive que quand on la demande. Le fichier entier de la Lune ferait
 *     payer au visiteur des milliers de formations qu'il ne lit pas.
 *
 * L'ADRESSE EST ABSOLUE, pour la raison que le lot 37 a payée : le corps est porté par le CHEMIN
 * (`/moon`), et une adresse relative résoudrait sous `/moon/assets/…`.
 */
import type { NamedFeature } from '@/core/gazetteer';
import Logger from '@/utils/Logger';

interface PlaceObservationIndex {
  readonly provider: {
    readonly publisher: string;
    readonly title: string;
    readonly url: string;
  };
  /** Le gel du tirage : aucun produit créé après cette date n'est compté. */
  readonly frozenAt: string;
  readonly bodies: Record<
    string,
    {
      formations: number;
      observed: number;
      instruments: number;
      products: number;
      globalExcluded: number;
      shards: number;
      bytes: number;
    }
  >;
  readonly complete: boolean;
}

/** Un instrument tel que l'ODE le nomme : ses noms publiés, jamais réécrits. */
export interface PlaceInstrument {
  readonly host: string;
  readonly id: string;
  readonly mission: string;
  readonly instrument: string;
}

/** Ce qu'un instrument a observé d'une formation. */
export interface PlaceObservation {
  readonly instrument: PlaceInstrument;
  readonly count: number;
  /** Jour de la première et de la dernière observation, ISO court. */
  readonly first: string;
  readonly last: string;
  /** L'étiquette PDS de la première observation : la source primaire. */
  readonly label: string;
}

let index: PlaceObservationIndex | null = null;
let indexPromise: Promise<PlaceObservationIndex | null> | null = null;

export function loadPlaceIndex(): Promise<PlaceObservationIndex | null> {
  if (index) return Promise.resolve(index);
  indexPromise ??= import('./placeObservationIndex.json')
    .then((module) => {
      index = module.default as unknown as PlaceObservationIndex;
      return index;
    })
    .catch((error: unknown) => {
      indexPromise = null;
      Logger.warn(`[Lieux] index indisponible : ${String(error)}`);
      return null;
    });
  return indexPromise;
}

/** La provenance à citer sous le bloc, une fois l'index chargé. */
export function placeProvenance(): {
  provider: PlaceObservationIndex['provider'];
  frozenAt: string;
} | null {
  return index ? { provider: index.provider, frozenAt: index.frozenAt } : null;
}

/** Le corps est-il couvert par l'ODE ? `null` tant que l'index n'a pas répondu. */
export function placeCoverage(
  body: string
): PlaceObservationIndex['bodies'][string] | 'uncovered' | null {
  if (!index) return null;
  return index.bodies[body] ?? 'uncovered';
}

const features = new Map<string, Promise<NamedFeature[] | null>>();

/** Les formations nommées d'un corps : le fichier que le gazetteer charge déjà à l'approche. */
export function loadFormations(body: string): Promise<NamedFeature[] | null> {
  let p = features.get(body);
  if (!p) {
    p = fetch(`/assets/gazetteer/${body}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<NamedFeature[]>;
      })
      .catch((error: unknown) => {
        features.delete(body);
        Logger.warn(
          `[Lieux] formations de ${body} indisponibles : ${String(error)}`
        );
        return null;
      });
    features.set(body, p);
  }
  return p;
}

interface Shard {
  readonly instruments: readonly PlaceInstrument[];
  readonly observed: Record<
    string,
    ReadonlyArray<readonly [number, number, string, string, string]>
  >;
}
const shards = new Map<string, Promise<Shard | null>>();

/**
 * Ce que l'ODE a observé d'une formation. `[]` est une RÉPONSE (aucune empreinte ne la touche) ;
 * `null` veut dire que la question n'a pas pu être posée (corps non couvert, réseau).
 */
export async function loadPlaceObservations(
  body: string,
  iauId: number
): Promise<PlaceObservation[] | null> {
  const loaded = await loadPlaceIndex();
  const cover = loaded?.bodies[body];
  if (!cover) return null;
  const k = iauId % cover.shards;
  const key = `${body}/${k}`;
  let p = shards.get(key);
  if (!p) {
    p = fetch(`/assets/place-observations/${body}/${k}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Shard>;
      })
      .catch((error: unknown) => {
        shards.delete(key);
        Logger.warn(`[Lieux] ${key} indisponible : ${String(error)}`);
        return null;
      });
    shards.set(key, p);
  }
  const shard = await p;
  if (!shard) return null;
  return (shard.observed[String(iauId)] ?? []).map(
    ([inst, count, first, last, label]) => ({
      instrument: shard.instruments[inst],
      count,
      first,
      last,
      label,
    })
  );
}
