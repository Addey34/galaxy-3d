import { describe, expect, it } from 'vitest';
import { ASSET_ORIGIN, heavyAssetUrl } from './assetOrigin';

describe('origine des gros fichiers', () => {
  it('sans origine posée, suit BASE_URL comme avant', () => {
    expect(heavyAssetUrl('assets/textures/', '', '/')).toBe(
      '/assets/textures/'
    );
    expect(heavyAssetUrl('/assets/models/a.glb', '', '/app/')).toBe(
      '/app/assets/models/a.glb'
    );
  });

  it('avec une origine posée, rend une adresse absolue sur ce serveur', () => {
    const origin = 'https://galaxy-data.adrianguichard.dev';
    expect(heavyAssetUrl('assets/textures/', origin, '/')).toBe(
      'https://galaxy-data.adrianguichard.dev/assets/textures/'
    );
    expect(heavyAssetUrl('/assets/models/a.glb', origin, '/app/')).toBe(
      'https://galaxy-data.adrianguichard.dev/assets/models/a.glb'
    );
  });

  it('est vide par défaut : la CI et les tests ne changent pas de serveur', () => {
    expect(ASSET_ORIGIN).toBe('');
  });
});
