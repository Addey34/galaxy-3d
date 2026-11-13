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
import { EARTH_NAMES_BODY, type EarthName } from '@/core/earthNames';
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
      /**
       * Les identifiants évalués par le croisement et SANS aucune empreinte : la preuve d'un zéro.
       * Facultatif, absent = ensemble vide. Un identifiant absent des morceaux ET de cette liste
       * n'est PAS « sans observation » : il n'a pas été évalué (GAL-SCIENCE-022A).
       */
      zeroIds?: readonly number[];
    }
  >;
  readonly complete: boolean;
}

/** Un instrument tel que l'ODE le nomme : ses noms publiés, jamais réécrits. */
interface PlaceInstrument {
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
    // La Terre a ses noms de Natural Earth (lot 53), un fichier à part ; chaque nom TRADUIT y
    // devient une entrée de plus au même point, puisque la recherche le retrouve par son nom.
    const earth = body === EARTH_NAMES_BODY;
    p = fetch(
      earth
        ? '/assets/earth-names/earth.json'
        : `/assets/gazetteer/${body}.json`
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<NamedFeature[] | EarthName[]>;
      })
      .then((list) =>
        earth
          ? (list as EarthName[]).flatMap((n) =>
              [n.name, ...Object.values(n.names ?? {})].map(
                (name) =>
                  ({
                    name,
                    code: '',
                    type: n.kind,
                    lat: n.lat,
                    lon: n.lon,
                    diameterKm: 0,
                    approved: '',
                    origin: '',
                    iauId: 0,
                  }) satisfies NamedFeature
              )
            )
          : (list as NamedFeature[])
      )
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

/**
 * POURQUOI LA RÉPONSE A QUATRE ÉTATS (GAL-SCIENCE-022A). Avant, `shard.observed[id] ?? []` faisait
 * d'une CLÉ ABSENTE une réponse « aucune empreinte ne touche cette formation ». Or une clé absente
 * dit seulement que le croisement ne l'a pas listée : une formation que l'UAI a nommée après le
 * tirage, ou que le tirage n'a jamais évaluée, y ressemblait à s'y méprendre. Un zéro est donc une
 * PREUVE POSITIVE (l'identifiant figure dans `zeroIds` de l'index), jamais un défaut.
 *
 *   - `observed`      : des observations attestées, jamais vides ;
 *   - `zero-proven`   : croisement fait, aucune empreinte (l'identifiant est dans `zeroIds`) ;
 *   - `not-evaluated` : aucune preuve de croisement pour cet identifiant ;
 *   - `unavailable`   : la question n'a pas pu être posée, ou les données sont invalides.
 */
export type PlaceUnavailableReason =
  | 'body-not-covered'
  | 'index-unavailable'
  | 'shard-unavailable'
  | 'invalid-data';

export type PlaceObservationResult =
  | { readonly status: 'observed'; readonly observations: PlaceObservation[] }
  | { readonly status: 'zero-proven' }
  | { readonly status: 'not-evaluated' }
  | {
      readonly status: 'unavailable';
      readonly reason: PlaceUnavailableReason;
      /** Ce qui est invalide, pour le journal : jamais affiché. */
      readonly detail?: string;
    };

const unavailable = (
  reason: PlaceUnavailableReason,
  detail?: string
): PlaceObservationResult => ({ status: 'unavailable', reason, detail });

const isId = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isText = (v: unknown): v is string => typeof v === 'string';

/** Le premier défaut d'un morceau, ou `null` s'il est sain. Une observation vide n'est JAMAIS un zéro. */
function shardDefect(raw: unknown, k: number, shards: number): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return 'morceau : pas un objet';
  const { instruments, observed } = raw as Record<string, unknown>;
  if (!Array.isArray(instruments)) return 'morceau : instruments absents';
  for (const inst of instruments) {
    const i = inst as Record<string, unknown> | null;
    if (
      typeof i !== 'object' ||
      i === null ||
      !isText(i.host) ||
      !isText(i.id) ||
      !isText(i.mission) ||
      !isText(i.instrument)
    )
      return 'morceau : instrument malformé';
  }
  if (
    typeof observed !== 'object' ||
    observed === null ||
    Array.isArray(observed)
  )
    return 'morceau : observed absent';
  for (const [key, entries] of Object.entries(observed)) {
    if (!/^[1-9]\d*$/.test(key) || !isId(Number(key)))
      return `morceau : identifiant illisible « ${key} »`;
    if (Number(key) % shards !== k)
      return `identifiant ${key} dans le mauvais morceau (${k})`;
    if (!Array.isArray(entries) || entries.length === 0)
      return `identifiant ${key} : observations vides sans preuve de zéro`;
    for (const entry of entries as unknown[]) {
      if (!Array.isArray(entry) || entry.length !== 5)
        return `identifiant ${key} : ligne malformée`;
      const [inst, count, first, last, label] = entry as unknown[];
      if (
        typeof inst !== 'number' ||
        !Number.isInteger(inst) ||
        inst < 0 ||
        inst >= instruments.length
      )
        return `identifiant ${key} : instrument inconnu`;
      if (!isId(count)) return `identifiant ${key} : compte invalide`;
      if (!isText(first) || !isText(last) || !isText(label))
        return `identifiant ${key} : champ texte invalide`;
      // Absente DES DEUX CÔTÉS (Viking n'en publie aucune), ou un jour de chaque côté, dans l'ordre.
      if (first !== '' || last !== '') {
        if (!DAY.test(first) || !DAY.test(last) || first > last)
          return `identifiant ${key} : dates invalides`;
      }
    }
  }
  return null;
}

/** Un morceau se contrôle UNE fois : la Lune en porte des milliers de lignes. */
const checked = new WeakMap<object, string | null>();
function checkedShard(raw: unknown, k: number, shards: number): string | null {
  if (typeof raw !== 'object' || raw === null)
    return shardDefect(raw, k, shards);
  if (!checked.has(raw)) checked.set(raw, shardDefect(raw, k, shards));
  return checked.get(raw) ?? null;
}

/** Les `zeroIds` d'un corps : un ensemble, ou le défaut qui les invalide. */
function zeroSet(cover: { zeroIds?: unknown }): Set<number> | string {
  if (cover.zeroIds === undefined) return new Set();
  if (!Array.isArray(cover.zeroIds)) return 'zeroIds : pas une liste';
  const set = new Set<number>();
  for (const id of cover.zeroIds as unknown[]) {
    if (!isId(id)) return 'zeroIds : identifiant invalide';
    if (set.has(id)) return `zeroIds : ${id} en double`;
    set.add(id);
  }
  return set;
}

/**
 * La classification, pure : un morceau déjà lu, l'index du corps, un identifiant. Elle ne fabrique
 * jamais de zéro. Une contradiction (observé ET zéro prouvé) est une donnée invalide, pas un choix.
 */
export function classifyPlace(
  cover: PlaceObservationIndex['bodies'][string],
  rawShard: unknown,
  iauId: number
): PlaceObservationResult {
  if (!isId(iauId)) return unavailable('invalid-data', `iauId ${iauId}`);
  if (!isId(cover.shards))
    return unavailable('invalid-data', 'shards invalide');
  const zeros = zeroSet(cover);
  if (typeof zeros === 'string') return unavailable('invalid-data', zeros);
  const k = iauId % cover.shards;
  const defect = checkedShard(rawShard, k, cover.shards);
  if (defect) return unavailable('invalid-data', defect);
  const shard = rawShard as Shard;
  // L'intersection se contrôle sur TOUT le morceau, pas sur la seule formation demandée.
  for (const id of zeros)
    if (id % cover.shards === k && String(id) in shard.observed)
      return unavailable(
        'invalid-data',
        `${id} à la fois observé et zéro prouvé`
      );
  const entries = shard.observed[String(iauId)];
  if (entries)
    return {
      status: 'observed',
      observations: entries.map(([inst, count, first, last, label]) => ({
        instrument: shard.instruments[inst],
        count,
        first,
        last,
        label,
      })),
    };
  if (zeros.has(iauId)) return { status: 'zero-proven' };
  return { status: 'not-evaluated' };
}

/**
 * La résolution complète, avec ses dépendances passées en argument pour être testée sans réseau :
 * `index` (null = indisponible) et `readShard` (rend le JSON brut du morceau, ou lève).
 */
export async function resolvePlaceObservations(
  deps: {
    index: PlaceObservationIndex | null;
    readShard: (body: string, k: number) => Promise<unknown>;
  },
  body: string,
  iauId: number
): Promise<PlaceObservationResult> {
  if (!deps.index) return unavailable('index-unavailable');
  const cover = deps.index.bodies[body];
  if (!cover) return unavailable('body-not-covered');
  if (!isId(cover.shards) || !isId(iauId))
    return classifyPlace(cover, null, iauId);
  let raw: unknown;
  try {
    raw = await deps.readShard(body, iauId % cover.shards);
  } catch (error: unknown) {
    return unavailable('shard-unavailable', String(error));
  }
  return classifyPlace(cover, raw, iauId);
}

const shards = new Map<string, Promise<unknown>>();

function readShardOverNetwork(body: string, k: number): Promise<unknown> {
  const key = `${body}/${k}`;
  let p = shards.get(key);
  if (!p) {
    p = fetch(`/assets/place-observations/${body}/${k}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .catch((error: unknown) => {
        shards.delete(key);
        Logger.warn(`[Lieux] ${key} indisponible : ${String(error)}`);
        throw error;
      });
    shards.set(key, p);
  }
  return p;
}

/** Ce que l'ODE a observé d'une formation, en quatre états (cf. `PlaceObservationResult`). */
export async function loadPlaceObservations(
  body: string,
  iauId: number
): Promise<PlaceObservationResult> {
  const result = await resolvePlaceObservations(
    { index: await loadPlaceIndex(), readShard: readShardOverNetwork },
    body,
    iauId
  );
  if (result.status === 'unavailable' && result.reason === 'invalid-data')
    Logger.warn(`[Lieux] ${body} ${iauId} : ${result.detail ?? 'invalide'}`);
  return result;
}
