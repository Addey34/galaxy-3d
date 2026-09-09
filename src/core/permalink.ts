/** Etat partageable de l'application, encode dans la query string. */
export type PermalinkMode = 'educ' | 'explo';

export interface PermalinkViewAngles {
  /** Rotation horizontale autour de la cible, en degrés (périodique, toute valeur réelle). */
  azimuthDeg: number;
  /** Rotation verticale autour de la cible, en degrés (bornée par OrbitControls à l'application). */
  polarDeg: number;
  /** Distance caméra → cible, en unités scène (bornée par OrbitControls à l'application). */
  distance: number;
}

export interface PermalinkState {
  mode?: PermalinkMode;
  body?: string;
  date?: Date;
  /**
   * Cadrage caméra exact (azimut/polaire/distance) — optionnel : n'existe que si l'utilisateur
   * a explicitement partagé une vue précise (bouton Partager). Sans lui, l'ouverture d'un
   * permalien retombe sur le cadrage par défaut du corps sélectionné.
   */
  view?: PermalinkViewAngles;
}

const PERMALINK_KEYS = ['mode', 'body', 'date', 'az', 'pol', 'dist'] as const;

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp);
}

function parseFiniteNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseView(params: URLSearchParams): PermalinkViewAngles | undefined {
  const azimuthDeg = parseFiniteNumber(params.get('az'));
  const polarDeg = parseFiniteNumber(params.get('pol'));
  const distance = parseFiniteNumber(params.get('dist'));
  // Les trois valeurs doivent être présentes ensemble : un sous-ensemble partiel ne
  // permettrait pas de reconstruire un cadrage cohérent.
  if (
    azimuthDeg === undefined ||
    polarDeg === undefined ||
    distance === undefined
  )
    return undefined;
  if (distance <= 0) return undefined;
  return { azimuthDeg, polarDeg, distance };
}

/**
 * Corps nommé par le CHEMIN, s'il en nomme un — `/jupiter` → `jupiter`.
 *
 * Les pages d'atterrissage par corps sont de vrais fichiers statiques (`dist/jupiter/index.html`),
 * pas des routes : Firebase les sert avant la réécriture SPA. Elles ne peuvent donc pas porter
 * `?body=` dans leur URL, et un script en ligne pour le faire est exclu — la CSP du projet est
 * `script-src 'self'` sans `unsafe-inline`. Le chemin devient donc une source d'état à part
 * entière, lue ici plutôt que dans un cas particulier côté interface.
 *
 * Un seul segment, insensible à la casse, et validé contre le catalogue : tout le reste
 * (`/privacy.html`, `/`, une faute de frappe) ne nomme aucun corps et ne change rien.
 */
export function bodyFromPathname(
  pathname: string,
  validBodies: ReadonlySet<string>
): string | undefined {
  const segments = pathname.split('/').filter((part) => part.length > 0);
  if (segments.length !== 1) return undefined;
  const candidate = segments[0]?.trim().toLowerCase();
  return candidate !== undefined && validBodies.has(candidate)
    ? candidate
    : undefined;
}

export function parsePermalink(
  search: string,
  validBodies: ReadonlySet<string>,
  pathname = ''
): PermalinkState {
  const params = new URLSearchParams(search);
  const modeValue = params.get('mode');
  const bodyValue = params.get('body')?.trim().toLowerCase();
  // La QUERY primait déjà et continue de primer : depuis `/jupiter`, naviguer vers Titan écrit
  // `?body=titan` et c'est bien Titan qu'un lien partagé doit rouvrir. Le chemin n'est qu'un
  // défaut, pour la page d'atterrissage elle-même.
  const pathBody = bodyFromPathname(pathname, validBodies);

  return {
    mode: modeValue === 'educ' || modeValue === 'explo' ? modeValue : undefined,
    body:
      bodyValue === 'overview' ||
      (bodyValue !== undefined && validBodies.has(bodyValue))
        ? bodyValue
        : pathBody,
    date: parseDate(params.get('date')),
    view: parseView(params),
  };
}

export function formatPermalinkDate(date: Date): string {
  return new Date(Math.floor(date.getTime() / 1000) * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
}

/** Arrondit à une précision compacte pour l'URL sans perte perceptible sur le cadrage. */
function roundForUrl(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Arrondit à N CHIFFRES SIGNIFICATIFS plutôt qu'à N décimales fixes : la distance caméra en
 * explo peut être minuscule (quelques dix-millièmes d'unité scène, cf. `exploMinDistance`) —
 * un arrondi à décimales fixes l'aurait tronquée à ~0 et fait retomber le cadrage restauré sur
 * la borne minimale (constaté visuellement : la caméra rouvrait bien plus proche que partagée).
 */
function roundSignificant(value: number, digits: number): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  return Number(value.toPrecision(digits));
}

export function serializePermalink(
  state: PermalinkState,
  currentSearch = '',
  pathname = ''
): string {
  const params = new URLSearchParams(currentSearch);
  for (const key of PERMALINK_KEYS) params.delete(key);

  if (state.mode) params.set('mode', state.mode);
  // `?body=` est REDONDANT quand le chemin nomme déjà ce corps : sans cette omission, ouvrir
  // `/jupiter` réécrivait aussitôt l'URL en `/jupiter?body=jupiter` — deux URL pour un même
  // contenu (ce que le canonique est censé éviter) et une adresse qui a l'air cassée.
  if (
    state.body &&
    state.body !== bodyFromPathname(pathname, new Set([state.body]))
  )
    params.set('body', state.body);
  if (state.date) params.set('date', formatPermalinkDate(state.date));
  if (state.view) {
    params.set('az', String(roundForUrl(state.view.azimuthDeg, 1)));
    params.set('pol', String(roundForUrl(state.view.polarDeg, 1)));
    params.set('dist', String(roundSignificant(state.view.distance, 6)));
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}
