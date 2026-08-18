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
  /** Fabrique de texture depuis un blob (injectable pour les tests hors DOM). */
  makeTexture?: (blob: Blob) => Promise<THREE.Texture>;
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
  return texture;
}

/**
 * Charge une tuile en mesurant sa taille : rejette `EmptyTileError` si sous le seuil (→ le
 * socle passe au candidat de fallback suivant), sinon renvoie la texture. Rejette aussi sur
 * échec réseau/HTTP (comme le chargement direct).
 */
export async function fetchTileWithContentCheck(
  url: string,
  options: FetchTileOptions = {}
): Promise<THREE.Texture> {
  const minBytes = options.minBytes ?? DEFAULT_MIN_TILE_BYTES;
  const doFetch = options.fetchImpl ?? fetch;
  const makeTexture = options.makeTexture ?? defaultMakeTexture;

  const res = await doFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} : ${url}`);
  const blob = await res.blob();
  if (isLikelyEmptyBySize(blob.size, minBytes)) {
    throw new EmptyTileError(url, blob.size, minBytes);
  }
  return makeTexture(blob);
}
