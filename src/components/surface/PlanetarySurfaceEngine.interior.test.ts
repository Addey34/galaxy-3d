import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  PlanetarySurfaceEngine,
  type SurfaceHost,
  type TileFetcher,
} from './PlanetarySurfaceEngine';
import { tileBounds, WMTS_EQUIRECTANGULAR_2x1 } from '@/core/tilePyramid';
import {
  geographicToLocalDirection,
  localDirectionToGeographic,
} from '@/core/frames';
import type { SurfaceTileset } from '@/config/surfaceTilesets';

/**
 * UNE COQUE VUE DE L'INTÉRIEUR (GAL-EARTH-ATMOSPHERE-003) : le plafond nuageux vu du sol.
 *
 * Le moteur détachait tout dès que la caméra passait sous la sphère qu'il sert (`radii <= lowest`). Un hôte
 * qui déclare `interiorGroundRatio` (le rayon de son sol en rayons de la coque) reste servi tant que la caméra
 * est au-dessus de ce sol, avec l'horizon du SOL vu de l'intérieur : le rayon rasant le sol touche la coque à
 * acos(g/d) + acos(g) du nadir. Sans la déclaration, rien ne change (le sol, tous les autres corps).
 */

const TILESET: SurfaceTileset = {
  id: 'essai-nuages',
  body: 'essai',
  title: 'Coque d’essai',
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
  publishedPixelsPerDegree: 444,
  acquired: { from: 0, to: 1 },
  credit: 'Essai',
};

/** La coque d'essai : 6 381 km (10 km au-dessus d'un sol de 6 371 km). */
const SHELL_KM = 6381;
const GROUND = 6371 / SHELL_KM;

function shellHost(groundRatio: number | null): SurfaceHost {
  const group = new THREE.Object3D();
  group.userData['radius'] = 1;
  return {
    name: 'essai-nuages',
    layerRadius: 1,
    group,
    attachSpinningChild: (object) => group.add(object),
    createSurfaceOverlayMaterial: () => new THREE.MeshBasicMaterial(),
    releaseSurfaceOverlayMaterial: () => undefined,
    worldPointToGeographic: (point) => localDirectionToGeographic(point),
    setStreamedImageryWidth: () => false,
    shippedSurfaceWidthPx: () => 2048,
    setSurfaceShellScale: () => undefined,
    ...(groundRatio === null ? {} : { interiorGroundRatio: () => groundRatio }),
  };
}

/** Caméra à `radius` (rayons de la coque) au-dessus de (0°, 0°), qui regarde le ZÉNITH ou le nadir. */
function cameraAt(
  radius: number,
  look: 'up' | 'down'
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, 1.6, 1e-7, 10);
  geographicToLocalDirection(0, 0, camera.position).multiplyScalar(radius);
  const target = camera.position
    .clone()
    .multiplyScalar(look === 'up' ? 1.5 : 0);
  // Le haut de l'image vers le nord, pour que `lookAt` reste défini en visée verticale.
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return camera;
}

const bitmap = (): ImageBitmap =>
  ({
    width: 512,
    height: 512,
    close: () => undefined,
  }) as unknown as ImageBitmap;

/** Niveau, ligne, colonne lus dans l'adresse demandée. */
const indexOf = (url: string) => {
  const [level, row, column] = url
    .replace(/\.jpg$/, '')
    .split('/')
    .slice(-3)
    .map(Number) as [number, number, number];
  return { level, row, column };
};

/** Distance angulaire (radians) du nadir (0°, 0°) au point le plus proche du carreau. */
const nearestAngle = (url: string): number => {
  const b = tileBounds(indexOf(url), WMTS_EQUIRECTANGULAR_2x1);
  const lat = Math.min(b.north, Math.max(b.south, 0));
  const lon = Math.min(b.east, Math.max(b.west, 0));
  const a = geographicToLocalDirection(lat, lon, new THREE.Vector3());
  const o = geographicToLocalDirection(0, 0, new THREE.Vector3());
  return Math.acos(Math.min(1, a.dot(o)));
};

async function requested(
  host: SurfaceHost,
  camera: THREE.PerspectiveCamera
): Promise<string[]> {
  const fetchTile = vi.fn<TileFetcher>(async () => bitmap());
  const engine = new PlanetarySurfaceEngine({
    fallbackLevels: 0,
    budget: { maxTiles: 40, maxConcurrentLoads: 64 },
    fetchTile,
  });
  engine.attach(host, TILESET, SHELL_KM);
  engine.update(camera, 800);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const urls = fetchTile.mock.calls.map((call) => call[0]);
  engine.dispose();
  return urls;
}

describe('une coque vue de l’intérieur (le plafond vu du sol)', () => {
  // Caméra à 2 km au-dessus du sol, sous la coque de 10 km.
  const inside = (6371 + 2) / SHELL_KM;

  it('sans déclaration, rien n’est demandé sous la coque (comportement du sol, inchangé)', async () => {
    expect(await requested(shellHost(null), cameraAt(inside, 'up'))).toEqual(
      []
    );
  });

  it('déclarée, le plafond au-dessus de la caméra est demandé, et rien au-delà de l’horizon du sol', async () => {
    const urls = await requested(shellHost(GROUND), cameraAt(inside, 'up'));
    expect(urls.length).toBeGreaterThan(0);
    // Le carreau du zénith est demandé.
    expect(urls.some((url) => nearestAngle(url) === 0)).toBe(true);
    const horizon = Math.acos(GROUND / inside) + Math.acos(GROUND);
    for (const url of urls)
      expect(nearestAngle(url)).toBeLessThanOrEqual(horizon + 1e-9);
    // Et plus fin au zénith (la coque à 8 km) qu'un carreau grossier : la sélection subdivise de l'intérieur.
    expect(Math.max(...urls.map((url) => indexOf(url).level))).toBeGreaterThan(
      TILESET.minLevel + 2
    );
  });

  it('caméra sous le sol déclaré : rien (pas de plafond vu de sous la Terre)', async () => {
    expect(
      await requested(shellHost(GROUND), cameraAt(GROUND - 0.001, 'up'))
    ).toEqual([]);
  });

  it('au-dessus de la coque, la déclaration ne change rien (même sélection que sans elle)', async () => {
    const outside = (SHELL_KM + 50) / SHELL_KM;
    const camera = cameraAt(outside, 'down');
    const plain = await requested(shellHost(null), camera);
    const declared = await requested(shellHost(GROUND), camera);
    expect(plain.length).toBeGreaterThan(0);
    expect(declared.sort()).toEqual(plain.sort());
  });
});
