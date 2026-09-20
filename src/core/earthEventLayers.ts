/**
 * Les deux couches d'événements terrestres, déclarées sur la forme commune d'`earthEvents.ts`.
 *
 * Un fichier par fournisseur aurait dupliqué quatre lignes de déclaration ; ce module est le
 * point où les deux clients bruts (`usgsEarthquakes`, `nasaEonet`) deviennent des couches que
 * l'overlay et le panneau consomment sans les connaître. Il ne contient AUCUNE règle de temps :
 * chaque événement déclare sa nature, et `core/temporal.ts` en tire la catégorie visible.
 */
import { DAY_MS } from './temporal';
import {
  emptyBatch,
  type EarthEvent,
  type EarthEventBatch,
  type EarthEventLayer,
} from './earthEvents';
import {
  earthquakeQueryKey,
  earthquakeWindow,
  fetchEarthquakes,
  EARTHQUAKE_MIN_MAGNITUDE,
  EARTHQUAKE_WINDOW_DAYS,
  type Earthquake,
} from './usgsEarthquakes';
import {
  fetchNaturalEvents,
  naturalEventQueryKey,
  naturalEventWindow,
  EONET_WINDOW_DAYS,
  type NaturalEvent,
} from './nasaEonet';

/** Magnitude au-delà de laquelle un marqueur atteint son poids maximal. */
const MAX_PLOTTED_MAGNITUDE = 9.5;

/** Accent unique des séismes : la magnitude est portée par la TAILLE, pas par la teinte. */
const EARTHQUAKE_COLOR = 0xff7a4d;

/**
 * Couleurs par catégorie EONET, sur les 13 identifiants publiés par
 * `https://eonet.gsfc.nasa.gov/api/v3/categories` (relevés le 2026-09-20). Une catégorie
 * inconnue garde la couleur de repli : EONET peut en ajouter, et une couche qui refuserait
 * l'événement plutôt que sa couleur perdrait une information réelle.
 */
const EONET_CATEGORY_COLORS: Readonly<Record<string, number>> = {
  drought: 0xd8b26a,
  dustHaze: 0xbfa98a,
  earthquakes: 0xff7a4d,
  floods: 0x5aa9e6,
  landslides: 0xa9785a,
  manmade: 0x9f8fd0,
  seaLakeIce: 0x9fe7ff,
  severeStorms: 0x6fd3c7,
  snow: 0xe6f0ff,
  tempExtremes: 0xff9f6a,
  volcanoes: 0xff5a5a,
  waterColor: 0x7fd18f,
  wildfires: 0xff4d2e,
};
const EONET_FALLBACK_COLOR = 0xc8d4e6;

/** Longueur maximale d'un titre peint à côté d'un marqueur. */
const MAX_LABEL_CHARS = 28;

function shorten(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_LABEL_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…`;
}

/**
 * Un séisme → un événement peint. Sa nature est une MESURE d'un instant : la solution
 * d'origine date la rupture, elle ne décrit aucune durée.
 */
export function earthquakeToEvent(quake: Earthquake): EarthEvent {
  const span = MAX_PLOTTED_MAGNITUDE - EARTHQUAKE_MIN_MAGNITUDE;
  const weight = Math.min(
    Math.max((quake.magnitude - EARTHQUAKE_MIN_MAGNITUDE) / span, 0),
    1
  );
  return {
    id: quake.id,
    latitudeDeg: quake.latitudeDeg,
    longitudeDeg: quake.longitudeDeg,
    label: `M${quake.magnitude.toFixed(1)}`,
    weight,
    color: EARTHQUAKE_COLOR,
    product: {
      kind: 'measurement',
      validTime: { from: quake.timeMs, to: quake.timeMs },
    },
  };
}

/**
 * Un événement EONET → un événement peint. `closed: null` devient `openEnded` : l'intervalle
 * n'a pas de fin DÉCLARÉE, et c'est ce que le panneau écrit (« en cours »). Le poids est
 * constant, faute d'échelle commune entre un incendie et une banquise.
 */
export function naturalEventToEvent(event: NaturalEvent): EarthEvent {
  const closed = event.closedMs;
  return {
    id: event.id,
    latitudeDeg: event.latitudeDeg,
    longitudeDeg: event.longitudeDeg,
    label: shorten(event.title || event.categoryTitle),
    weight: 0.5,
    color: EONET_CATEGORY_COLORS[event.categoryId] ?? EONET_FALLBACK_COLOR,
    product: {
      kind: 'report',
      validTime: { from: event.startMs, to: closed ?? event.reportedMs },
      openEnded: closed === null,
    },
  };
}

/**
 * Couche des séismes (USGS). `fetchImpl` n'existe que pour les tests : la production passe le
 * `fetch` du navigateur.
 */
export function earthquakeLayer(
  fetchImpl: typeof fetch = fetch
): EarthEventLayer {
  return {
    id: 'earthquakes',
    providerId: 'usgs-earthquake-catalog',
    labelKey: 'earthEvents.quakes.label',
    noteKey: 'earthEvents.quakes.note',
    noteVars: {
      magnitude: EARTHQUAKE_MIN_MAGNITUDE,
      days: EARTHQUAKE_WINDOW_DAYS,
    },
    // La Terre doit occuper au moins ce rayon pour qu'un épicentre veuille dire un lieu.
    minEarthRadiusPx: 40,
    priority: 0,
    maxMarkers: 160,
    keyForDate: earthquakeQueryKey,
    async fetch(simulationTime, now, signal): Promise<EarthEventBatch> {
      const window = earthquakeWindow(simulationTime, now);
      if (!window) return emptyBatch('USGS');
      const quakes = await fetchEarthquakes(window, fetchImpl, signal);
      return {
        events: quakes.map(earthquakeToEvent),
        candidate: {
          id: `usgs-${window.to}`,
          label: 'USGS',
          url: '',
          realDate: new Date(window.to).toISOString(),
          approx: false,
          product: {
            kind: 'measurement',
            validTime: { from: window.from, to: window.to },
            // La fenêtre est arrêtée à l'instant du chargement, alors que l'horloge continue :
            // sans cette tolérance, le badge annonçait un écart à la scène au bout de cinq
            // secondes de lecture. Un jour est la granularité de la clé de requête.
            offsetToleranceMs: DAY_MS,
          },
        },
      };
    },
  };
}

/** Couche des événements naturels rapportés (NASA EONET). */
export function naturalEventLayer(
  fetchImpl: typeof fetch = fetch
): EarthEventLayer {
  return {
    id: 'natural-events',
    providerId: 'nasa-eonet',
    labelKey: 'earthEvents.natural.label',
    noteKey: 'earthEvents.natural.note',
    noteVars: { days: EONET_WINDOW_DAYS },
    minEarthRadiusPx: 40,
    priority: 1,
    maxMarkers: 120,
    keyForDate: naturalEventQueryKey,
    async fetch(simulationTime, now, signal): Promise<EarthEventBatch> {
      const window = naturalEventWindow(simulationTime, now);
      if (!window) return emptyBatch('EONET');
      const events = await fetchNaturalEvents(
        window,
        simulationTime,
        fetchImpl,
        signal
      );
      return {
        events: events.map(naturalEventToEvent),
        candidate: {
          id: `eonet-${window.to}`,
          label: 'NASA EONET',
          url: '',
          realDate: new Date(window.to).toISOString(),
          approx: false,
          product: {
            kind: 'report',
            validTime: { from: window.from, to: window.to },
            offsetToleranceMs: DAY_MS,
          },
        },
      };
    },
  };
}
