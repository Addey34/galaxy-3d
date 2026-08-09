import { describe, expect, it } from 'vitest';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import {
  assertSafeTexturePath,
  assertValidCelestialCatalog,
  isSafeTexturePath,
} from './catalogValidation';

const body = (
  overrides: Partial<CelestialBodyConfig> = {}
): CelestialBodyConfig => ({
  kind: 'asteroid',
  radius: 0.1,
  rotationSpeed: 0,
  orbitalColor: 0xb3956c,
  textureResolutions: {},
  textures: {},
  ...overrides,
});

const catalog = (asteroid: CelestialBodyConfig): CelestialConfig => ({
  bodies: { testAsteroid: asteroid },
});

describe('catalog texture validation', () => {
  it('accepts an untextured small body only with an explicit fallback', () => {
    expect(() =>
      assertValidCelestialCatalog(catalog(body({ fallbackColor: 0x996633 })))
    ).not.toThrow();
  });

  it('rejects a rendered body with neither texture nor fallback', () => {
    expect(() => assertValidCelestialCatalog(catalog(body()))).toThrow(
      /textures\.surface or fallbackColor/
    );
  });

  it('rejects a texture without matching LODs', () => {
    expect(() =>
      assertValidCelestialCatalog(
        catalog(body({ textures: { surface: 'test/testSurface' } }))
      )
    ).toThrow(/must declare at least one texture resolution/);
  });

  it('rejects traversal and URL syntax in texture paths', () => {
    expect(isSafeTexturePath('asteroid/asteroidSurface')).toBe(true);
    expect(isSafeTexturePath('../outside')).toBe(false);
    expect(isSafeTexturePath('/absolute/path')).toBe(false);
    expect(isSafeTexturePath('asteroid/texture.jpg?remote=1')).toBe(false);
    expect(() => assertSafeTexturePath('../outside')).toThrow(/Unsafe/);
  });

  it('rejects resolutions that are not backed by a texture path', () => {
    expect(() =>
      assertValidCelestialCatalog(
        catalog(body({ textureResolutions: { surface: ['2k'] } }))
      )
    ).toThrow(/declares resolutions without a texture path/);
  });

  it('rejects malformed LOD order and duplicate resolutions', () => {
    expect(() =>
      assertValidCelestialCatalog(
        catalog(
          body({
            textures: { surface: 'test/testSurface' },
            textureResolutions: { surface: ['2k', '4k', '2k'] },
          })
        )
      )
    ).toThrow(/duplicate resolutions/);
  });
});
