/**
 * LA REPRISE APRÈS ÉCHEC D'UN FICHIER (GAL-A002) : pure, sans horloge ni réseau, testée.
 *
 * Une panne passagère (coupure, 429, 503) ne doit pas condamner un fichier pour la session, et une
 * absence définitive (404) ou un contenu invalide ne doit jamais être redemandé. Le budget de
 * tentatives appartient au FICHIER : il ne se remet pas à zéro quand la caméra bouge, sinon une
 * panne persistante serait réessayée sans fin.
 *
 * Aucun minuteur : l'appelant compare `retryAt` à son horloge à chaque passage (la couche est déjà
 * appelée à l'image), donc rien à annuler à la destruction.
 */

/** Réponse HTTP non réussie ; `retryAfterMs` vient de l'en-tête `Retry-After` quand il est lisible. */
export class HttpStatusError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  constructor(status: number, retryAfterMs: number | null = null) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Échec qu'un nouvel essai ne changera pas (réponse d'un autre type, par exemple). */
export class PermanentFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentFetchError';
  }
}

export const MAX_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_CAP_MS = 60_000;
/**
 * Borne NUMÉRIQUE d'un délai demandé par le serveur (un an), pas une règle de reprise : un délai
 * plus court est respecté tel quel, sans plafond d'une heure ni abandon. Elle ne sert qu'à garder
 * `retryAt` fini et exact (un `Retry-After` de 10^400 secondes donnerait `Infinity`).
 */
export const MAX_SERVER_DELAY_MS = 365 * 24 * 3_600_000;

/** Un délai fini et positif, ramené à la borne numérique ; `null` pour tout le reste. */
function sanitizeDelay(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined || Number.isNaN(ms) || ms < 0)
    return null;
  return Math.min(ms, MAX_SERVER_DELAY_MS);
}

export type FailureKind = 'abort' | 'transient' | 'permanent';

export interface FailureRecord {
  kind: 'transient' | 'permanent';
  /** Échecs essuyés jusqu'ici pour ce fichier, jamais remis à zéro avant un succès. */
  attempts: number;
  /** Instant (horloge de l'appelant) avant lequel on ne redemande pas. */
  retryAt: number;
}

/**
 * Classe une erreur de TRANSPORT (le `fetch` et la lecture du corps). Le décodage et la
 * construction ne passent pas par ici : une `TypeError` levée par un décodeur n'est pas une panne
 * réseau, l'appelant la déclare `permanent` lui-même.
 */
export function classifyTransportFailure(error: unknown): FailureKind {
  if ((error as Error)?.name === 'AbortError') return 'abort';
  if (error instanceof PermanentFetchError) return 'permanent';
  if (error instanceof HttpStatusError) {
    const s = error.status;
    return s === 408 || s === 425 || s === 429 || s >= 500
      ? 'transient'
      : 'permanent';
  }
  // `fetch` rejette par une TypeError quand le réseau est coupé ; une lecture de corps interrompue
  // aussi.
  return 'transient';
}

/**
 * `Retry-After` : secondes entières ou date HTTP ; `null` si absent, négatif ou illisible.
 *
 * DÉPENDANCE : un navigateur ne lit cet en-tête sur une réponse d'une AUTRE origine que si le
 * serveur le liste dans `Access-Control-Expose-Headers`. `services/galaxy-data/Caddyfile` n'y met
 * aujourd'hui que `Content-Range, Content-Length, Accept-Ranges` : pour une tuile du service de
 * données, `headers.get('retry-after')` rend `null` et la reprise retombe sur le retard exponentiel
 * (2 s, 4 s…), plus court que ce que le serveur demande. L'index et les manifestes (même origine)
 * sont lus correctement. Ajouter `Retry-After` à cette liste est un changement de la VM, hors de
 * cette mission.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  nowEpochMs: number
): number | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (text === '') return null;
  if (/^\d+$/.test(text)) return sanitizeDelay(Number(text) * 1000);
  // Un nombre signé ou décimal n'est pas une date HTTP (`Date.parse('-5')` en lirait une).
  if (/^[+-]?[\d.]+$/.test(text)) return null;
  const date = Date.parse(text);
  if (Number.isNaN(date)) return null;
  return sanitizeDelay(Math.max(0, date - nowEpochMs));
}

/** Retard avant le prochain essai : 2 s, 4 s, 8 s… plafonné à 60 s ; un délai serveur plus long l'emporte. */
export function nextRetryDelay(
  attempt: number,
  retryAfterMs: number | null = null
): number {
  const backoff = Math.min(
    BACKOFF_CAP_MS,
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1)
  );
  // Jamais avant ce que le serveur demande, aussi loin que ce soit : `retryAt` est une échéance
  // comparée à l'horloge, pas un minuteur.
  return Math.max(backoff, sanitizeDelay(retryAfterMs) ?? 0);
}

/** Enregistre un échec (`abort` n'en est pas un : l'appelant ne l'enregistre pas). */
export function recordFailure(
  previous: FailureRecord | undefined,
  kind: 'transient' | 'permanent',
  now: number,
  retryAfterMs: number | null = null
): FailureRecord {
  const attempts = (previous?.attempts ?? 0) + 1;
  if (kind === 'permanent' || attempts >= MAX_ATTEMPTS)
    return { kind: 'permanent', attempts, retryAt: Infinity };
  return {
    kind: 'transient',
    attempts,
    retryAt: now + nextRetryDelay(attempts, retryAfterMs),
  };
}

/** Nombre d'échecs gardés au plus ; au-delà, les plus anciens sont oubliés. */
export const MAX_TRACKED_FAILURES = 2048;

/**
 * Inscrit un échec dans un magasin PARTAGÉ (qui survit à la couche qui l'a produit) en le bornant :
 * l'entrée est réinsérée en queue, et les plus anciennes partent au-delà de `MAX_TRACKED_FAILURES`.
 * Oublier un échec très ancien rend seulement ses essais à cette tuile ; la borne est large devant
 * le nombre de tuiles qu'une session demande réellement.
 */
export function rememberFailure(
  store: Map<string, FailureRecord>,
  key: string,
  record: FailureRecord
): void {
  store.delete(key);
  store.set(key, record);
  while (store.size > MAX_TRACKED_FAILURES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Peut-on (re)demander ce fichier maintenant ? */
export function mayRequest(
  record: FailureRecord | undefined,
  now: number
): boolean {
  return !record || (record.kind === 'transient' && now >= record.retryAt);
}

/** Le `Retry-After` d'une erreur HTTP, s'il y en a un. */
export function retryAfterOf(error: unknown): number | null {
  return error instanceof HttpStatusError ? error.retryAfterMs : null;
}
