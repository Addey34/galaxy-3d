import { describe, expect, it } from 'vitest';
import { resolveTextureBasePath } from './texturePaths';

describe('resolveTextureBasePath', () => {
  it('uses the local Vite asset path by default', () => {
    expect(resolveTextureBasePath(undefined, '/galaxy/')).toBe(
      '/galaxy/assets/textures/'
    );
  });

  it('normalizes an HTTPS object-storage base URL', () => {
    expect(
      resolveTextureBasePath(
        'https://storage.googleapis.com/galaxy-assets/textures///',
        '/'
      )
    ).toBe('https://storage.googleapis.com/galaxy-assets/textures/');
  });

  it('rejects insecure or relative external URLs', () => {
    expect(() => resolveTextureBasePath('http://cdn.example.test/assets', '/'))
      .toThrow('must use HTTPS');
    expect(() => resolveTextureBasePath('/assets/textures', '/'))
      .toThrow('absolute HTTPS URL');
  });
});
