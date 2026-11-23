/**
 * Chargement d'une tuile d'imagerie distante (GIBS) AVEC détection de tuile VIDE. Les
 * endpoints WMS renvoient un PNG/JPEG 200 OK même quand aucune donnée n'existe pour la
 * date demandée : une image quasi transparente/blanche, très légère. Mesuré sur GIBS : une
 * tuile vide pèse 2–8 Ko, une tuile réelle 80–180 Ko. On s'appuie donc sur la TAILLE en
 * octets comme signal principal — bon marché, fiable, sans lecture de pixels (qui poserait
 * des soucis de canvas « tainted » avec le crossOrigin).
 *
 * Ce module remplace le chargement direct `THREE.TextureLoader` : on passe par
 * `fetch → blob` pour pouvoir mesurer la taille avant de fabriquer la texture. La partie
 * pure (`isLikelyEmptyBySize`) est unit-testable ; le fetch et la fabrique de texture sont
 * injectables pour tester hors réseau/DOM.
 */
import * as THREE from 'three';

/** Seuil d'octets par défaut sous lequel une tuile est considérée VIDE (pas de donnée). */
export const DEFAULT_MIN_TILE_BYTES = 20_000;

/** Levée quand la tuile chargée est jugée vide (taille sous le seuil). Chaînable en fallback. */
export class EmptyTileError extends Error {
  constructor(
    readonly url: string,
    readonly bytes: number,
    readonly minBytes: number
  ) {
    super(`Tuile vide (${bytes} < ${minBytes} octets) : ${url}`);
    this.name = 'EmptyTileError';
  }
}

/**
 * Décide si une tuile est probablement VIDE d'après sa taille. Pur, testable. `minBytes <= 0`
 * désactive la détection (toute tuile est acceptée).
 */
export function isLikelyEmptyBySize(bytes: number, minBytes: number): boolean {
  if (minBytes <= 0) return false;
  return bytes < minBytes;
}

export interface FetchTileOptions {
  /** Seuil de vide (octets). Défaut DEFAULT_MIN_TILE_BYTES. `<= 0` désactive la détection. */
  minBytes?: number;
  /** `fetch` injectable (tests). Défaut : le fetch global. */
  fetchImpl?: typeof fetch;
  /** Signal d'annulation de la requête réseau. */
  signal?: AbortSignal;
  /** Fabrique de texture depuis un blob (injectable pour les tests hors DOM). */
  makeTexture?: (blob: Blob) => Promise<THREE.Texture>;
  /** Pause avant le 2e essai face à un message d'erreur du service (ms ; 0 en test). */
  retryMs?: number;
}

/**
 * Fabrique de texture par défaut : décode le blob en `ImageBitmap` et l'enveloppe dans une
 * `THREE.Texture` (colorSpace sRGB, needsUpdate). Utilise `createImageBitmap` (dispo dans les
 * navigateurs modernes) — pas de balise `<img>`, donc pas d'object URL à révoquer.
 */
async function defaultMakeTexture(blob: Blob): Promise<THREE.Texture> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
  const texture = new THREE.Texture(bitmap);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  // THREE.Texture.dispose() libère les ressources WebGL, mais pas l'ImageBitmap natif
  // utilisé comme source. Le listener `dispose` ferme donc explicitement le bitmap quand les
  // couches météo remplacent leur texture, sans laisser croître la mémoire native.
  const closeBitmap = (): void => {
    bitmap.close();
    texture.removeEventListener('dispose', closeBitmap);
  };
  texture.addEventListener('dispose', closeBitmap);

  return texture;
}

/**
 * Levée quand le service répond 200 avec autre chose qu'une image (message d'erreur HTML). Mesuré
 * sur GIBS le 2026-11-23 : `getInteger(): Symbol definition error` (167 octets, `text/html`) revient
 * AU HASARD sur n'importe quelle couche, environ deux requêtes sur trois à cet instant, et la requête
 * identique rejouée réussit. Ce n'est PAS une tuile vide (qui, elle, est une vraie image légère).
 */
export class ServiceMessageError extends Error {
  constructor(
    readonly url: string,
    readonly contentType: string
  ) {
    super(`Réponse sans image (${contentType}) : ${url}`);
    this.name = 'ServiceMessageError';
  }
}

/** Essais au total (le premier compris) face à un message d'erreur du service. */
export const SERVICE_MESSAGE_ATTEMPTS = 4;
/** Pause avant le 2e essai (ms) ; elle double ensuite. */
export const SERVICE_MESSAGE_RETRY_MS = 250;

/** Vrai quand l'en-tête annonce autre chose qu'une image. Absent : on ne conclut rien. */
export function isNonImageContentType(contentType: string | null): boolean {
  return !!contentType && !/^image\//i.test(contentType.trim());
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface FetchImageBlobOptions {
  minBytes?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Essais au total face à un message d'erreur du service (défaut `SERVICE_MESSAGE_ATTEMPTS`). */
  attempts?: number;
  /** Pause avant le 2e essai, doublée ensuite (défaut `SERVICE_MESSAGE_RETRY_MS`, 0 en test). */
  retryMs?: number;
}

/**
 * Télécharge une image distante. Trois issues distinctes, que la chaîne de sources traite autrement :
 * une VRAIE image sous le seuil = tuile vide (`EmptyTileError`, pas de réessai : la donnée n'existe pas) ;
 * un message d'erreur du service (réponse sans image) = réessayé, puis `ServiceMessageError` ; un échec
 * HTTP ou réseau = erreur telle quelle.
 */
export async function fetchImageBlob(
  url: string,
  options: FetchImageBlobOptions = {}
): Promise<Blob> {
  const minBytes = options.minBytes ?? DEFAULT_MIN_TILE_BYTES;
  const doFetch = options.fetchImpl ?? fetch;
  const attempts = Math.max(1, options.attempts ?? SERVICE_MESSAGE_ATTEMPTS);
  const retryMs = options.retryMs ?? SERVICE_MESSAGE_RETRY_MS;
  let lastType = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = options.signal
      ? await doFetch(url, { signal: options.signal })
      : await doFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} : ${url}`);
    const contentType = res.headers?.get?.('content-type') ?? null;
    if (isNonImageContentType(contentType)) {
      lastType = contentType ?? '';
      if (attempt < attempts)
        await pause(retryMs * 2 ** (attempt - 1), options.signal);
      continue;
    }
    const blob = await res.blob();
    if (isLikelyEmptyBySize(blob.size, minBytes))
      throw new EmptyTileError(url, blob.size, minBytes);
    return blob;
  }
  throw new ServiceMessageError(url, lastType);
}

/**
 * Charge une tuile en mesurant sa taille : rejette `EmptyTileError` si sous le seuil (→ le
 * socle passe au candidat de fallback suivant), sinon renvoie la texture. Un message d'erreur du
 * service est réessayé (`fetchImageBlob`) ; un échec réseau/HTTP rejette comme le chargement direct.
 */
export async function fetchTileWithContentCheck(
  url: string,
  options: FetchTileOptions = {}
): Promise<THREE.Texture> {
  const makeTexture = options.makeTexture ?? defaultMakeTexture;
  const blob = await fetchImageBlob(url, {
    minBytes: options.minBytes,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    retryMs: options.retryMs,
  });
  return makeTexture(blob);
}
