import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  PlanetarySurfaceEngine,
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
 * LES ANCÊTRES DE REPLI DANS LE MOTEUR (GAL-SURFACE-MULTILOD-001) : une couverture découverte demande
 * d'abord des carreaux GROSSIERS (qui ferment le trou), puis les feuilles ; une fois les feuilles posées
 * et franches, les ancêtres ne sont plus voulus et quittent la scène ; coupé, rien de tel.
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

const bitmap = (): ImageBitmap =>
  ({
    width: 256,
    height: 256,
    close: () => undefined,
  }) as unknown as ImageBitmap;

/** Le niveau demandé, lu dans l'adresse de la tuile (`…/{TileMatrix}/{TileRow}/{TileCol}.jpg`). */
const levelOf = (url: string): number =>
  Number(/\/(\d+)\/\d+\/\d+\.jpg$/.exec(url)![1]);

const meshes = (host: SurfaceHost): THREE.Mesh[] =>
  host.group.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh
  );

describe('les ancêtres de repli dans le moteur', () => {
  it("une couverture découverte demande d'abord ses ancêtres grossiers, puis les feuilles", async () => {
    const levels: number[] = [];
    const fetchTile = vi.fn<TileFetcher>(async (url) => {
      levels.push(levelOf(url));
      return bitmap();
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 1 },
      fetchTile,
      fallbackLevels: 3,
    });
    const host = makeHost();
    engine.attach(host, TILESET, RADIUS_KM);
    engine.update(cameraAt(8), 800);
    await vi.waitFor(() => expect(levels.length).toBeGreaterThan(3));
    const leafLevel = Math.max(...levels);
    expect(levels[0]).toBeLessThan(leafLevel);
    engine.dispose();
  });

  it('les feuilles posées et franches, les ancêtres quittent la scène', async () => {
    const now = vi.spyOn(performance, 'now');
    let t = 1000;
    now.mockImplementation(() => t);
    const fetchTile = vi.fn<TileFetcher>(async () => bitmap());
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 32 },
      fetchTile,
      fallbackLevels: 3,
    });
    const host = makeHost();
    engine.attach(host, TILESET, RADIUS_KM);
    const camera = cameraAt(8);
    engine.update(camera, 800);
    await vi.waitFor(() =>
      expect(fetchTile.mock.calls.length).toBeGreaterThan(25)
    );
    // Le temps passe (révélation groupée, fondus) : chaque passe peut retirer ce qui n'est plus voulu.
    for (let i = 0; i < 40; i += 1) {
      t += 1000;
      engine.update(camera, 800);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const ancestors = fetchTile.mock.calls.filter(
      ([url]) =>
        levelOf(url) <
        Math.max(...fetchTile.mock.calls.map(([u]) => levelOf(u)))
    ).length;
    expect(ancestors).toBeGreaterThan(0);
    // Il ne reste que les feuilles : aucun ancêtre n'est encore attaché ni visible.
    const visible = meshes(host).filter((m) => m.visible);
    expect(visible.length).toBe(25);
    now.mockRestore();
    engine.dispose();
  });

  it('coupé (0), le moteur ne demande que les feuilles de la sélection', async () => {
    const levels: number[] = [];
    const fetchTile = vi.fn<TileFetcher>(async (url) => {
      levels.push(levelOf(url));
      return bitmap();
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
      fallbackLevels: 0,
    });
    engine.attach(makeHost(), TILESET, RADIUS_KM);
    engine.update(cameraAt(8), 800);
    await vi.waitFor(() => expect(levels.length).toBe(25));
    // Rien de plus que les 25 feuilles (la sélection en mêle deux niveaux, aucun ancêtre en plus).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(levels.length).toBe(25);
    engine.dispose();
  });
});
