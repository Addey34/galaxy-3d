/**
 * L'ADRESSE D'UNE OBSERVATION DU VOISINAGE SOLAIRE (GAL-UNIVERSE-004).
 *
 * Module PUR : il lit et écrit des chaînes de requête, jamais `window`. Il vit dans le morceau
 * `stellarView` (chargé au premier usage) : le démarrage ne porte que la lecture d'une clé
 * (`ui/skyLayerToggles`), pas ce contrat.
 *
 * Sept clés, et seulement sept (`visit` et `step` sont celles de la visite guidée, GAL-UNIVERSE-005 ;
 * `explore` et `planet`, celles de l'exploration d'un système, GAL-UNIVERSE-006) :
 *
 *   - `view=neighbourhood` : la vue 3D du voisinage est ouverte ;
 *   - `star=<identifiant>` : l'étoile (ou le système) choisie, identifiée par son NOM normalisé
 *     (`starSlug`), jamais par son rang dans la liste, qui change avec le catalogue ;
 *   - `t=<années>` : le déplacement dans le temps du curseur de la vue, en années depuis la date de
 *     la scène (`date=`, déjà portée par le permalien solaire). Absent = « à la date de la scène ».
 *   - `visit=<identifiant>` et `step=<rang>` : la visite guidée en cours et son étape (rang à partir de 0).
 *     La visite fixe ELLE-MÊME l'étoile, le décalage de temps et le cadrage de chaque étape : à
 *     l'ouverture, `visit` l'emporte sur `star` et `t` ; ils reprennent leur sens dès que la visite est
 *     quittée.
 *   - `explore=1` : le système de l'étoile choisie est exploré (`ui/systemExplorer`) ; sans `star`, il
 *     ne signifie rien et n'est pas écrit ;
 *   - `planet=<identifiant>` : la planète choisie dans l'exploration (nom normalisé par `starSlug`) ;
 *     sans `explore`, elle ne signifie rien.
 *
 * CE QUI N'Y EST PAS, volontairement : la caméra (azimut, distance), la transition d'ouverture, la
 * langue, la liste filtrée. La caméra est un état transitoire que rien ne décrit comme une
 * observation, et le regard à l'arrivée vient de la scène solaire : un lien qui la figerait
 * décrirait un cadrage qu'aucun autre appareil ne retrouverait (taille d'écran, volet du téléphone).
 *
 * Les autres clés de l'adresse (`date`, `body`, `mode`…) ne sont jamais touchées : elles restent
 * celles du permalien solaire, qui sait les réécrire.
 */

/** La valeur de `view` : le voisinage solaire en 3D. */
export const STELLAR_VIEW_VALUE = 'neighbourhood';

/** Les clés que ce module possède (et qu'il est seul à effacer). */
export const STELLAR_KEYS = [
  'view',
  'star',
  't',
  'visit',
  'step',
  'explore',
  'planet',
  'host',
] as const;

/** La valeur de `view` pour un système choisi dans le CIEL (GAL-UNIVERSE-007). */
export const SYSTEM_VIEW_VALUE = 'system';

/** Longueur maximale d'un identifiant lu dans l'adresse : le plus long du catalogue en a 16. */
const MAX_STAR_LENGTH = 64;

/** Le décalage maximal qu'une adresse peut demander : la fenêtre de la vue (`core/stellarSpace`). */
const MAX_YEARS = 10_000;

/** Le rang d'étape le plus grand qu'une adresse peut demander : une visite n'en a jamais autant. */
const MAX_STEP = 99;

export interface StellarAddress {
  /**
   * L'identifiant demandé tel qu'il est écrit. `undefined` quand l'adresse n'en porte pas ;
   * `null` quand elle en porte un qui n'a pas la FORME d'un identifiant : l'appelant le dit
   * (« étoile inconnue ») au lieu de l'ignorer en silence.
   */
  star?: string | null;
  /** Le déplacement demandé, en années, jamais hors de ±10 000. `undefined` : aucun. */
  years?: number;
  /**
   * La visite demandée telle qu'elle est écrite. `undefined` : l'adresse n'en porte pas ; `null` : elle
   * en porte une qui n'a pas la FORME d'un identifiant (l'appelant le dit, comme pour `star`).
   */
  visit?: string | null;
  /** Le rang de l'étape (0 à 99), ou `undefined` s'il manque ou n'est pas un entier : la visite commence alors à 0. */
  step?: number;
  /** Vrai quand l'adresse demande l'exploration du système de l'étoile choisie (`explore=1`). */
  explore?: boolean;
  /**
   * La planète choisie dans l'exploration, telle qu'elle est écrite ; `null` quand elle n'a pas la FORME
   * d'un identifiant (l'appelant le dit). Lue seulement avec `explore`.
   */
  planet?: string | null;
}

/**
 * L'identifiant d'une étoile : son nom sans accents, en minuscules, les apostrophes retirées, tout
 * le reste réduit à des tirets. « Barnard's Star » donne `barnards-star`, « Gl 54.1 » `gl-54-1`.
 * Les 61 noms du catalogue donnent 61 identifiants distincts (garde de test).
 */
export function starSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Ce que l'adresse demande, ou `null` quand elle ne demande pas la vue. Sans `view=neighbourhood`,
 * `star` et `t` ne signifient rien : ils sont ignorés (un lien ancien ne rouvre pas une vue).
 */
export function parseStellarAddress(search: string): StellarAddress | null {
  const params = new URLSearchParams(search);
  if (params.get('view') !== STELLAR_VIEW_VALUE) return null;
  const address: StellarAddress = {};
  const star = params.get('star');
  if (star !== null) {
    const wanted = star.trim().toLowerCase();
    address.star =
      wanted.length > 0 &&
      wanted.length <= MAX_STAR_LENGTH &&
      SLUG_SHAPE.test(wanted)
        ? wanted
        : null;
  }
  const raw = params.get('t');
  if (raw !== null && raw.trim() !== '') {
    const years = Number(raw);
    if (Number.isFinite(years) && Math.abs(years) <= MAX_YEARS)
      address.years = years;
  }
  const visit = params.get('visit');
  if (visit !== null) {
    const wanted = visit.trim().toLowerCase();
    address.visit =
      wanted.length > 0 &&
      wanted.length <= MAX_STAR_LENGTH &&
      SLUG_SHAPE.test(wanted)
        ? wanted
        : null;
    const step = params.get('step');
    if (step !== null && /^\d{1,2}$/.test(step.trim())) {
      const rank = Number(step);
      if (rank <= MAX_STEP) address.step = rank;
    }
  }
  if (params.get('explore') === '1') {
    address.explore = true;
    const planet = params.get('planet');
    if (planet !== null) {
      const wanted = planet.trim().toLowerCase();
      address.planet =
        wanted.length > 0 &&
        wanted.length <= MAX_STAR_LENGTH &&
        SLUG_SHAPE.test(wanted)
          ? wanted
          : null;
    }
  }
  return address;
}

/**
 * La requête qui décrit l'observation (`address`), ou la requête SANS la vue (`null`). Les autres
 * clés sont conservées dans leur ordre. Un décalage nul n'est pas écrit : c'est l'état d'ouverture.
 * Le décalage est arrondi à l'année : le curseur avance par pas de cent ans.
 */
export function serializeStellarAddress(
  search: string,
  address: {
    star?: string | null;
    years?: number;
    visit?: string | null;
    step?: number;
    explore?: boolean;
    planet?: string | null;
  } | null
): string {
  const params = new URLSearchParams(search);
  for (const key of STELLAR_KEYS) params.delete(key);
  if (address) {
    params.set('view', STELLAR_VIEW_VALUE);
    if (address.star) params.set('star', address.star);
    const years = Math.round(address.years ?? 0);
    if (years !== 0) params.set('t', String(years));
    // `step` n'a de sens qu'avec `visit` : une étape seule n'est jamais écrite.
    if (address.visit) {
      params.set('visit', address.visit);
      params.set('step', String(Math.max(0, Math.round(address.step ?? 0))));
    }
    // L'exploration désigne le système de l'étoile choisie : sans étoile, elle n'est pas écrite.
    if (address.explore && address.star) {
      params.set('explore', '1');
      if (address.planet) params.set('planet', address.planet);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Ce qui identifie le SYSTÈME SOLAIRE d'une adresse, sans la vue ni ce qui y change tout seul : la
 * date (réécrite à chaque synchronisation du permalien solaire) et le cadrage (`az`, `pol`, `dist`,
 * gravés par « Partager »). Deux adresses qui ont la même identité ne diffèrent que par la vue
 * ouverte : un Retour ou un Suivant entre elles est un mouvement de la VUE, pas du Système solaire.
 */
export function solarIdentity(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  for (const key of [...STELLAR_KEYS, 'date', 'az', 'pol', 'dist'])
    params.delete(key);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Le rang du système qui porte l'étoile demandée, ou -1. `names` donne, pour chaque système, les
 * noms de toutes ses étoiles : l'adresse d'une étoile compagne (Toliman) ouvre le système qui la
 * porte, comme le bouton de la fiche.
 */
export function resolveStar(
  slug: string,
  names: ReadonlyArray<readonly string[]>
): number {
  return names.findIndex((system) => system.some((n) => starSlug(n) === slug));
}

/**
 * Le décalage que la vue peut réellement montrer : un multiple du pas du curseur, dans sa fenêtre.
 * Une adresse écrite à la main (`t=137`) tombe sur le pas le plus proche, et le curseur, l'année
 * affichée et le calcul décrivent alors le même instant.
 */
export function snapYears(
  years: number,
  window: { min: number; max: number },
  step: number
): number {
  const snapped = Math.round(years / step) * step;
  return Math.min(window.max, Math.max(window.min, snapped));
}

/**
 * L'ADRESSE D'UN SYSTÈME CHOISI DANS LE CIEL (GAL-UNIVERSE-007) : `?view=system&host=<id>[&planet=<id>]`.
 * `host` est le nom d'hôte de l'archive normalisé par `starSlug` (identifiants distincts sur tout le
 * fichier du ciel : garde de test). Sans `view=system`, rien n'est lu. Comme pour `star`, `null` dit
 * un identifiant MAL FORMÉ, que l'appelant annonce au lieu de l'ignorer.
 */
export interface SystemAddress {
  host: string | null;
  planet?: string | null;
}

const slugOrNull = (raw: string): string | null => {
  const wanted = raw.trim().toLowerCase();
  return wanted.length > 0 &&
    wanted.length <= MAX_STAR_LENGTH &&
    SLUG_SHAPE.test(wanted)
    ? wanted
    : null;
};

export function parseSystemAddress(search: string): SystemAddress | null {
  const params = new URLSearchParams(search);
  if (params.get('view') !== SYSTEM_VIEW_VALUE) return null;
  const host = params.get('host');
  const address: SystemAddress = {
    host: host === null ? null : slugOrNull(host),
  };
  const planet = params.get('planet');
  if (planet !== null) address.planet = slugOrNull(planet);
  return address;
}

/** La requête qui décrit le système (`address`), ou la requête sans lui (`null`) ; les autres clés restent. */
export function serializeSystemAddress(
  search: string,
  address: { host: string; planet?: string | null } | null
): string {
  const params = new URLSearchParams(search);
  for (const key of STELLAR_KEYS) params.delete(key);
  if (address) {
    params.set('view', SYSTEM_VIEW_VALUE);
    params.set('host', address.host);
    if (address.planet) params.set('planet', address.planet);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
