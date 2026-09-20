/**
 * Client du service FDSNWS « event » de l'USGS — séismes localisés et datés.
 *
 * C'est le PREMIER fournisseur d'événements terrestres de Galaxy, et il est écrit ici sans
 * aucune abstraction : ce qu'il partage avec le suivant (NASA EONET) n'a été extrait
 * (`core/earthEvents.ts`) qu'une fois les deux sous les yeux.
 *
 * Ce que le service est, et ce qu'il n'est pas. Une ligne de ce catalogue est une SOLUTION
 * D'ORIGINE : l'instant, la position et la profondeur d'une rupture, calculés à partir des
 * temps d'arrivée mesurés par un réseau de sismomètres. C'est donc une MESURE d'un instant
 * (`ProductKind: 'measurement'`), révisée après coup mais jamais prédite — il n'existe aucun
 * séisme au futur, et le voyage temporel doit le dire plutôt que d'inventer.
 *
 * L'USGS recommande ses flux GeoJSON temps réel « pour les applications automatisées », mais
 * ces flux ne couvrent que les derniers jours : une scène au 14 mars 2011 n'y trouverait rien.
 * Cette couche interroge donc le service de requête, en restant petite : une fenêtre bornée,
 * une magnitude minimale, une limite de lignes, et une seule requête par JOUR de scène
 * (`earthquakeQueryKey`).
 *
 * Conditions lues à la source le 2026-09-20 (« Copyrights and Credits », usgs.gov) : « USGS
 * authored or produced data and information are considered to be in the U.S. Public Domain »,
 * avec demande de créditer « U.S. Geological Survey ». L'attribution est affichée sous le
 * panneau des événements, pas seulement déclarée ici.
 *
 * Réf. : https://earthquake.usgs.gov/fdsnws/event/1/
 */
import { finiteNumber } from '@/utils/jsonNumber';

/** Un séisme du catalogue ANSS ComCat, tel que Galaxy l'affiche. */
export interface Earthquake {
  /** Identifiant ComCat (`us7000abcd`) — stable, sert de clé de marqueur. */
  id: string;
  magnitude: number;
  latitudeDeg: number;
  longitudeDeg: number;
  /**
   * Profondeur de l'hypocentre (km). LU mais pas encore AFFICHÉ : aucune surface ne le montre
   * aujourd'hui, et la fiche du fournisseur ne le revendique donc pas. Conservé parce qu'il
   * fait partie de la solution d'origine, au même titre que la position.
   */
  depthKm: number;
  /** Instant d'origine de la rupture (ms UTC). */
  timeMs: number;
  /** Libellé de lieu publié par l'USGS (« 24 km SSE of Ōfunato, Japan »). */
  place: string;
}

/**
 * Début du catalogue interrogeable. ComCat contient des événements historiques bien plus
 * anciens, mais de façon très inégale ; avant cette borne la couche ne demande rien et se
 * déclare indisponible plutôt que de montrer un lot vide comme s'il n'y avait pas eu de
 * séisme. C'est aussi la borne déclarée dans la fiche du fournisseur.
 */
export const USGS_CATALOG_START = Date.UTC(1900, 0, 1);

/** Fenêtre interrogée : les N jours qui PRÉCÈDENT l'instant de la scène. */
export const EARTHQUAKE_WINDOW_DAYS = 7;

/**
 * Magnitude minimale demandée. M4,5 est le seuil au-dessus duquel un séisme est ressenti et
 * couvert par le réseau mondial : environ 150 par semaine, donc un lot qui tient sous la
 * limite de lignes sans jamais la frôler.
 */
export const EARTHQUAKE_MIN_MAGNITUDE = 4.5;

/** Plafond de lignes demandées (le service refuse au-delà de 20 000 par un 400). */
export const EARTHQUAKE_QUERY_LIMIT = 500;

const DAY_MS = 86_400_000;

/**
 * Fenêtre réellement interrogée pour une scène, bornée par l'instant RÉEL : un séisme du
 * futur n'existe pas. Une scène en 2030 reçoit donc la dernière semaine réelle, et l'écart à
 * la scène est écrit par le badge (même règle que les tuiles satellite, cf.
 * `core/temporal.ts`). `null` avant le début du catalogue.
 */
export function earthquakeWindow(
  simulationTime: Date,
  now: Date
): { from: number; to: number } | null {
  const to = Math.min(simulationTime.getTime(), now.getTime());
  const from = to - EARTHQUAKE_WINDOW_DAYS * DAY_MS;
  if (to < USGS_CATALOG_START) return null;
  return { from: Math.max(from, USGS_CATALOG_START), to };
}

/**
 * Clé de requête stable : le JOUR UTC de la fin de fenêtre. Deux frames de la même journée
 * simulée partagent donc une seule requête, et un voyage temporel d'une heure n'en déclenche
 * aucune. `null` hors couverture.
 */
export function earthquakeQueryKey(
  simulationTime: Date,
  now: Date
): string | null {
  const window = earthquakeWindow(simulationTime, now);
  if (!window) return null;
  return new Date(window.to).toISOString().slice(0, 10);
}

/** URL FDSNWS pour une fenêtre. Les instants sont écrits en ISO UTC, sans millisecondes. */
export function earthquakeQueryUrl(window: {
  from: number;
  to: number;
}): string {
  const iso = (ms: number): string =>
    `${new Date(ms).toISOString().slice(0, 19)}`;
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: iso(window.from),
    endtime: iso(window.to),
    minmagnitude: String(EARTHQUAKE_MIN_MAGNITUDE),
    orderby: 'magnitude',
    limit: String(EARTHQUAKE_QUERY_LIMIT),
  });
  return `https://earthquake.usgs.gov/fdsnws/event/1/query?${params.toString()}`;
}

/** Forme minimale de la réponse GeoJSON que cette couche lit. */
interface UsgsFeatureCollection {
  features?: {
    id?: unknown;
    properties?: {
      mag?: unknown;
      place?: unknown;
      time?: unknown;
    } | null;
    geometry?: { coordinates?: unknown } | null;
  }[];
}

/**
 * Convertit la réponse GeoJSON en séismes exploitables. Fonction PURE, séparée du réseau pour
 * être testée hors ligne, comme `parseSbdbRows`.
 *
 * Robuste par ligne, jamais par lot : une entrée dont la magnitude, l'instant ou la position
 * manque est ignorée, les autres passent. L'ordre des coordonnées GeoJSON est
 * `[longitude, latitude, profondeur]` — l'inverse de l'ordre parlé, et la faute la plus
 * courante sur ce format : une inversion placerait chaque épicentre à un endroit plausible
 * mais faux, sans aucune erreur visible.
 */
export function parseUsgsEarthquakes(json: unknown): Earthquake[] {
  const collection = json as UsgsFeatureCollection | null;
  if (!collection || !Array.isArray(collection.features)) return [];

  const out: Earthquake[] = [];
  for (const feature of collection.features) {
    const properties = feature?.properties;
    const coordinates = feature?.geometry?.coordinates;
    if (!properties || !Array.isArray(coordinates)) continue;

    const magnitude = finiteNumber(properties.mag);
    const timeMs = finiteNumber(properties.time);
    const longitudeDeg = finiteNumber(coordinates[0]);
    const latitudeDeg = finiteNumber(coordinates[1]);
    const depthKm = finiteNumber(coordinates[2]);
    if (
      ![magnitude, timeMs, longitudeDeg, latitudeDeg].every(Number.isFinite) ||
      Math.abs(latitudeDeg) > 90 ||
      Math.abs(longitudeDeg) > 180
    ) {
      continue;
    }

    const id = typeof feature.id === 'string' ? feature.id : `usgs-${timeMs}`;
    out.push({
      id,
      magnitude,
      latitudeDeg,
      longitudeDeg,
      depthKm: Number.isFinite(depthKm) ? depthKm : 0,
      timeMs,
      place: typeof properties.place === 'string' ? properties.place : '',
    });
  }
  return out;
}

/**
 * Récupère les séismes d'une fenêtre. Dégradation propre, comme SBDB : toute erreur réseau ou
 * réponse malformée rend un tableau vide, et l'application continue sans la couche.
 */
export async function fetchEarthquakes(
  window: { from: number; to: number },
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<Earthquake[]> {
  try {
    const response = await fetchImpl(earthquakeQueryUrl(window), { signal });
    if (!response.ok) return [];
    return parseUsgsEarthquakes(await response.json());
  } catch (error) {
    // Une annulation doit remonter : le socle daté distingue « abandonné » de « échoué »,
    // et ne doit pas mettre en backoff une requête que lui-même vient d'annuler.
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error;
    return [];
  }
}
