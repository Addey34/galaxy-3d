/**
 * CE QUE DEUX FOURNISSEURS D'ÉVÉNEMENTS TERRESTRES PARTAGENT RÉELLEMENT.
 *
 * Écrit APRÈS `core/usgsEarthquakes.ts` et `core/nasaEonet.ts`, jamais avant : le principe du
 * dépôt est qu'on ne généralise que lorsqu'un deuxième cas réel force l'abstraction. Les deux
 * étant là, ce qu'ils ont en commun se lit sans l'inventer :
 *
 *   - une CLÉ tirée de la date de scène et de l'instant réel, `null` hors couverture — donc
 *     une requête par jour simulé, et rien du tout avant le début du catalogue ;
 *   - une FENÊTRE bornée par `now` : ni l'un ni l'autre ne connaît l'avenir, et une scène
 *     future reçoit la dernière fenêtre réelle avec son écart écrit à côté ;
 *   - des POINTS datés : latitude, longitude, un libellé, un poids visuel, et surtout leur
 *     PROPRE `DatedProduct`, parce que la nature d'un séisme et celle d'un événement rapporté
 *     ne sont pas la même et ne doivent jamais se fondre dans une étiquette commune ;
 *   - un LOT qui porte sa traçabilité (`SourceCandidate`), exactement la forme que le badge
 *     des couches météo sait déjà écrire.
 *
 * Ce qu'ils ne partagent PAS, et qui reste donc dans chaque module : la longueur de fenêtre,
 * les paramètres de requête, la forme de la géométrie, la taxonomie des catégories, et le fait
 * qu'un intervalle puisse rester ouvert. Les mettre ici aurait été inventer un tronc commun
 * que les deux cas ne demandent pas.
 *
 * Ce que la couche DÉCLARE (zoom, priorité, plafond de marqueurs) vit dans `EarthEventLayer` ;
 * sa couverture, sa cadence, sa licence et ses conditions d'usage vivent dans sa fiche de
 * `src/registry/providers/`, qui est le registre prévu pour cela.
 */
import type { DatedProduct } from './temporal';
import type { SourceCandidate } from './layerSource';

/** Un point daté à la surface de la Terre, prêt à être peint. */
export interface EarthEvent {
  /** Identifiant stable de la source (clé de marqueur, jamais réinventée ici). */
  id: string;
  latitudeDeg: number;
  longitudeDeg: number;
  /** Texte court écrit à côté du marqueur quand la place le permet. */
  label: string;
  /**
   * Poids visuel, 0 à 1 : rayon du marqueur ET ordre de priorité des libellés. Un séisme le
   * tire de sa magnitude ; un événement rapporté n'a pas d'échelle commune, donc le sien est
   * constant plutôt que fabriqué.
   */
  weight: number;
  /** Couleur du marqueur (entier RGB, même convention que le catalogue). */
  color: number;
  /** Ce que CET événement dit du temps — pas ce que le lot en dit. */
  product: DatedProduct;
}

/** Un lot d'événements chargé pour une clé, avec sa traçabilité. */
export interface EarthEventBatch {
  events: EarthEvent[];
  /** Source, date réelle, nature du lot : ce que le badge du panneau affiche. */
  candidate: SourceCandidate;
}

/** Identifiant de couche d'événements. */
export type EarthEventLayerId = 'earthquakes' | 'natural-events';

/**
 * Déclaration d'une couche d'événements. C'est la forme minimale qu'il a fallu pour que le
 * même overlay et le même panneau servent les deux fournisseurs.
 */
export interface EarthEventLayer {
  id: EarthEventLayerId;
  /** Identifiant de la fiche du fournisseur (`src/registry/providers/`). */
  providerId: string;
  /** Clés i18n du libellé et de la note affichés dans le panneau. */
  labelKey: string;
  noteKey: string;
  /**
   * Valeurs interpolées dans la note. Elles viennent des constantes EXPORTÉES par le client
   * de la source, jamais d'un nombre retapé dans le dictionnaire : une note qui annoncerait
   * une magnitude minimale que la requête n'emploie plus serait une phrase publiée fausse.
   */
  noteVars: Record<string, string | number>;
  /**
   * ZOOM SÉMANTIQUE : rayon apparent minimal de la Terre, en pixels, sous lequel la couche ne
   * peint rien. Vue depuis Saturne, la Terre fait moins d'un pixel ; y empiler des centaines
   * de marqueurs ne dirait rien et masquerait la planète elle-même.
   */
  minEarthRadiusPx: number;
  /** PRIORITÉ de dessin : la couche la plus basse peint d'abord et cède la place aux autres. */
  priority: number;
  /** Plafond de marqueurs peints par image (les plus lourds d'abord). */
  maxMarkers: number;
  /** Date de scène + instant réel → clé de requête stable, `null` hors couverture. */
  keyForDate(simulationTime: Date, now: Date): string | null;
  /** Charge le lot d'une clé. Rend un lot vide en cas d'échec, relaie une annulation. */
  fetch(
    simulationTime: Date,
    now: Date,
    signal?: AbortSignal
  ): Promise<EarthEventBatch>;
}

/** Lot vide : la couche n'a rien à peindre et le badge dit « indisponible ». */
export function emptyBatch(label: string): EarthEventBatch {
  return {
    events: [],
    candidate: {
      id: `${label}-none`,
      label,
      url: '',
      realDate: '',
      approx: false,
      product: null,
    },
  };
}

/**
 * Les `count` événements les plus lourds, du plus lourd au plus léger. Sert deux fois : au
 * plafond de marqueurs de l'overlay et à la liste du panneau, qui doivent montrer LES MÊMES.
 */
export function topEvents(
  events: readonly EarthEvent[],
  count: number
): EarthEvent[] {
  return [...events].sort((a, b) => b.weight - a.weight).slice(0, count);
}
