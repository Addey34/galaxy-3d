import { allBodies } from './catalog';
import type {
  CelestialBodyConfig,
  CelestialConfig,
  TextureQuality,
  TextureResolutions,
} from '@/types';

/** Qualités acceptées par le convention de nommage des assets. */
export const TEXTURE_QUALITIES: readonly TextureQuality[] = [
  '8k',
  '4k',
  '2k',
  '1k',
];

const TEXTURE_QUALITY_SET = new Set<string>(TEXTURE_QUALITIES);
const SAFE_TEXTURE_PATH = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/;

export function isSafeTexturePath(path: string): boolean {
  return SAFE_TEXTURE_PATH.test(path);
}

export function assertSafeTexturePath(
  path: string,
  context = 'texture path'
): void {
  if (!isSafeTexturePath(path)) {
    throw new Error(
      `Unsafe ${context}: expected a relative asset path, received "${path}"`
    );
  }
}

export function isSafeTextureQuality(
  quality: string
): quality is TextureQuality {
  return TEXTURE_QUALITY_SET.has(quality);
}

export function assertSafeTextureQuality(
  quality: string,
  context = 'texture quality'
): void {
  if (!isSafeTextureQuality(quality)) {
    throw new Error(`Unsafe ${context}: unsupported resolution "${quality}"`);
  }
}

function validateQualityChain(
  errors: string[],
  context: string,
  resolutions: unknown
): void {
  if (!Array.isArray(resolutions) || resolutions.length === 0) {
    errors.push(`${context} must declare at least one texture resolution`);
    return;
  }

  const values = resolutions as unknown[];
  for (const quality of values) {
    if (typeof quality !== 'string' || !TEXTURE_QUALITY_SET.has(quality)) {
      errors.push(
        `${context} contains unsupported resolution "${String(quality)}"`
      );
    }
  }

  if (new Set(values).size !== values.length) {
    errors.push(`${context} contains duplicate resolutions`);
  }

  const order = values.map((quality) =>
    TEXTURE_QUALITIES.indexOf(quality as TextureQuality)
  );
  if (
    order.some((index) => index < 0) ||
    order.some((v, i) => i > 0 && v < order[i - 1])
  ) {
    errors.push(
      `${context} resolutions must be ordered from highest to lowest`
    );
  }
}

function validateBody(
  errors: string[],
  name: string,
  body: CelestialBodyConfig
): void {
  const textureEntries = Object.entries(body.textures);
  const resolutionEntries = Object.entries(body.textureResolutions);
  const resolutionByLayer = body.textureResolutions as TextureResolutions;
  const surface = body.textures.surface;
  const hasSurface = typeof surface === 'string' && surface.length > 0;

  if (
    body.kind !== 'skybox' &&
    !hasSurface &&
    body.fallbackColor === undefined
  ) {
    errors.push(`${name} must declare textures.surface or fallbackColor`);
  }

  if (
    body.fallbackColor !== undefined &&
    (!Number.isInteger(body.fallbackColor) ||
      body.fallbackColor < 0 ||
      body.fallbackColor > 0xffffff)
  ) {
    errors.push(
      `${name} fallbackColor must be an integer between 0x000000 and 0xffffff`
    );
  }

  for (const [layer, rawPath] of textureEntries) {
    if (typeof rawPath !== 'string' || rawPath.length === 0) {
      errors.push(`${name}:${layer} must declare a non-empty texture path`);
      continue;
    }
    if (!isSafeTexturePath(rawPath)) {
      errors.push(`${name}:${layer} has an unsafe texture path "${rawPath}"`);
    }
    validateQualityChain(
      errors,
      `${name}:${layer}`,
      resolutionByLayer[layer as keyof TextureResolutions]
    );
  }

  for (const [layer, resolutions] of resolutionEntries) {
    const texturePath = body.textures[layer as keyof typeof body.textures];
    if (!texturePath && Array.isArray(resolutions) && resolutions.length > 0) {
      errors.push(
        `${name}:${layer} declares resolutions without a texture path`
      );
    }
  }

  if (body.ring) {
    if (!isSafeTexturePath(body.ring.textures)) {
      errors.push(
        `${name}:ring has an unsafe texture path "${body.ring.textures}"`
      );
    }
    validateQualityChain(errors, `${name}:ring`, body.ring.textureResolutions);
  }
}

/**
 * Vérifie les invariants qui empêchent un corps ajouté au catalogue d'être rendu sans asset
 * déclaré, avec des LOD incomplets ou via un chemin pouvant sortir du dossier textures.
 * L'erreur agrège toutes les entrées fautives pour rendre une nouvelle contribution facile
 * à corriger en une passe.
 */
export function assertValidCelestialCatalog(config: CelestialConfig): void {
  const errors: string[] = [];
  for (const { name, config: body } of allBodies(config)) {
    validateBody(errors, name, body);
  }

  if (errors.length > 0) {
    throw new Error(`Catalogue invalide :\n- ${errors.join('\n- ')}`);
  }
}
