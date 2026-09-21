import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  PlanetarySurfaceEngine,
  type SurfaceHost,
  type TileFetcher,
} from './PlanetarySurfaceEngine';
import { pyramidWidthPx, WMTS_EQUIRECTANGULAR_2x1 } from '@/core/tilePyramid';
import type { SurfaceTileset } from '@/config/surfaceTilesets';

/**
 * CE QUE LE MOTEUR DEMANDE, ET CE QU'IL NE REDEMANDE PAS.
 *
 * Trois affirmations qui tiennent à la POLITESSE vis-à-vis d'un service tiers dont aucune
 * limite de débit n'est publiée, et qu'aucune capture d'écran ne pourrait montrer :
 * une couverture stable ne redemande rien, un échec se retient, et la finesse déclarée au corps
 * ne s'ouvre qu'une fois un carreau réellement posé.
 *
 * Le hôte et le chargeur sont des doublures : c'est justement pour cela que le moteur les prend
 * en paramètre plutôt que d'aller les chercher.
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

function makeHost(): SurfaceHost & { declared: number[] } {
  const group = new THREE.Object3D();
  // Rayon RENDU : la caméra du test est placée en unités de scène par rapport à lui.
  group.userData['radius'] = 1;
  const declared: number[] = [];
  return {
    declared,
    name: 'essai',
    layerRadius: 1,
    group,
    attachSpinningChild: (object) => group.add(object),
    createSurfaceOverlayMaterial: () => new THREE.MeshBasicMaterial(),
    releaseSurfaceOverlayMaterial: () => undefined,
    // La caméra du test regarde toujours le même point : la couverture est donc stable.
    worldPointToGeographic: () => ({ latitudeDeg: 0, longitudeDeg: 0 }),
    setStreamedImageryWidth: (widthPx) => {
      if (declared[declared.length - 1] === widthPx) return false;
      declared.push(widthPx);
      return true;
    },
    shippedSurfaceWidthPx: () => 8192,
  };
}

/** Caméra à `altitudeKm` au-dessus d'un corps de rayon 1 unité placé à l'origine. */
function cameraAt(altitudeKm: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 1000);
  camera.position.set(0, 0, 1 + altitudeKm / RADIUS_KM);
  return camera;
}

/** Une image décodée factice : le moteur n'en lit que la présence. */
const bitmap = (): ImageBitmap =>
  ({
    width: 256,
    height: 256,
    close: () => undefined,
  }) as unknown as ImageBitmap;

describe('ce que le moteur demande', () => {
  it('ne redemande RIEN quand la caméra ne bouge pas', async () => {
    const fetchTile = vi.fn<TileFetcher>(async () => bitmap());
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
    });
    const host = makeHost();
    engine.attach(host, TILESET, RADIUS_KM);

    const camera = cameraAt(8);
    engine.update(camera, 800);
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledTimes(25));

    // Dix passes de plus, sans bouger : la première version redemandait la couverture entière
    // à chaque image (47 tuiles par seconde, mesuré dans le navigateur).
    for (let i = 0; i < 10; i += 1) engine.update(camera, 800);
    expect(fetchTile).toHaveBeenCalledTimes(25);
    engine.dispose();
  });

  it('retient un échec au lieu de le rejouer à chaque image', async () => {
    const fetchTile = vi.fn<TileFetcher>(async () => {
      throw new Error('503');
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
    });
    engine.attach(makeHost(), TILESET, RADIUS_KM);

    const camera = cameraAt(8);
    engine.update(camera, 800);
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledTimes(25));
    for (let i = 0; i < 10; i += 1) engine.update(camera, 800);
    expect(
      fetchTile,
      'un service en panne recevrait soixante requêtes par seconde'
    ).toHaveBeenCalledTimes(25);
    engine.dispose();
  });

  it('ne demande rien tant que le corps est loin, ni sous sa surface', () => {
    const fetchTile = vi.fn<TileFetcher>(async () => bitmap());
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
    });
    engine.attach(makeHost(), TILESET, RADIUS_KM);

    // 7 rayons : au-dessus du seuil de travail.
    const far = new THREE.PerspectiveCamera(55, 1.6, 0.1, 1000);
    far.position.set(0, 0, 7);
    engine.update(far, 800);
    // Caméra SOUS la surface : c'est l'état de la toute première image, avant le vol d'approche.
    const inside = new THREE.PerspectiveCamera(55, 1.6, 0.1, 1000);
    inside.position.set(0, 0, 0.5);
    engine.update(inside, 800);
    expect(fetchTile).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('refuse de peindre un niveau plus grossier que la texture livrée', () => {
    const fetchTile = vi.fn<TileFetcher>(async () => bitmap());
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
    });
    engine.attach(makeHost(), TILESET, RADIUS_KM);
    // 1 500 km au-dessus de la Lune : le budget ne permet qu'un niveau bas, dont la finesse
    // est inférieure aux 8 192 px que l'hôte déclare servir.
    engine.update(cameraAt(1500), 800);
    expect(fetchTile).not.toHaveBeenCalled();
    expect(engine.state).toBeNull();
    engine.dispose();
  });
});

describe('la finesse déclarée au corps', () => {
  it('ne s’ouvre qu’une fois un carreau POSÉ, puis ne se referme plus', async () => {
    // Chargements EN VOL : rien n'est encore posé, donc rien ne doit être promis au corps.
    let release: (() => void) | null = null;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchTile = vi.fn<TileFetcher>(async () => {
      await pending;
      return bitmap();
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
    });
    const host = makeHost();
    engine.attach(host, TILESET, RADIUS_KM);

    const camera = cameraAt(8);
    engine.update(camera, 800);
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalled());
    engine.update(camera, 800);
    expect(
      host.declared,
      'une fiche seule ne suffit pas à promettre un sol qu’un service en panne ne servira pas'
    ).toEqual([]);

    // Les images arrivent : un seul carreau posé suffit, et c'est le niveau MAXIMAL de la
    // fiche qui est déclaré, pas celui qui vient d'être peint.
    release!();
    // `update` est ce qui constate la pose : on le rejoue jusqu'à ce qu'un carreau soit là.
    await vi.waitFor(() => {
      engine.update(camera, 800);
      expect(host.declared.length).toBe(1);
    });
    expect(host.declared[0]).toBe(pyramidWidthPx(8, WMTS_EQUIRECTANGULAR_2x1));

    // Éloigner la caméra jette les carreaux, mais ne referme PAS le plancher sous elle.
    const far = new THREE.PerspectiveCamera(55, 1.6, 0.1, 1000);
    far.position.set(0, 0, 7);
    engine.update(far, 800);
    expect(host.declared).toEqual([
      pyramidWidthPx(8, WMTS_EQUIRECTANGULAR_2x1),
    ]);

    // Le détachement, lui, la referme.
    engine.detach();
    expect(host.declared).toEqual([
      pyramidWidthPx(8, WMTS_EQUIRECTANGULAR_2x1),
      0,
    ]);
  });
});
