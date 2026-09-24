/**
 * FENÊTRES D'ÉPHÉMÉRIDES : quelle tranche d'un binaire Horizons la scène a-t-elle réellement
 * besoin de lire, et quelle plage d'octets la porte.
 *
 * Module PUR : aucune requête, aucun état, aucun DOM. Il rend un PLAN ; c'est le service qui
 * l'exécute (phase 17C). Plan complet, mesures et pièges dans `docs/private/EPHEMERIDES_LOT17.md`.
 *
 * Le fait qui fonde ce module, mesuré le 2026-09-23 : placer un corps coûte **96 octets**, donc
 * **5 952** pour les 62 corps que la couverture contient à cette date (les deux autres ne
 * demandent rien) ; et la première vue complète, lignes d'orbite des planètes comprises,
 * **563 472 octets, soit 1,47 %** des 38 445 024 livrés aujourd'hui.
 *
 * DEUX consommateurs, et ils ne demandent pas la même chose :
 *
 *   - la POSITION d'un corps (`HorizonsEphemerisService._sampleGrid`) lit l'échantillon qui
 *     encadre la date ET LE SUIVANT : deux états, 96 octets ;
 *   - la LIGNE D'ORBITE (`core/orbitPath.ts`) échantillonne la source précise sur une PÉRIODE
 *     entière centrée sur la date. Une fenêtre trop courte d'un seul échantillon ne dégrade
 *     donc pas un peu la ligne, et ce qu'elle lui fait dépend du corps :
 *       - corps AVEC éléments képlériens (petits corps, satellites) : `needsElementsOnly` sonde
 *         les deux extrémités, et si la source ne répond pas à l'une des deux, TOUTE la courbe
 *         repart des éléments ou de la conique osculatrice ;
 *       - corps SANS éléments, c'est-à-dire **les huit planètes**, dont l'orbite est justement
 *         la seule tracée par défaut : `needsElementsOnly` sort immédiatement et la ligne est
 *         échantillonnée par `resolve`, qui retombe sur astronomy-engine point par point. La
 *         courbe ÉPISSE alors deux sources, ce que `orbitPath.ts` rejette par principe. Sur
 *         Uranus, les deux sources s'écartaient de 111 196 km avant que son binaire n'existe
 *         (lot 12).
 *     Dans les deux cas, rien n'est journalisé : d'où les gardes de `planBodyWindow`.
 *
 * La date est convertie par `core/timeScale`, comme le lecteur : la grille d'un binaire
 * Horizons est en jours juliens TDB, et une conversion naïve depuis l'heure UTC se trompe de
 * ΔT, environ 69 s aujourd'hui. L'écart est petit devant un pas de 4 jours, mais il suffit à
 * faire diverger le planificateur du lecteur AU BORD de la couverture : l'un demanderait des
 * octets que l'autre n'emploierait pas, ou l'inverse. Défaut trouvé en relisant ce fichier.
 */

import { jdTdbFromDate } from './timeScale';

/** Composantes d'un état Horizons : position (x, y, z) puis vitesse (vx, vy, vz). */
export const COMPONENTS_PER_SAMPLE = 6;

/** Un état occupe six flottants doubles. C'est le pas d'adressage du fichier. */
export const BYTES_PER_SAMPLE =
  COMPONENTS_PER_SAMPLE * Float64Array.BYTES_PER_ELEMENT;

/**
 * Échantillons ajoutés de chaque côté de ce que la scène demande, EN PLUS de l'échantillon
 * suivant que `_sampleGrid` exige toujours (lui n'est pas une marge, il est obligatoire).
 *
 * Pourquoi 2 : `orbitPath.preciseState` estime la vitesse par différence centrée à ± 0,1 jour
 * de la date, et le pas le plus fin livré est de 1 jour (Cassini, Juno, Parker, JWST,
 * BepiColombo). Un seul échantillon suffirait donc à couvrir cette sonde ; le second est la
 * marge qui fait qu'un tic d'horloge survenu ENTRE la planification et l'arrivée des octets ne
 * peut pas vider la fenêtre, ce qui ferait retomber le corps sur une autre source, c'est-à-dire
 * exactement le saut que ce lot interdit.
 */
export const WINDOW_MARGIN_SAMPLES = 2;

const MS_PER_DAY = 86_400_000;

/** La grille d'échantillons d'un fichier, telle que le manifeste la déclare. */
export interface SampleGrid {
  /** Jour julien TDB du premier échantillon. */
  readonly startJdTdb: number;
  /** Écart entre deux échantillons, en jours. */
  readonly stepDays: number;
  /** Nombre d'échantillons du fichier. */
  readonly sampleCount: number;
}

/** Une suite d'échantillons CONTIGUS, et la plage d'octets qui la porte. */
export interface SampleWindow {
  /** Premier échantillon inclus. */
  readonly firstIndex: number;
  /** Dernier échantillon INCLUS. */
  readonly lastIndex: number;
  /** Premier octet, tel que l'en-tête `Range` l'attend. */
  readonly byteStart: number;
  /** Dernier octet INCLUS, tel que l'en-tête `Range` l'attend. */
  readonly byteEnd: number;
  /** Octets de la fenêtre. C'est la taille exacte qu'une réponse 206 doit rendre. */
  readonly byteLength: number;
}

/** Ce que la scène demande d'un corps à un instant. */
export interface BodyWindowRequest {
  /** Date affichée par la scène. */
  readonly date: Date;
  /**
   * Période de révolution en jours, UNIQUEMENT quand la ligne d'orbite de ce corps est
   * tracée. Absente = la ligne n'est pas dessinée, et seule la position est lue.
   */
  readonly orbitPeriodDays?: number;
  /**
   * Jours de lecture pris d'AVANCE, SIGNÉS : positif quand l'horloge avance, négatif quand
   * elle recule. C'est ce qui fait qu'une lecture accélérée ne bute pas sur le bord de sa
   * fenêtre à chaque pas de la grille (cf. `readAheadDays`).
   *
   * Contrairement à la période d'orbite, l'avance est BORNÉE À LA COUVERTURE au lieu d'être
   * tout ou rien : au bout du fichier, le corps cesse de répondre de toute façon, et refuser
   * d'élargir la fenêtre pour cette raison la laisserait à deux échantillons juste là où
   * l'horloge va le plus vite.
   */
  readonly leadDays?: number;
}

/** Taille totale du fichier décrit par cette grille. */
export function fileByteLength(grid: SampleGrid): number {
  return grid.sampleCount * BYTES_PER_SAMPLE;
}

/**
 * Position FRACTIONNAIRE de la date sur la grille : `0` au premier échantillon, `1` au
 * deuxième. C'est la MÊME expression que le `samplePosition` de
 * `HorizonsEphemerisService._sampleGrid`, conversion de date COMPRISE : planificateur et lecteur
 * doivent tomber sur le même échantillon, sinon l'un demande ce que l'autre n'emploie pas.
 */
export function samplePositionForDate(grid: SampleGrid, date: Date): number {
  return (jdTdbFromDate(date) - grid.startJdTdb) / grid.stepDays;
}

/**
 * Index de l'échantillon qui ENCADRE la date par le bas, ou `null` hors couverture.
 *
 * La borne haute est `sampleCount - 1` EXCLUE, et pas `sampleCount` : le lecteur a besoin de
 * l'index ET de l'index + 1, donc le dernier échantillon du fichier n'encadre rien. C'est la
 * règle de `_sampleGrid`, reprise à l'identique pour que « le planificateur demande » et
 * « le lecteur répond » ne soient jamais en désaccord.
 */
export function coveringIndex(grid: SampleGrid, date: Date): number | null {
  const position = samplePositionForDate(grid, date);
  if (!Number.isFinite(position)) return null;
  const index = Math.floor(position);
  if (index < 0 || index >= grid.sampleCount - 1) return null;
  return index;
}

/** La couverture contient-elle cette date, au sens où une position en sortira ? */
export function covers(grid: SampleGrid, date: Date): boolean {
  return coveringIndex(grid, date) !== null;
}

/** Plage d'octets d'une suite d'échantillons, bornes INCLUSES comme `Range` les veut. */
export function byteRangeForIndices(
  firstIndex: number,
  lastIndex: number
): { byteStart: number; byteEnd: number; byteLength: number } {
  const byteStart = firstIndex * BYTES_PER_SAMPLE;
  const byteEnd = (lastIndex + 1) * BYTES_PER_SAMPLE - 1;
  return { byteStart, byteEnd, byteLength: byteEnd - byteStart + 1 };
}

/** Assemble une fenêtre bornée au fichier, en ajoutant la marge déclarée. */
function windowFromIndices(
  grid: SampleGrid,
  lowIndex: number,
  highIndex: number,
  marginSamples: number
): SampleWindow {
  const last = grid.sampleCount - 1;
  // `highIndex + 1` n'est pas une marge : c'est l'échantillon SUIVANT dont le lecteur a
  // toujours besoin pour interpoler (piège 6 du plan).
  const firstIndex = Math.max(0, lowIndex - marginSamples);
  const lastIndex = Math.min(last, highIndex + 1 + marginSamples);
  return {
    firstIndex,
    lastIndex,
    ...byteRangeForIndices(firstIndex, lastIndex),
  };
}

/**
 * Index de l'échantillon encadrant, BORNÉ à la couverture au lieu d'être refusé hors d'elle.
 * Réservé à l'avance de lecture : une avance qui dépasse le fichier doit s'arrêter à son
 * dernier échantillon utile, pas annuler l'élargissement.
 */
function clampedCoveringIndex(grid: SampleGrid, date: Date): number | null {
  const position = samplePositionForDate(grid, date);
  if (!Number.isFinite(position)) return null;
  return Math.min(grid.sampleCount - 2, Math.max(0, Math.floor(position)));
}

/**
 * Avance de lecture, en jours, pour une vitesse de simulation donnée.
 *
 * `timeScale` est le nombre de secondes simulées par seconde réelle (`SimulationClock`), et il
 * est SIGNÉ : la timebar est bidirectionnelle. On demande donc les octets que l'horloge aura
 * atteints dans `seconds` secondes réelles, du bon côté de la date courante.
 *
 * Ordre de grandeur, mesuré le 2026-09-23 et écrit ici pour qu'il soit remesurable : à la
 * vitesse maximale (`MAX_SIMULATION_SCALE = 31 557 600`, un an simulé par seconde réelle),
 * suivre l'horloge sur les 64 corps coûte 2,34 Mbit/s, qu'un lien à 10 Mbit/s absorbe.
 */
export function readAheadDays(timeScale: number, seconds: number): number {
  if (!Number.isFinite(timeScale) || !Number.isFinite(seconds)) return 0;
  return (timeScale * seconds) / 86_400;
}

/**
 * La fenêtre qu'un corps demande, ou `null` s'il n'a RIEN à demander.
 *
 * `null` veut dire « aucune requête », et c'est un résultat normal, pas une erreur : hors
 * couverture, le service rend déjà `null` et le corps est placé par une autre source. Onze
 * corps sur 64 sont dans ce cas au 1969-07-20 (mesuré). Un planificateur qui ne distingue pas
 * ce cas calcule des index croisés et une longueur NÉGATIVE (piège 10, commis puis corrigé en
 * écrivant le plan).
 *
 * La ligne d'orbite n'élargit la fenêtre que si la période ENTIÈRE tient dans la couverture :
 * sinon `needsElementsOnly` écarte de toute façon la source précise pour le tracé, et demander
 * ces octets serait les payer pour rien. Mesuré au 2026-09-23 : Neptune est exactement dans ce
 * cas, sa demi-période atteignant 2108.
 */
export function planBodyWindow(
  grid: SampleGrid,
  request: BodyWindowRequest,
  marginSamples: number = WINDOW_MARGIN_SAMPLES
): SampleWindow | null {
  const index = coveringIndex(grid, request.date);
  if (index === null) return null;

  let lowIndex = index;
  let highIndex = index;

  const lead = request.leadDays;
  if (lead !== undefined && lead !== 0) {
    const ahead = clampedCoveringIndex(
      grid,
      new Date(request.date.getTime() + lead * MS_PER_DAY)
    );
    if (ahead !== null) {
      lowIndex = Math.min(lowIndex, ahead);
      highIndex = Math.max(highIndex, ahead);
    }
  }

  const period = request.orbitPeriodDays;
  if (period !== undefined && period > 0) {
    const half = (period / 2) * MS_PER_DAY;
    const from = new Date(request.date.getTime() - half);
    const to = new Date(request.date.getTime() + half);
    if (covers(grid, from) && covers(grid, to)) {
      lowIndex = Math.min(lowIndex, coveringIndex(grid, from)!);
      highIndex = Math.max(highIndex, coveringIndex(grid, to)!);
    }
  }

  return windowFromIndices(grid, lowIndex, highIndex, marginSamples);
}

/** Une fenêtre contient-elle déjà tout ce qu'une autre demande ? */
export function windowContains(
  held: SampleWindow,
  wanted: SampleWindow
): boolean {
  return (
    held.firstIndex <= wanted.firstIndex && held.lastIndex >= wanted.lastIndex
  );
}

/**
 * Réunion de deux fenêtres, pour étendre ce qu'on tient sans redemander ce qu'on a. Les deux
 * doivent venir de la MÊME grille : réunir deux pas différents mélangerait deux instants.
 */
export function mergeWindows(a: SampleWindow, b: SampleWindow): SampleWindow {
  const firstIndex = Math.min(a.firstIndex, b.firstIndex);
  const lastIndex = Math.max(a.lastIndex, b.lastIndex);
  return {
    firstIndex,
    lastIndex,
    ...byteRangeForIndices(firstIndex, lastIndex),
  };
}

/** Ce qu'une réponse a réellement apporté. */
export type RangeOutcome =
  /** Le serveur a honoré la plage : les octets sont ceux de la fenêtre demandée. */
  | { readonly kind: 'window'; readonly window: SampleWindow }
  /** Le serveur a ignoré la plage et rendu tout le fichier. On le GARDE (décision D7). */
  | { readonly kind: 'full' }
  /** Ni l'un ni l'autre : la réponse ne décrit pas ce fichier. */
  | { readonly kind: 'invalid'; readonly reason: string };

/** `bytes 1000-1095/440496` → ses trois nombres, ou `null` si l'en-tête ne parle pas d'octets. */
export function parseContentRange(
  header: string | null
): { start: number; end: number; total: number } | null {
  if (!header) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header.trim());
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: Number(match[3]),
  };
}

/**
 * Ce qu'il faut croire d'une réponse, et c'est plus subtil qu'un `status === 206`.
 *
 * MESURÉ contre la production le 2026-09-23, et c'est la raison d'être de cette fonction :
 *
 *   - une demande MULTI-PLAGES (`bytes=0-95,480-575`) est IGNORÉE par l'hôte, qui répond
 *     **200 avec les 440 496 octets du fichier**. Un lecteur qui suppose 206 avalerait 880 Ko
 *     sans un mot (piège 4). On garde donc le fichier entier, ce qui dégrade proprement vers
 *     le comportement d'aujourd'hui sur un hôte sans plages (décision D7) ;
 *   - le `Content-Range` d'une réponse 206 est confronté à ce qui a été DEMANDÉ et au total du
 *     fichier. Sans cette confrontation, une plage prise dans le flux COMPRESSÉ passerait pour
 *     valide : son `Content-Range` annonce alors la longueur brotli (417 899 au lieu de
 *     440 496 pour Mercure), ses octets sont ceux du flux et pas ceux du fichier, et rien
 *     d'autre ne le trahit (piège 1). Un navigateur n'a pas ce défaut, puisqu'il envoie
 *     `accept-encoding: identity` sur une requête de plage ; un script de mesure, si.
 */
export function interpretRangeResponse(
  status: number,
  contentRange: string | null,
  byteLength: number,
  requested: SampleWindow,
  grid: SampleGrid
): RangeOutcome {
  const total = fileByteLength(grid);

  if (status === 200) {
    return byteLength === total
      ? { kind: 'full' }
      : {
          kind: 'invalid',
          reason: `whole file expected ${total} bytes, got ${byteLength}`,
        };
  }

  if (status !== 206) {
    return { kind: 'invalid', reason: `unexpected HTTP ${status}` };
  }

  if (byteLength !== requested.byteLength) {
    return {
      kind: 'invalid',
      reason: `range expected ${requested.byteLength} bytes, got ${byteLength}`,
    };
  }

  const range = parseContentRange(contentRange);
  if (!range) {
    return { kind: 'invalid', reason: 'missing or unreadable Content-Range' };
  }
  if (range.total !== total) {
    return {
      kind: 'invalid',
      // Le cas du flux compressé tombe ici, et le message doit le rendre reconnaissable.
      reason: `Content-Range total ${range.total}, expected ${total}`,
    };
  }
  if (range.start !== requested.byteStart || range.end !== requested.byteEnd) {
    return {
      kind: 'invalid',
      reason: `Content-Range ${range.start}-${range.end}, requested ${requested.byteStart}-${requested.byteEnd}`,
    };
  }
  return { kind: 'window', window: requested };
}

/** L'en-tête `Range` d'une fenêtre. Un seul intervalle : le multi-plages est refusé par l'hôte. */
export function rangeHeader(window: SampleWindow): string {
  return `bytes=${window.byteStart}-${window.byteEnd}`;
}
