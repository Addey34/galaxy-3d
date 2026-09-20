/**
 * Client de NASA EONET v3 (Earth Observatory Natural Event Tracker) — événements naturels
 * RAPPORTÉS : incendies, éruptions, tempêtes, inondations, glaces.
 *
 * DEUXIÈME fournisseur du lot, et c'est lui qui a forcé l'abstraction : écrit après l'USGS,
 * il a montré ce que les deux partagent vraiment (`core/earthEvents.ts`) et surtout ce qu'ils
 * ne partagent pas.
 *
 * Ce qu'EONET N'EST PAS : une mesure. Son propre avertissement, lu à la source le 2026-09-20
 * (« What is EONET? », section Disclaimer) : « All EONET metadata and services are intended to
 * be used for visualization and general information purposes only and should not be construed
 * as "official" with regards to spatial or temporal extent. » Un événement y est agrégé depuis
 * des sources tierces (InciWeb, Smithsonian GVP, NOAA…) ; sa position est représentative, pas
 * relevée. D'où un `ProductKind` distinct (`'report'`) et une catégorie visible distincte
 * (`'reported'`) : une actualité ne se mélange pas à une mesure sismologique, même quand les
 * deux se dessinent sur la même sphère.
 *
 * TROIS PIÈGES du format, chacun payé en le lisant :
 *   1. `status` OMIS ne renvoie que les événements OUVERTS. Une scène au 14 mars 2011
 *      recevrait donc les incendies encore en cours aujourd'hui, et rien de 2011. La requête
 *      passe toujours `status=all`.
 *   2. `closed` vaut `null` tant qu'EONET n'a pas déclaré l'événement terminé. C'est un
 *      INTERVALLE OUVERT, c'est-à-dire une information — « toujours en cours » — et non un
 *      trou à combler par une date inventée (cf. `DatedProduct.openEnded`).
 *   3. `geometry` est une SUITE de relevés datés, pas un point : une tempête se déplace. Le
 *      relevé retenu est le dernier qui précède l'instant de la scène, donc la position
 *      rapportée À CETTE DATE, et non la dernière connue.
 *
 * Réf. : https://eonet.gsfc.nasa.gov/docs/v3
 */
import { finiteNumber } from '@/utils/jsonNumber';

/** Un événement naturel rapporté par EONET, tel que Galaxy l'affiche. */
export interface NaturalEvent {
  /** Identifiant EONET (`EONET_6789`). */
  id: string;
  title: string;
  /** Première catégorie déclarée (`wildfires`, `volcanoes`, `severeStorms`…). */
  categoryId: string;
  categoryTitle: string;
  latitudeDeg: number;
  longitudeDeg: number;
  /** Date du premier relevé de géométrie (ms UTC). */
  startMs: number;
  /** Date du relevé retenu pour la scène (ms UTC). */
  reportedMs: number;
  /** Fin déclarée, ou `null` : l'événement n'est pas clos, et ce vide est une donnée. */
  closedMs: number | null;
}

/**
 * Début de la couverture EONET. La v3 contient des événements à partir de 2000 environ ;
 * avant cette borne la couche se déclare indisponible plutôt que de rendre un lot vide.
 * Reprise telle quelle dans la fiche du fournisseur.
 */
export const EONET_COVERAGE_START = Date.UTC(2000, 0, 1);

/** Fenêtre interrogée : les N jours qui précèdent l'instant de la scène. */
export const EONET_WINDOW_DAYS = 30;

/** Plafond d'événements demandés. */
export const EONET_QUERY_LIMIT = 200;

const DAY_MS = 86_400_000;

/**
 * Fenêtre réellement interrogée, bornée par l'instant RÉEL : EONET ne rapporte pas d'événement
 * futur. Une scène au-delà reçoit la dernière fenêtre réelle, et l'écart est affiché.
 */
export function naturalEventWindow(
  simulationTime: Date,
  now: Date
): { from: number; to: number } | null {
  const to = Math.min(simulationTime.getTime(), now.getTime());
  const from = to - EONET_WINDOW_DAYS * DAY_MS;
  if (to < EONET_COVERAGE_START) return null;
  return { from: Math.max(from, EONET_COVERAGE_START), to };
}

/** Clé de requête stable : le jour UTC de fin de fenêtre. `null` hors couverture. */
export function naturalEventQueryKey(
  simulationTime: Date,
  now: Date
): string | null {
  const window = naturalEventWindow(simulationTime, now);
  if (!window) return null;
  return new Date(window.to).toISOString().slice(0, 10);
}

/** URL EONET v3 pour une fenêtre. `status=all` est OBLIGATOIRE (cf. l'en-tête). */
export function naturalEventQueryUrl(window: {
  from: number;
  to: number;
}): string {
  const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    start: day(window.from),
    end: day(window.to),
    status: 'all',
    limit: String(EONET_QUERY_LIMIT),
  });
  return `https://eonet.gsfc.nasa.gov/api/v3/events?${params.toString()}`;
}

interface EonetResponse {
  events?: {
    id?: unknown;
    title?: unknown;
    closed?: unknown;
    categories?: { id?: unknown; title?: unknown }[];
    geometry?: { date?: unknown; type?: unknown; coordinates?: unknown }[];
  }[];
}

/**
 * Point représentatif d'une géométrie EONET. Un `Point` porte `[lon, lat]` ; un `Polygon`
 * porte un anneau `[[lon, lat], …]` dont on prend la moyenne.
 *
 * La moyenne d'un anneau n'est PAS le centroïde d'un polygone, et ce n'est pas un oubli : la
 * géométrie étendue d'EONET est une emprise approximative que son propre avertissement dit de
 * ne pas prendre pour officielle. Un point représentatif suffit à dire « là », et un centroïde
 * exact prétendrait à une précision que la source refuse d'endosser.
 */
export function eonetRepresentativePoint(
  type: unknown,
  coordinates: unknown
): { latitudeDeg: number; longitudeDeg: number } | null {
  if (type === 'Point' && Array.isArray(coordinates)) {
    const longitudeDeg = finiteNumber(coordinates[0]);
    const latitudeDeg = finiteNumber(coordinates[1]);
    if (!Number.isFinite(longitudeDeg) || !Number.isFinite(latitudeDeg))
      return null;
    return { latitudeDeg, longitudeDeg };
  }
  if (type === 'Polygon' && Array.isArray(coordinates)) {
    const ring = coordinates[0];
    if (!Array.isArray(ring) || ring.length === 0) return null;
    let sumLon = 0;
    let sumLat = 0;
    let count = 0;
    for (const point of ring) {
      if (!Array.isArray(point)) continue;
      const longitudeDeg = finiteNumber(point[0]);
      const latitudeDeg = finiteNumber(point[1]);
      if (!Number.isFinite(longitudeDeg) || !Number.isFinite(latitudeDeg))
        continue;
      sumLon += longitudeDeg;
      sumLat += latitudeDeg;
      count++;
    }
    if (count === 0) return null;
    return { latitudeDeg: sumLat / count, longitudeDeg: sumLon / count };
  }
  return null;
}

/**
 * Convertit la réponse EONET en événements exploitables, pour une scène à `simulationTime`.
 * Fonction PURE, testable hors ligne.
 *
 * `simulationTime` n'est pas décoratif : c'est lui qui choisit, parmi les relevés successifs
 * d'un événement mobile, celui qui décrit la scène. Sans lui, un ouragan serait peint là où il
 * a fini, pas là où il était.
 */
export function parseEonetEvents(
  json: unknown,
  simulationTime: Date
): NaturalEvent[] {
  const response = json as EonetResponse | null;
  if (!response || !Array.isArray(response.events)) return [];
  const simMs = simulationTime.getTime();

  const out: NaturalEvent[] = [];
  for (const event of response.events) {
    const geometry = event?.geometry;
    const categories = event?.categories;
    if (!Array.isArray(geometry) || geometry.length === 0) continue;

    // Relevés datés, triés, puis le dernier qui précède la scène (le premier si elle est
    // antérieure à tous : l'événement commence après, mais la fenêtre interrogée l'a retenu).
    const dated = geometry
      .map((entry) => ({
        ms: Date.parse(String(entry?.date ?? '')),
        point: eonetRepresentativePoint(entry?.type, entry?.coordinates),
      }))
      .filter(
        (
          entry
        ): entry is { ms: number; point: NonNullable<typeof entry.point> } =>
          Number.isFinite(entry.ms) && entry.point !== null
      )
      .sort((a, b) => a.ms - b.ms);
    if (dated.length === 0) continue;

    let chosen = dated[0];
    for (const entry of dated) if (entry.ms <= simMs) chosen = entry;

    const closedRaw = event.closed;
    const closedMs =
      typeof closedRaw === 'string' ? Date.parse(closedRaw) : Number.NaN;
    const category = Array.isArray(categories) ? categories[0] : undefined;

    out.push({
      id: typeof event.id === 'string' ? event.id : `eonet-${dated[0].ms}`,
      title: typeof event.title === 'string' ? event.title : '',
      categoryId: typeof category?.id === 'string' ? category.id : 'unknown',
      categoryTitle:
        typeof category?.title === 'string' ? category.title : 'Event',
      latitudeDeg: chosen.point.latitudeDeg,
      longitudeDeg: chosen.point.longitudeDeg,
      startMs: dated[0].ms,
      reportedMs: chosen.ms,
      closedMs: Number.isFinite(closedMs) ? closedMs : null,
    });
  }
  return out;
}

/**
 * Récupère les événements naturels d'une fenêtre. Dégradation propre : toute erreur réseau ou
 * réponse malformée rend un tableau vide.
 */
export async function fetchNaturalEvents(
  window: { from: number; to: number },
  simulationTime: Date,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<NaturalEvent[]> {
  try {
    const response = await fetchImpl(naturalEventQueryUrl(window), { signal });
    if (!response.ok) return [];
    return parseEonetEvents(await response.json(), simulationTime);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error;
    return [];
  }
}
