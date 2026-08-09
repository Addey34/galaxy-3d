import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allBodies } from './catalog';
import { CELESTIAL_CONFIG } from './bodies';
import type { TextureQuality, TextureResolutions } from '@/types';

const TEXTURE_ROOT = resolve(process.cwd(), 'public/assets/textures');

function jpegFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...jpegFiles(path));
    else if (entry.isFile() && /\.jpe?g$/i.test(entry.name)) files.push(path);
  }
  return files;
}

function assetPath(basePath: string, quality: TextureQuality): string {
  return join(TEXTURE_ROOT, `${basePath}_${quality}.jpg`);
}

describe('catalogue texture manifest', () => {
  it('references every local JPEG and every declared LOD', () => {
    const configured = new Set<string>();

    for (const { config } of allBodies(CELESTIAL_CONFIG)) {
      for (const [layer, rawBasePath] of Object.entries(config.textures)) {
        const resolutions =
          config.textureResolutions[layer as keyof TextureResolutions];
        if (!rawBasePath || !resolutions) continue;
        for (const quality of resolutions) {
          const path = assetPath(rawBasePath, quality);
          configured.add(resolve(path));
          expect(existsSync(path), `${layer}:${quality} -> ${path}`).toBe(true);
        }
      }

      if (config.ring) {
        for (const quality of config.ring.textureResolutions) {
          const path = assetPath(config.ring.textures, quality);
          configured.add(resolve(path));
          expect(existsSync(path), `ring:${quality} -> ${path}`).toBe(true);
        }
      }
    }

    const orphans = jpegFiles(TEXTURE_ROOT).filter(
      (path) => !configured.has(resolve(path))
    );
    expect(orphans, 'every JPEG must be referenced by the catalogue').toEqual(
      []
    );
  });
});
