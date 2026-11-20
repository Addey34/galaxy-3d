import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  PlanetarySurfaceEngine,
  TileHttpError,
  type SurfaceHost,
  type TileFetcher,
} from './PlanetarySurfaceEngine';
import { WMTS_EQUIRECTANGULAR_2x1 } from '@/core/tilePyramid';
import {
  geographicToLocalDirection,
  localDirectionToGeographic,
} from '@/core/frames';
import type { SurfaceTileset } from '@/config/surfaceTilesets';

/**
 * LES IMAGERIES RÉGIONALES SANS TROU (GAL-IMMERSION-003B).
 *
 * Une mosaïque de NASA Trek est un rectangle de données qui peut avoir des trous à l'INTÉRIEUR :
 * mesuré sur le Mars d'Olympus Mons, 3 tuiles sur 64 sans pixel opaque, dont deux transparentes
 * (réponse 200, 206 octets). Servie telle quelle, une tuile transparente est peinte en NOIR, ce
 * qu'on lit comme une ombre : une surface inventée. Le moteur doit montrer l'image de la base à la
 * place, et ne pas redemander la tuile à la région à chaque image.
 *
 * L'hôte et le chargeur sont des doublures, comme dans `PlanetarySurfaceEngine.test.ts` ; les
 * quelques fonctions d'aide sont recopiées parce que ce fichier-là ne les exporte pas.
 */

const TILESET: SurfaceTileset = {
  id: 'essai',
  body: 'essai',
  title: 'Mosaïque d’essai',
  mission: 'Essai',
  instrument: 'Essai',
  providerId: 'essai',
  service: {
    template:
      'https://example.test/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    style: 'default',
    tileMatrixSet: 'default028mm',
    matrix: WMTS_EQUIRECTANGULAR_2x1,
  },
  matrix: WMTS_EQUIRECTANGULAR_2x1,
  minLevel: 2,
  maxLevel: 8,
  publishedPixelsPerDegree: 303,
  acquired: { from: 0, to: 1 },
  credit: 'Essai',
};

const RADIUS_KM = 1737.4;

function makeHost(): SurfaceHost {
  const group = new THREE.Object3D();
  group.userData['radius'] = 1;
  return {
    setSurfaceShellScale: () => undefined,
    name: 'essai',
    layerRadius: 1,
    group,
    attachSpinningChild: (object) => group.add(object),
    createSurfaceOverlayMaterial: () => new THREE.MeshBasicMaterial(),
    releaseSurfaceOverlayMaterial: () => undefined,
    worldPointToGeographic: (point) => localDirectionToGeographic(point),
    setStreamedImageryWidth: () => true,
    shippedSurfaceWidthPx: () => 8192,
  };
}

function cameraAt(altitudeKm: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, 1.6, 1e-6, 1000);
  geographicToLocalDirection(0, 0, camera.position).multiplyScalar(
    1 + altitudeKm / RADIUS_KM
  );
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

const meshes = (host: SurfaceHost): THREE.Mesh[] =>
  host.group.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh
  );

const bitmap = (): ImageBitmap =>
  ({
    width: 256,
    height: 256,
    close: () => undefined,
  }) as unknown as ImageBitmap;

/** Pixels par degré du niveau 11 de la grille 2x1 à 256 px : la région sert jusqu'au niveau 11. */
const REGION_FINE = 2912;

const regional = (
  host: string,
  bbox: [number, number, number, number]
): {
  tileset: SurfaceTileset;
  source: {
    coverage: { bbox: [number, number, number, number] };
    publishedPixelsPerDegree: number;
  };
} => ({
  tileset: {
    ...TILESET,
    id: `region-${host}`,
    title: `Région ${host}`,
    credit: `Crédit ${host}`,
    service: {
      ...TILESET.service,
      template: `https://${host}.test/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`,
    },
    minLevel: 9,
    maxLevel: 11,
    publishedPixelsPerDegree: REGION_FINE,
  },
  source: { coverage: { bbox }, publishedPixelsPerDegree: REGION_FINE },
});

/** Le carré de deux degrés autour du point visé (0°, 0°). */
const COVER: [number, number, number, number] = [-1, -1, 1, 1];

const levelOf = (url: string): number =>
  Number(/\/(\d+)\/\d+\/\d+\.(?:png|jpg)$/.exec(url)![1]);

async function settle(
  fetchTile: TileFetcher,
  regionals: ReturnType<typeof regional>[],
  options: { hasHoles?: (image: ImageBitmap) => boolean } = {}
) {
  const engine = new PlanetarySurfaceEngine({
    budget: { maxTiles: 64, maxConcurrentLoads: 64 },
    fetchTile,
    ...options,
  });
  const host = makeHost();
  engine.attach(host, TILESET, RADIUS_KM);
  engine.setRegional(regionals);
  const camera = cameraAt(1.5);
  engine.update(camera, 800);
  await vi.waitFor(() => {
    engine.update(camera, 800);
    expect(engine.state?.painted ?? 0).toBeGreaterThan(0);
  });
  return { engine, host, camera };
}

describe('les imageries régionales', () => {
  it('sert au-delà de la base, dans sa couverture seulement, et la base en deçà', async () => {
    const urls: string[] = [];
    const { engine } = await settle(
      vi.fn<TileFetcher>(async (url) => {
        urls.push(url);
        return bitmap();
      }),
      [regional('fine', COVER)],
      { hasHoles: () => false }
    );
    const fine = urls.filter((u) => u.includes('fine.test'));
    const base = urls.filter((u) => u.includes('example.test'));
    expect(fine.length, 'la région est demandée près du sol').toBeGreaterThan(
      0
    );
    // Une région ne sert JAMAIS un niveau que la base atteint déjà, et la base jamais au-delà.
    for (const url of fine) expect(levelOf(url)).toBeGreaterThan(8);
    for (const url of base) expect(levelOf(url)).toBeLessThanOrEqual(8);
    expect(engine.state?.tilesetId).toBe('region-fine');
    expect(engine.state?.credit).toBe('Crédit fine');
    engine.dispose();
  });

  it('ne demande rien à une région qui ne couvre pas la scène', async () => {
    const urls: string[] = [];
    const { engine } = await settle(
      vi.fn<TileFetcher>(async (url) => {
        urls.push(url);
        return bitmap();
      }),
      [regional('fine', [10, 10, 12, 12])]
    );
    expect(urls.filter((u) => u.includes('fine.test'))).toEqual([]);
    expect(engine.state?.tilesetId).toBe('essai');
    engine.dispose();
  });

  it('un 404 de la région montre la base à la place, sans la redemander', async () => {
    const urls: string[] = [];
    const { engine, camera, host } = await settle(
      vi.fn<TileFetcher>(async (url) => {
        urls.push(url);
        if (url.includes('fine.test')) throw new TileHttpError(404, url);
        return bitmap();
      }),
      [regional('fine', COVER)]
    );
    const asked = urls.filter((u) => u.includes('fine.test')).length;
    expect(asked).toBeGreaterThan(0);
    expect(
      meshes(host).length,
      'des carreaux sont posés malgré le 404'
    ).toBeGreaterThan(0);
    // Le bandeau ne nomme pas une région qui n'a servi aucune tuile sous la caméra.
    expect(engine.state?.tilesetId).toBe('essai');
    for (let i = 0; i < 10; i += 1) engine.update(camera, 800);
    expect(
      urls.filter((u) => u.includes('fine.test')).length,
      'un manque de la région n’est pas redemandé à chaque image'
    ).toBe(asked);
    engine.dispose();
  });

  it('un 503 de la région n’est PAS un manque : aucun repli, l’échec se retient', async () => {
    const fetchTile = vi.fn<TileFetcher>(async (url) => {
      if (url.includes('fine.test')) throw new TileHttpError(503, url);
      return bitmap();
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 64, maxConcurrentLoads: 64 },
      fetchTile,
    });
    engine.attach(makeHost(), TILESET, RADIUS_KM);
    engine.setRegional([regional('fine', COVER)]);
    const camera = cameraAt(1.5);
    engine.update(camera, 800);
    await vi.waitFor(() =>
      expect(
        fetchTile.mock.calls.filter(([url]) => url.includes('fine.test')).length
      ).toBeGreaterThan(0)
    );
    const regionalCalls = () =>
      fetchTile.mock.calls.filter(([url]) => url.includes('fine.test')).length;
    const before = regionalCalls();
    // Aucun repli : la base n'est demandée qu'aux niveaux qu'elle sert elle-même.
    for (const [url] of fetchTile.mock.calls)
      if (url.includes('example.test'))
        expect(levelOf(url)).toBeLessThanOrEqual(8);
    for (let i = 0; i < 10; i += 1) engine.update(camera, 800);
    expect(
      regionalCalls(),
      'un 503 se retient, il ne se rejoue pas à chaque image'
    ).toBe(before);
    engine.dispose();
  });

  it('une tuile à pixel non opaque (trou de la mosaïque) est remplacée par la base', async () => {
    const urls: string[] = [];
    const holes = vi.fn<(image: ImageBitmap) => boolean>(() => true);
    const { engine, camera, host } = await settle(
      vi.fn<TileFetcher>(async (url) => {
        urls.push(url);
        return bitmap();
      }),
      [regional('fine', COVER)],
      { hasHoles: holes }
    );
    expect(holes).toHaveBeenCalled();
    expect(meshes(host).length).toBeGreaterThan(0);
    expect(
      engine.state?.tilesetId,
      'la base est nommée : la région n’a rien servi'
    ).toBe('essai');
    const asked = urls.filter((u) => u.includes('fine.test')).length;
    for (let i = 0; i < 10; i += 1) engine.update(camera, 800);
    expect(urls.filter((u) => u.includes('fine.test')).length).toBe(asked);
    engine.dispose();
  });

  it('le détecteur n’est interrogé que pour un PNG : un JPEG est toujours opaque', async () => {
    const holes = vi.fn<(image: ImageBitmap) => boolean>(() => true);
    const jpeg = regional('fine', COVER);
    jpeg.tileset.service.template = jpeg.tileset.service.template.replace(
      '.png',
      '.jpg'
    );
    const { engine } = await settle(
      vi.fn<TileFetcher>(async () => bitmap()),
      [jpeg],
      { hasHoles: holes }
    );
    expect(holes).not.toHaveBeenCalled();
    expect(engine.state?.tilesetId).toBe('region-fine');
    engine.dispose();
  });

  it('une tuile opaque est servie par la région', async () => {
    const { engine } = await settle(
      vi.fn<TileFetcher>(async () => bitmap()),
      [regional('fine', COVER)],
      { hasHoles: () => false }
    );
    expect(engine.state?.tilesetId).toBe('region-fine');
    engine.dispose();
  });

  it('plusieurs régions sur un corps : chaque tuile va à celle qui la couvre', async () => {
    const urls: string[] = [];
    const { engine } = await settle(
      vi.fn<TileFetcher>(async (url) => {
        urls.push(url);
        return bitmap();
      }),
      [regional('elsewhere', [10, 10, 12, 12]), regional('here', COVER)],
      { hasHoles: () => false }
    );
    expect(urls.some((u) => u.includes('here.test'))).toBe(true);
    expect(urls.some((u) => u.includes('elsewhere.test'))).toBe(false);
    expect(engine.state?.tilesetId).toBe('region-here');
    engine.dispose();
  });

  it('une comparaison avant/après n’emploie aucune région', async () => {
    const urls: string[] = [];
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 64, maxConcurrentLoads: 64 },
      fetchTile: vi.fn<TileFetcher>(async (url) => {
        urls.push(url);
        return bitmap();
      }),
    });
    engine.attach(makeHost(), TILESET, RADIUS_KM, null, TILESET);
    engine.setRegional([regional('fine', COVER)]);
    engine.update(cameraAt(1.5), 800);
    await vi.waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls.some((u) => u.includes('fine.test'))).toBe(false);
    engine.dispose();
  });
});
