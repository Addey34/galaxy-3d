import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { chooseTextureQuality } from './TextureSystem';

const levels = [
  { distance: 10, quality: '8k' },
  { distance: 20, quality: '4k' },
  { distance: 40, quality: '2k' },
  { distance: 80, quality: '1k' },
];

describe('texture quality selection', () => {
  it('selects detail from distance measured in body radii', () => {
    const available = ['8k', '4k', '2k', '1k'];
    expect(chooseTextureQuality(levels, available, 7)).toBe('8k');
    expect(chooseTextureQuality(levels, available, 18)).toBe('4k');
    expect(chooseTextureQuality(levels, available, 35)).toBe('2k');
    expect(chooseTextureQuality(levels, available, 200)).toBe('1k');
  });

  it('falls through unavailable resolutions without exceeding the device cap', () => {
    expect(chooseTextureQuality(levels, ['4k', '2k', '1k'], 7)).toBe('4k');
    expect(chooseTextureQuality(levels, ['2k', '1k'], 18)).toBe('2k');
  });

  it('respects the WebGL maximum texture size on constrained mobile GPUs', () => {
    expect(
      chooseTextureQuality(levels, ['8k', '4k', '2k', '1k'], 7, 2048)
    ).toBe('2k');
    expect(chooseTextureQuality(levels, ['4k', '2k', '1k'], 7, 1024)).toBe(
      '1k'
    );
  });
});

describe('espace de couleur au téléversement (lot 54)', () => {
  it('une carte de DONNÉES arrive au GPU sans conversion sRGB, une couleur en sRGB', async () => {
    const { TextureSystem } = await import('./TextureSystem');
    const { TEXTURE_SETTINGS, APP_SETTINGS } = await import('@/config/engine');
    const { CELESTIAL_CONFIG } = await import('@/config/bodies');
    const system = TextureSystem.getInstance({
      basePath: TEXTURE_SETTINGS.basePath,
      defaultSettings: TEXTURE_SETTINGS.defaultSettings,
      bodies: CELESTIAL_CONFIG.bodies,
      performance: APP_SETTINGS.performance,
    });
    // Le chargeur et le moteur de rendu sont simulés : ce qui compte est l'espace de couleur
    // de la texture AU MOMENT où elle est téléversée, qui fixe son format de stockage.
    (
      system as unknown as {
        textureLoader: {
          load: (p: string, ok: (t: THREE.Texture) => void) => void;
        };
      }
    ).textureLoader.load = (_path, ok) => ok(new THREE.Texture());
    const uploaded: Record<string, string> = {};
    let current = '';
    system.setRenderer({
      initTexture: (t: THREE.Texture) => {
        uploaded[current] = t.colorSpace;
      },
      capabilities: { maxTextureSize: 16384 },
    } as unknown as THREE.WebGLRenderer);
    for (const key of ['normalMap', 'spec', 'displacement', 'surface']) {
      current = key;
      await system.getLODTexture('earth', key, 5);
    }
    expect(uploaded).toEqual({
      normalMap: THREE.NoColorSpace,
      spec: THREE.NoColorSpace,
      displacement: THREE.NoColorSpace,
      surface: THREE.SRGBColorSpace,
    });
    system.dispose();
  });

  it('un espace de couleur changé APRÈS coup redemande un téléversement', async () => {
    const { configureTextureColorSpace } =
      await import('@/components/celestial/celestialTextures');
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    const version = texture.version;
    configureTextureColorSpace('normalMap', texture);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.version).toBeGreaterThan(version);
    const again = texture.version;
    configureTextureColorSpace('normalMap', texture);
    expect(texture.version).toBe(again);
  });
});
