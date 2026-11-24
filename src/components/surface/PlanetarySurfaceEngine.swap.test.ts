import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  PlanetarySurfaceEngine,
  type AttachedHeights,
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
 * CHANGER DE JEU ET DE RELIEF SANS DÉTACHER (GAL-EARTH-CLOUD-IMMERSION-001, 2026-11-24).
 *
 * Le relief est cuit sur la grille de l'imagerie : passer de l'image du jour (VIIRS) à la mosaïque
 * annuelle (Sentinel-2) change AUSSI de relief. Quand ce cas détachait le moteur, la finesse déclarée
 * au corps retombait à zéro, le plancher d'approche à celui de la texture livrée, et la caméra était
 * repoussée de 100 km au-dessus de la bascule (journal de bascule : r 1,0118 puis 1,0728 seize
 * millisecondes plus tard). Ce fichier garde le comportement contraire : la largeur déclarée ne
 * repasse JAMAIS par zéro pendant le changement, et les carreaux déjà peints restent à l'écran.
 */
const RADIUS_KM = 6371;

const tileset = (id: string): SurfaceTileset => ({
  id,
  body: 'essai',
  title: id,
  mission: 'Essai',
  instrument: 'Essai',
  providerId: 'essai',
  service: {
    template: `https://${id}.test/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg`,
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
});

const relief = (id: string): AttachedHeights => ({
  set: {
    id,
    body: 'essai',
    title: id,
    mission: 'Essai',
    instrument: 'Essai',
    manifestPath: `assets/height-tiles/essai/${id}/manifest.json`,
    acquired: { from: 0, to: 1 },
    credit: 'Essai',
  },
  manifest: {
    directory: `assets/height-tiles/essai/${id}`,
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
    maxElevationMetres: 9000,
    baseLevel: 4,
    figureFloorRatio: 0.99,
    figure: { source: 'sphere', renderRadiusKm: RADIUS_KM, radiusKm: null },
  } as unknown as AttachedHeights['manifest'],
});

function makeHost(): SurfaceHost & { declared: number[] } {
  const group = new THREE.Object3D();
  group.userData['radius'] = 1;
  const declared: number[] = [];
  return {
    declared,
    setSurfaceShellScale: () => undefined,
    name: 'essai',
    layerRadius: 1,
    group,
    attachSpinningChild: (object) => group.add(object),
    createSurfaceOverlayMaterial: () => new THREE.MeshBasicMaterial(),
    releaseSurfaceOverlayMaterial: () => undefined,
    worldPointToGeographic: (point) => localDirectionToGeographic(point),
    setStreamedImageryWidth: (widthPx) => {
      if (declared[declared.length - 1] === widthPx) return false;
      declared.push(widthPx);
      return true;
    },
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

const meshes = (host: SurfaceHost): THREE.Mesh[] =>
  host.group.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh
  );

describe('changer de jeu en changeant de relief', () => {
  it('ne remet jamais la finesse déclarée à zéro et garde les carreaux peints', async () => {
    const fetchTile = vi.fn<TileFetcher>(async () => bitmap());
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
      // Aucun relief à lire : l'essai porte sur la permutation, pas sur le décodage des hauteurs.
      fetchHeights: async () => {
        throw new Error('hors essai');
      },
    });
    const host = makeHost();
    const camera = cameraAt(300);

    engine.attach(host, tileset('jour'), RADIUS_KM, relief('relief-jour'));
    engine.update(camera, 800);
    // La finesse n'est déclarée qu'APRÈS qu'un carreau a été peint : on repasse l'image jusque-là.
    await vi.waitFor(() => {
      engine.update(camera, 800);
      expect(host.declared.at(-1) ?? 0).toBeGreaterThan(0);
    });
    const painted = meshes(host).length;

    // Autre jeu ET autre relief, sur le même corps : la bascule du fond de loin.
    engine.attach(host, tileset('annuel'), RADIUS_KM, relief('relief-annuel'));

    // Rien n'est détaché : aucune largeur à zéro, et les carreaux de l'ancien jeu sont encore là.
    expect(host.declared).not.toContain(0);
    expect(meshes(host).length).toBeGreaterThanOrEqual(painted);
    engine.dispose();
  });

  it('un détachement RESTE le seul chemin qui remet la finesse à zéro', () => {
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile: async () => bitmap(),
    });
    const host = makeHost();
    engine.attach(host, tileset('jour'), RADIUS_KM, relief('relief-jour'));
    engine.update(cameraAt(300), 800);
    engine.detach();
    // Garde du test lui-même : sans cette remise à zéro explicite, le test ci-dessus ne prouverait rien.
    expect(host.declared.length === 0 || host.declared.at(-1) === 0).toBe(true);
    engine.dispose();
  });

  it('ne garde de l’ancien jeu que ce qu’une tuile encore absente recouvre', async () => {
    // Le nouveau jeu répond partout SAUF pour une tuile en échec : avant la correction,
    // cette seule tuile gardait TOUTE l'ancienne génération sous la nouvelle.
    let hung = false;
    const fetchTile = vi.fn<TileFetcher>(async (url) => {
      if (url.includes('//annuel.test') && !hung) {
        hung = true;
        throw new Error('tuile en échec');
      }
      return bitmap();
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
    });
    const host = makeHost();
    const camera = cameraAt(300);
    engine.attach(host, tileset('jour'), RADIUS_KM);
    await vi.waitFor(() => {
      engine.update(camera, 800);
      expect(host.declared.at(-1) ?? 0).toBeGreaterThan(0);
    });
    engine.attach(host, tileset('annuel'), RADIUS_KM);
    const tiles = (engine as unknown as { _tiles: Map<string, unknown> })
      ._tiles;
    const staleCount = (): number =>
      [...tiles.keys()].filter((key) => !key.startsWith('1|')).length;
    const before = staleCount();
    expect(before).toBeGreaterThan(1);
    await vi.waitFor(() => {
      engine.update(camera, 800);
      // Une tuile du nouveau jeu manque encore : une seule tuile retenue la recouvre.
      expect(staleCount()).toBe(1);
    });
    engine.dispose();
  });

  it('jette l’ancienne image d’une AUTRE grille après un délai, même s’il manque une tuile', async () => {
    const fetchTile = vi.fn<TileFetcher>(async (url) => {
      // Le nouveau jeu : une tuile en échec, qui ne se posera jamais.
      if (
        url.includes('//annuel.test') &&
        fetchTile.mock.calls.length % 7 === 0
      )
        throw new Error('tuile en échec');
      return bitmap();
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
    });
    const host = makeHost();
    const camera = cameraAt(300);
    engine.attach(host, tileset('jour'), RADIUS_KM);
    await vi.waitFor(() => {
      engine.update(camera, 800);
      expect(host.declared.at(-1) ?? 0).toBeGreaterThan(0);
    });
    // Une AUTRE grille : celle de GIBS (10 × 5 tuiles de 512 px au niveau 3).
    const autre = tileset('annuel');
    const grille = {
      columnsAtLevelZero: 10,
      rowsAtLevelZero: 5,
      tileSizePx: 512,
      referenceLevel: 3,
    };
    autre.matrix = grille;
    autre.service = { ...autre.service, matrix: grille };
    engine.attach(host, autre, RADIUS_KM);
    const tiles = (engine as unknown as { _tiles: Map<string, unknown> })
      ._tiles;
    const stale = (): number =>
      [...tiles.keys()].filter((key) => !key.startsWith('1|')).length;
    expect(stale()).toBeGreaterThan(0);

    const now = performance.now();
    const spy = vi.spyOn(performance, 'now').mockReturnValue(now + 10_000);
    engine.update(camera, 800);
    spy.mockRestore();
    expect(stale()).toBe(0);
    engine.dispose();
  });
});
