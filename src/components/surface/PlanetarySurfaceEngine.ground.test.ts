import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  PlanetarySurfaceEngine,
  type AttachedHeights,
  type HeightFetcher,
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
 * LA SÉLECTION MESURE LA DISTANCE AU SOL, PAS À LA SPHÈRE (GAL-IMMERSION-003B-FINAL, lot B).
 *
 * Témoin : l'Olympus Mons de Mars, dont le sol est à 19,9 km de la sphère. La caméra à 7,5 km du
 * sol se croyait à 27 km, voyait des texels plus petits qu'un pixel et ne subdivisait pas. Ici un
 * sol à +8 000 m partout, une caméra à la même altitude de sphère : la sélection doit descendre
 * plus fin que sur un sol à 0 m, et n'y descendre PAS quand aucun relief n'est posé.
 */
const RADIUS_KM = 3389.5;
const TILESET: SurfaceTileset = {
  id: 'fin',
  body: 'essai',
  title: 'Fin',
  mission: 'Essai',
  instrument: 'Essai',
  providerId: 'essai',
  service: {
    template:
      'https://fin.test/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    style: 'default',
    tileMatrixSet: 'default028mm',
    matrix: WMTS_EQUIRECTANGULAR_2x1,
  },
  matrix: WMTS_EQUIRECTANGULAR_2x1,
  minLevel: 2,
  maxLevel: 20,
  publishedPixelsPerDegree: 40_000,
  acquired: { from: 0, to: 1 },
  credit: 'Essai',
};

const heightsFor = (): AttachedHeights => ({
  set: {
    id: 'relief',
    body: 'essai',
    title: 'Relief',
    mission: 'Essai',
    instrument: 'Essai',
    manifestPath: 'assets/height-tiles/essai/manifest.json',
    acquired: { from: 0, to: 1 },
    credit: 'Essai',
  },
  manifest: {
    directory: 'assets/height-tiles/essai/abc',
    tileOrigin: '',
    matrix: {
      columnsAtLevelZero: 2,
      rowsAtLevelZero: 1,
      tileSizePx: 256,
      referenceLevel: 0,
    },
    samples: 257,
    quantumMetres: 0.5,
    offsetMetres: 0,
    datumRadiusKm: RADIUS_KM,
    coverage: [{ levels: [4] }],
    minElevationMetres: -9000,
    maxElevationMetres: 22000,
    baseLevel: 4,
    figureFloorRatio: 0.99,
    figure: { source: 'sphere', renderRadiusKm: RADIUS_KM, radiusKm: null },
  } as unknown as AttachedHeights['manifest'],
});

const heightBytes =
  (metres: number): HeightFetcher =>
  async (url) => {
    const [level, row, column] = url
      .replace(/\.hgt$/, '')
      .split('/')
      .slice(-3)
      .map(Number);
    const buffer = new ArrayBuffer(32 + 257 * 257 * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < 4; i += 1) view.setUint8(i, 'GXHT'.charCodeAt(i));
    view.setUint16(4, 1, true);
    view.setUint16(6, 32, true);
    view.setUint16(8, level!, true);
    view.setUint16(10, row!, true);
    view.setUint16(12, column!, true);
    view.setUint16(14, 257, true);
    view.setFloat64(16, 0.5, true);
    view.setFloat64(24, 0, true);
    new Int16Array(buffer, 32).fill(Math.round(metres / 0.5));
    return buffer;
  };

function host(): SurfaceHost {
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
const levelOf = (url: string): number =>
  Number(/\/(\d+)\/\d+\/\d+\.jpg$/.exec(url)![1]);

/** Niveau maximal demandé à 8,5 km au-dessus de la sphère, sur un sol de `groundMetres` (ou sans relief). */
async function deepestLevel(groundMetres: number | null): Promise<number> {
  const urls: string[] = [];
  const engine = new PlanetarySurfaceEngine({
    budget: { maxTiles: 256, maxConcurrentLoads: 256 },
    fetchTile: vi.fn<TileFetcher>(async (url) => {
      urls.push(url);
      return bitmap();
    }),
    ...(groundMetres !== null
      ? { fetchHeights: heightBytes(groundMetres) }
      : {}),
  });
  engine.attach(
    host(),
    TILESET,
    RADIUS_KM,
    groundMetres !== null ? heightsFor() : null
  );
  const camera = cameraAt(8.5);
  // Plusieurs passes : les hauteurs arrivent après les premières images, et le sol mesuré avec.
  for (let i = 0; i < 12; i += 1) {
    engine.update(camera, 800);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  engine.dispose();
  return Math.max(...urls.map(levelOf));
}

describe('distance au sol dans la sélection', () => {
  it('un sol à +8 000 m fait descendre la sélection plus fin que le même point à 0 m', async () => {
    const flat = await deepestLevel(0);
    const high = await deepestLevel(8000);
    // La caméra est à 0,5 km du sol élevé et à 8,5 km du sol plat : plusieurs niveaux d'écart.
    expect(high).toBeGreaterThanOrEqual(flat + 3);
  });

  it('sans relief posé, rien ne change : même niveau que sur un sol à 0 m', async () => {
    expect(await deepestLevel(null)).toBe(await deepestLevel(0));
  });

  it('un sol sous la sphère éloigne la caméra du sol : la sélection ne descend pas plus fin', async () => {
    const flat = await deepestLevel(0);
    const basin = await deepestLevel(-3000);
    expect(basin).toBeLessThanOrEqual(flat);
  });
});
