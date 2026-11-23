/**
 * Charge l'image de nuages du jour ET, quand c'est une image MODIS, la complète avec l'autre
 * instrument MODIS du même jour là où elle n'a aucune donnée (GAL-CLOUD-VISUAL-001, voir
 * `core/cloudComposite` pour le défaut mesuré et la règle de comblement).
 *
 * Morceau chargé à la demande par `ui/realtimeClouds` : le démarrage ne le porte pas. Il respecte le
 * contrat du socle (`DatedTextureLayerConfig.loadTexture`) : même signal d'annulation, même rejet
 * `EmptyTileError` pour une tuile vide (la chaîne passe alors au candidat suivant).
 *
 * Ce que le comblement ne fait JAMAIS, parce que le moteur dit « un vide honnête plutôt qu'une
 * invention » : inventer de la donnée. Si l'autre instrument est absent, vide, plus petit ou plus
 * grand, illisible, ou si le navigateur n'a pas `OffscreenCanvas`, l'image est servie SEULE, comme
 * avant. Un échec du complément n'est donc jamais un échec de la couche.
 */
import * as THREE from 'three';
import {
  compositeObserved,
  modisLabelOf,
  modisSiblingUrl,
  type CompositeOptions,
} from '@/core/cloudComposite';
import { fetchImageBlob } from '@/core/tileContent';
import { hasDebugFlag } from '@/utils/debugFlags';
import Logger from '@/utils/Logger';

const DEBUG = hasDebugFlag('debug-clouds');

export interface ComplementOptions {
  /** Seuil d'octets sous lequel une tuile est vide (le même que celui de la couche). */
  minTileBytes: number;
  composite: CompositeOptions;
}

/** Ce que le comblement a fait pour une image, lu par le badge de traçabilité. */
export interface ComplementInfo {
  /** L'instrument qui a comblé (« MODIS Aqua »). */
  complementLabel: string;
  /** Pixels sans donnée dans l'image principale. */
  primaryMissing: number;
  /** Ceux que le complément a observés et remplacés. */
  filled: number;
  /** Ceux que personne n'a observés (ils restent sans donnée). */
  stillMissing: number;
  /** Durée du comblement, ms. */
  ms: number;
}

const done = new Map<string, ComplementInfo>();

/** Ce que le comblement a fait pour l'image chargée à cette adresse, s'il a eu lieu. */
export function complementInfoFor(url: string): ComplementInfo | undefined {
  return done.get(url);
}

function fetchBlob(
  url: string,
  minBytes: number,
  signal?: AbortSignal
): Promise<Blob> {
  return fetchImageBlob(url, { minBytes, signal });
}

/** La texture d'une image déjà décodée (même réglages que `core/tileContent`). */
function textureOf(bitmap: ImageBitmap): THREE.Texture {
  const texture = new THREE.Texture(bitmap);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  // `Texture.dispose()` ne libère pas l'ImageBitmap natif : on le ferme avec la texture.
  const close = (): void => {
    bitmap.close();
    texture.removeEventListener('dispose', close);
  };
  texture.addEventListener('dispose', close);
  return texture;
}

type Surface = OffscreenCanvas | HTMLCanvasElement;
type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * Une surface de dessin : `OffscreenCanvas` quand le navigateur l'a, sinon un `<canvas>` ordinaire.
 * Mesuré sur le WebKit émulé de l'iPhone 15 : `OffscreenCanvas` n'y existe pas (c'est aussi le cas
 * des iPhone d'avant iOS 16.4), alors que `<canvas>` et `createImageBitmap(canvas)` y marchent.
 */
function makeSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined')
    return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function pixelsOf(bitmap: ImageBitmap): {
  canvas: Surface;
  ctx: Context;
  rgba: Uint8ClampedArray;
} | null {
  const canvas = makeSurface(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  return {
    canvas,
    ctx,
    rgba: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
  };
}

export async function loadWithComplement(
  url: string,
  signal: AbortSignal | undefined,
  options: ComplementOptions
): Promise<THREE.Texture> {
  // Chaque chargement repart de zéro : un comblement d'un chargement précédent de la même adresse ne
  // doit jamais étiqueter une image chargée seule ensuite (provenance périmée).
  done.delete(url);
  // Les deux images se téléchargent EN PARALLÈLE : le complément n'ajoute pas sa latence à celle de
  // l'image. Son échec est avalé ici (jamais une promesse rejetée sans écouteur) et relu plus bas.
  const siblingUrl = modisSiblingUrl(url);
  const siblingBlob: Promise<Blob | null> = siblingUrl
    ? fetchBlob(siblingUrl, options.minTileBytes, signal).catch(() => null)
    : Promise.resolve(null);
  const primaryBlob = await fetchBlob(url, options.minTileBytes, signal);
  // `flipY` à la décompression, comme `core/tileContent` : l'orientation ne change pas avec le comblement.
  const primary = await createImageBitmap(primaryBlob, {
    imageOrientation: 'flipY',
  });
  // Une annulation est une annulation : on ne la transforme pas en « image seule ».
  if (signal?.aborted) {
    primary.close();
    throw new DOMException('Aborted', 'AbortError');
  }
  // Autrement le complément est absent ou vide ce jour-là : l'image est servie seule.
  const other = await siblingBlob;
  const complement: ImageBitmap | null = other
    ? await createImageBitmap(other, { imageOrientation: 'flipY' }).catch(
        () => null
      )
    : null;
  if (
    !complement ||
    complement.width !== primary.width ||
    complement.height !== primary.height
  ) {
    complement?.close();
    return textureOf(primary);
  }

  try {
    const started = performance.now();
    const base = pixelsOf(primary);
    const second = pixelsOf(complement);
    if (!base || !second) return textureOf(primary);
    const result = compositeObserved(
      base.rgba,
      second.rgba,
      primary.width,
      primary.height,
      options.composite
    );
    // Rien à combler : on garde l'image décodée, sans la recopier.
    if (result.filled === 0) return textureOf(primary);
    base.ctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(result.rgba),
        primary.width,
        primary.height
      ),
      0,
      0
    );
    const merged = await createImageBitmap(base.canvas);
    primary.close();
    const info: ComplementInfo = {
      complementLabel: modisLabelOf(siblingUrl ?? '') ?? 'MODIS',
      primaryMissing: result.primaryMissing,
      filled: result.filled,
      stillMissing: result.stillMissing,
      ms: Math.round(performance.now() - started),
    };
    done.set(url, info);
    if (DEBUG) console.info('[cloud-debug] complement', JSON.stringify(info));
    return textureOf(merged);
  } catch (error) {
    Logger.warn('[cloudComplement] comblement abandonné, image seule', error);
    return textureOf(primary);
  } finally {
    complement.close();
  }
}
