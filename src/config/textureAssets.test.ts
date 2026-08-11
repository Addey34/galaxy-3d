import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allBodies, ringTexturePath } from './catalog';
import { CELESTIAL_CONFIG } from './bodies';
import type { TextureQuality, TextureResolutions } from '@/types';
import sourceManifest from '../../scripts/texture-sources.json';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEXTURE_ROOT = join(PROJECT_ROOT, 'public/assets/textures');
const QUALITY_ORDER: readonly TextureQuality[] = ['8k', '4k', '2k', '1k'];

function texturePath(basePath: string, quality: TextureQuality): string {
  return join(TEXTURE_ROOT, `${basePath}_${quality}.jpg`);
}

function assertQualityChain(
  bodyName: string,
  layer: string,
  basePath: string,
  resolutions: readonly TextureQuality[]
): void {
  expect(resolutions.length, `${bodyName}:${layer} has no LOD`).toBeGreaterThan(
    0
  );
  expect([...resolutions], `${bodyName}:${layer} LOD order`).toEqual(
    [...resolutions].sort(
      (a, b) => QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b)
    )
  );

  for (const quality of resolutions) {
    const path = texturePath(basePath, quality);
    expect(existsSync(path), `${bodyName}:${layer}:${quality} -> ${path}`).toBe(
      true
    );
  }
}

const REVIEW_KEYS = new Set(
  sourceManifest.reviews.map((review) => `${review.body}/${review.layer}`)
);
const PROCESSABLE_REVIEWS = sourceManifest.reviews.filter(
  (review) => review.processing !== undefined
);

describe('catalogue texture integrity', () => {
  it('has a surface or an explicit fallback for every rendered body', () => {
    for (const { name, config } of allBodies(CELESTIAL_CONFIG)) {
      expect(
        Boolean(config.textures?.surface) || config.fallbackColor !== undefined,
        `${name} must declare a surface texture or fallbackColor`
      ).toBe(true);
    }
  });

  it('has a reviewed source record for every configured layer', () => {
    for (const { name, config } of allBodies(CELESTIAL_CONFIG)) {
      for (const layer of Object.keys(config.textures ?? {})) {
        expect(REVIEW_KEYS.has(`${name}/${layer}`), `${name}:${layer}`).toBe(
          true
        );
      }
      if (config.ring) expect(REVIEW_KEYS.has(`${name}/ring`)).toBe(true);
    }
  });

  it('contains every configured texture LOD on disk', () => {
    for (const { name, config } of allBodies(CELESTIAL_CONFIG)) {
      for (const [layer, rawBasePath] of Object.entries(
        config.textures ?? {}
      )) {
        if (!rawBasePath) continue;
        const basePath = rawBasePath as string;
        const resolutions =
          config.textureResolutions[layer as keyof TextureResolutions];
        expect(
          resolutions,
          `${name}:${layer} has no resolution declaration`
        ).toBeDefined();
        assertQualityChain(name, layer, basePath, resolutions ?? []);
      }

      const ring = config.ring;
      if (ring) {
        assertQualityChain(
          name,
          'ring',
          ring.textures ?? ringTexturePath(name),
          ring.textureResolutions
        );
      }
    }
  });

  it('has complete provenance for every remotely processable source', () => {
    for (const review of PROCESSABLE_REVIEWS) {
      expect(
        review.downloadUrl,
        `${review.body}:${review.layer} downloadUrl`
      ).toMatch(/^https:\/\//);
      expect(
        review.sourcePage,
        `${review.body}:${review.layer} sourcePage`
      ).toMatch(/^https:\/\//);
      expect(
        review.sourceResolution,
        `${review.body}:${review.layer} sourceResolution`
      ).toBeTruthy();
      expect(
        review.projection,
        `${review.body}:${review.layer} projection`
      ).toBeTruthy();
    }
  });
});
