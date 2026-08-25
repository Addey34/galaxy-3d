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
  if (azimuthDeg === undefined || polarDeg === undefined || distance === undefined)
    return undefined;
  if (distance <= 0) return undefined;
  return { azimuthDeg, polarDeg, distance };
}

export function parsePermalink(
  search: string,
  validBodies: ReadonlySet<string>
): PermalinkState {
  const params = new URLSearchParams(search);
  const modeValue = params.get('mode');
  const bodyValue = params.get('body')?.trim().toLowerCase();

  return {
    mode: modeValue === 'educ' || modeValue === 'explo' ? modeValue : undefined,
    body:
      bodyValue === 'overview' ||
      (bodyValue !== undefined && validBodies.has(bodyValue))
        ? bodyValue
        : undefined,
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
  currentSearch = ''
): string {
  const params = new URLSearchParams(currentSearch);
  for (const key of PERMALINK_KEYS) params.delete(key);

  if (state.mode) params.set('mode', state.mode);
  if (state.body) params.set('body', state.body);
  if (state.date) params.set('date', formatPermalinkDate(state.date));
  if (state.view) {
    params.set('az', String(roundForUrl(state.view.azimuthDeg, 1)));
    params.set('pol', String(roundForUrl(state.view.polarDeg, 1)));
    params.set('dist', String(roundSignificant(state.view.distance, 6)));
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}
