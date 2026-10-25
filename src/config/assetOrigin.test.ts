import { describe, expect, it } from 'vitest';
import {
  ASSET_ORIGIN,
  STATIC_ORIGIN,
  heavyAssetUrl,
  isTrustedAssetOrigin,
  originFor,
} from './assetOrigin';

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

  it('les éphémérides vont à l’origine qui sert les Range, le reste à l’origine statique', () => {
    const ranged = 'https://vm.example';
    const whole = 'https://static.example';
    expect(originFor('assets/ephemerides/manifest.json', ranged, whole)).toBe(
      ranged
    );
    expect(originFor('/assets/ephemerides/a.bin', ranged, whole)).toBe(ranged);
    expect(originFor('assets/textures/earth/a.jpg', ranged, whole)).toBe(whole);
    expect(originFor('assets/models/a.glb', ranged, whole)).toBe(whole);
    expect(originFor('assets/ephemerides-x/a', ranged, whole)).toBe(whole);
  });

  it('admet pour le manifeste le site et l’origine posée, rien d’autre', () => {
    const page = 'https://galaxy.adrianguichard.dev';
    const vm = 'https://galaxy-data.adrianguichard.dev';
    expect(isTrustedAssetOrigin(page, page, vm)).toBe(true);
    expect(isTrustedAssetOrigin(vm, page, vm)).toBe(true);
    expect(isTrustedAssetOrigin('https://evil.example', page, vm)).toBe(false);
    expect(isTrustedAssetOrigin(vm, page, '')).toBe(false);
  });

  it('est vide par défaut : la CI et les tests ne changent pas de serveur', () => {
    expect(ASSET_ORIGIN).toBe('');
    expect(STATIC_ORIGIN).toBe('');
  });
});
