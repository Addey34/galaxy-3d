import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  defaultHoleDetector,
  rgbaHasHoles,
  PlanetarySurfaceEngine,
  TileHttpError,
  type SurfaceHost,
  type TileFetcher,
} from './PlanetarySurfaceEngine';
import { pyramidWidthPx, WMTS_EQUIRECTANGULAR_2x1 } from '@/core/tilePyramid';
import {
  geographicToLocalDirection,
  localDirectionToGeographic,
} from '@/core/frames';
import type { SurfaceTileset } from '@/config/surfaceTilesets';

/**
 * LA PROVENANCE ET LE PLANCHER SUIVENT CE QUI EST PEINT, PAS CE QUI EST DEMANDÉ
 * (GAL-IMMERSION-003B-FINAL, lot A).
 *
 * Le niveau de la sélection n'est pas une preuve de chargement : une tuile fine dont la région
 * répond 404, un trou PNG, une réponse en attente ou un 503 montrent l'image de la BASE (ou rien).
 * Le bandeau ne doit pas nommer la région, ni annoncer sa finesse, et le plancher d'approche ne
 * doit pas se relâcher parce que la sélection subdivise : il suit le niveau de DONNÉE réellement
 * peint sous la caméra, plus un niveau (le contrat progressif).
 */

const BASE: SurfaceTileset = {
  id: 'base',
  body: 'essai',
  title: 'Base',
  mission: 'Essai',
  instrument: 'Essai',
  providerId: 'essai',
  service: {
    template:
      'https://base.test/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    style: 'default',
    tileMatrixSet: 'default028mm',
    matrix: WMTS_EQUIRECTANGULAR_2x1,
  },
  matrix: WMTS_EQUIRECTANGULAR_2x1,
  minLevel: 2,
  maxLevel: 8,
  publishedPixelsPerDegree: 303,
  acquired: { from: 0, to: 1 },
  credit: 'Crédit base',
};
const RADIUS_KM = 1737.4;
const REGION_FINE = 2912; // niveau 11 de la grille 2x1 à 256 px
const COVER: [number, number, number, number] = [-1, -1, 1, 1];

const region = (bbox = COVER) => ({
  tileset: {
    ...BASE,
    id: 'region',
    title: 'Région',
    credit: 'Crédit région',
    service: {
      ...BASE.service,
      template:
        'https://region.test/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png',
    },
    minLevel: 9,
    maxLevel: 11,
    publishedPixelsPerDegree: REGION_FINE,
  } satisfies SurfaceTileset,
  source: { coverage: { bbox }, publishedPixelsPerDegree: REGION_FINE },
});

function makeHost(widths: number[]): SurfaceHost {
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
    setStreamedImageryWidth: (w) => {
      widths.push(w);
      return true;
    },
    shippedSurfaceWidthPx: () => 8192,
  };
}

function cameraAt(altitudeKm: number, lonDeg = 0): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, 1.6, 1e-6, 1000);
  geographicToLocalDirection(0, lonDeg, camera.position).multiplyScalar(
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
const isRegion = (url: string) => url.includes('region.test');
const widthOf = (level: number) => pyramidWidthPx(level, BASE.matrix);

interface Rig {
  engine: PlanetarySurfaceEngine;
  widths: number[];
  step: (camera: THREE.PerspectiveCamera, times?: number) => void;
}

function rig(
  fetchTile: TileFetcher,
  regions = [region()],
  hasHoles?: (image: ImageBitmap) => boolean
): Rig {
  const widths: number[] = [];
  const engine = new PlanetarySurfaceEngine({
    budget: { maxTiles: 64, maxConcurrentLoads: 64 },
    fetchTile,
    ...(hasHoles ? { hasHoles } : {}),
  });
  engine.attach(makeHost(widths), BASE, RADIUS_KM);
  engine.setRegional(regions);
  return {
    engine,
    widths,
    step: (camera, times = 1) => {
      for (let i = 0; i < times; i += 1) engine.update(camera, 800);
    },
  };
}

/** Approche en deux temps : d'abord haut (la base se peint), puis près du sol. */
async function approach(r: Rig, low = 1.5): Promise<void> {
  const high = cameraAt(60);
  r.step(high);
  await vi.waitFor(() => {
    r.step(high);
    expect(r.engine.state?.painted ?? 0).toBeGreaterThan(0);
  });
  r.step(cameraAt(low), 3);
}

const settleTiles = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('provenance et plancher : ce qui est peint', () => {
  it('région en 404 partout : le bandeau dit la base à son niveau, le plancher ne dépasse pas un niveau', async () => {
    const r = rig(
      vi.fn<TileFetcher>(async (url) => {
        if (isRegion(url)) throw new TileHttpError(404, url);
        return bitmap();
      })
    );
    await approach(r);
    await settleTiles();
    for (let i = 0; i < 6; i += 1) {
      r.step(cameraAt(1.5));
      await settleTiles();
    }
    expect(r.engine.state?.tilesetId).toBe('base');
    expect(r.engine.state?.credit).toBe('Crédit base');
    expect(r.engine.state?.level).toBeLessThanOrEqual(8);
    expect(r.engine.state?.widthPx).toBeLessThanOrEqual(widthOf(8));
    // Le plancher peut autoriser le prochain niveau (9), jamais celui que la région n'a pas servi.
    expect(Math.max(...r.widths)).toBeLessThanOrEqual(widthOf(9));
    r.engine.dispose();
  });

  it('tuiles transparentes partout : même traitement que le 404', async () => {
    const r = rig(
      vi.fn<TileFetcher>(async () => bitmap()),
      [region()],
      (image) => image !== undefined
    );
    // Le détecteur déclare un trou dans TOUTE image, y compris celles de la base : on ne s'en sert
    // que pour la région (le moteur ne l'interroge que pour un PNG de région).
    await approach(r);
    for (let i = 0; i < 6; i += 1) {
      r.step(cameraAt(1.5));
      await settleTiles();
    }
    expect(r.engine.state?.tilesetId).toBe('base');
    expect(Math.max(...r.widths)).toBeLessThanOrEqual(widthOf(9));
    r.engine.dispose();
  });

  it('tuiles fines en attente : rien n’est annoncé de la région, le plancher reste progressif', async () => {
    const pending: Array<() => void> = [];
    const r = rig(
      vi.fn<TileFetcher>(
        (url) =>
          new Promise((resolve) => {
            if (isRegion(url)) pending.push(() => resolve(bitmap()));
            else resolve(bitmap());
          })
      )
    );
    await approach(r);
    for (let i = 0; i < 4; i += 1) {
      r.step(cameraAt(1.5));
      await settleTiles();
    }
    expect(pending.length).toBeGreaterThan(0);
    expect(r.engine.state?.tilesetId).toBe('base');
    expect(r.engine.state?.level).toBeLessThanOrEqual(8);
    expect(Math.max(...r.widths)).toBeLessThanOrEqual(widthOf(9));
    // Les réponses arrivent : la région est enfin peinte, le bandeau la nomme et le plancher descend.
    for (const resolve of pending) resolve();
    await vi.waitFor(() => {
      r.step(cameraAt(1.5));
      expect(r.engine.state?.tilesetId).toBe('region');
    });
    expect(r.engine.state?.level).toBeGreaterThan(8);
    r.engine.dispose();
  });

  it('503 temporaire de la région : pas de repli, pas de nom de région, plancher progressif ; le réessai réussit', async () => {
    let failing = true;
    const r = rig(
      vi.fn<TileFetcher>(async (url) => {
        if (isRegion(url) && failing) throw new TileHttpError(503, url);
        return bitmap();
      })
    );
    await approach(r);
    for (let i = 0; i < 4; i += 1) {
      r.step(cameraAt(1.5));
      await settleTiles();
    }
    expect(r.engine.state?.tilesetId).toBe('base');
    expect(Math.max(...r.widths)).toBeLessThanOrEqual(widthOf(9));
    failing = false;
    r.engine.retryFailedNow();
    await vi.waitFor(() => {
      r.step(cameraAt(1.5));
      expect(r.engine.state?.tilesetId).toBe('region');
    });
    expect(r.engine.state?.level).toBeGreaterThan(8);
    r.engine.dispose();
  });

  it('une région servie jusqu’au niveau 11 puis quittée : le bandeau redit la base, le plancher se relâche en douceur', async () => {
    const r = rig(
      vi.fn<TileFetcher>(async () => bitmap()),
      [region()],
      () => false
    );
    await approach(r);
    await vi.waitFor(() => {
      r.step(cameraAt(1.5));
      expect(r.engine.state?.tilesetId).toBe('region');
    });
    const deepest = Math.max(...r.widths);
    expect(deepest).toBeGreaterThan(widthOf(9));
    // On s'éloigne de la couverture (longitude 20°) : la base, à son niveau maximal.
    const away = cameraAt(1.5, 20);
    for (let i = 0; i < 6; i += 1) {
      r.step(away);
      await settleTiles();
    }
    expect(r.engine.state?.tilesetId).toBe('base');
    expect(r.engine.state?.level).toBeLessThanOrEqual(8);
    r.engine.dispose();
  });
});

describe('transitions de couverture (GAL-IMMERSION-003B-UNBLOCK, lot D)', () => {
  it('dézoom : tant que le carreau fin reste visible faute de remplaçant, le bandeau le nomme encore', async () => {
    let hang = false;
    const r = rig(
      vi.fn<TileFetcher>(async () => {
        // Après la descente, plus aucun carreau nouveau n'arrive : les fins restent seuls à l'écran.
        if (hang) return new Promise<ImageBitmap>(() => undefined);
        return bitmap();
      })
    );
    await approach(r);
    await vi.waitFor(() => {
      r.step(cameraAt(1.5));
      expect(r.engine.state?.tilesetId).toBe('region');
    });
    // Laisse finir les fondus : tout ce qui est peint est visible.
    await new Promise((resolve) => setTimeout(resolve, 700));
    r.step(cameraAt(1.5));
    const fineLevel = r.engine.state!.level;
    expect(fineLevel).toBeGreaterThan(8);
    hang = true;
    for (let i = 0; i < 4; i += 1) {
      r.step(cameraAt(12));
      await settleTiles();
    }
    // Les carreaux fins couvrent encore le sol sous la visée : c'est CETTE image que l'on voit.
    expect(r.engine.state?.tilesetId).toBe('region');
    expect(r.engine.state?.level).toBeGreaterThan(8);
    r.engine.dispose();
  });

  it('retour dans la couverture après une sortie, tuiles d’abord indisponibles : la base reste dite, puis la région revient', async () => {
    let failing = false;
    const r = rig(
      vi.fn<TileFetcher>(async (url) => {
        if (isRegion(url) && failing) throw new TileHttpError(503, url);
        return bitmap();
      })
    );
    await approach(r);
    await vi.waitFor(() => {
      r.step(cameraAt(1.5));
      expect(r.engine.state?.tilesetId).toBe('region');
    });
    for (let i = 0; i < 6; i += 1) {
      r.step(cameraAt(1.5, 20));
      await settleTiles();
    }
    expect(r.engine.state?.tilesetId).toBe('base');
    // Retour ailleurs dans la couverture : d'autres carreaux, que le service refuse d'abord.
    failing = true;
    for (let i = 0; i < 4; i += 1) {
      r.step(cameraAt(1.5, 0.7));
      await settleTiles();
    }
    expect(r.engine.state?.tilesetId).not.toBe('region');
    failing = false;
    r.engine.retryFailedNow();
    await vi.waitFor(() => {
      r.step(cameraAt(1.5, 0.7));
      expect(r.engine.state?.tilesetId).toBe('region');
    });
    r.engine.dispose();
  });
});

describe('détecteur de trous sur de vrais octets', () => {
  const rgba = (alphas: number[]): Uint8ClampedArray =>
    Uint8ClampedArray.from(alphas.flatMap((a) => [90, 90, 90, a]));

  it('un seul pixel non opaque suffit ; une tuile entièrement opaque n’en a pas', () => {
    expect(rgbaHasHoles(rgba([255, 255, 255, 255]))).toBe(false);
    expect(rgbaHasHoles(rgba([255, 255, 254, 255]))).toBe(true);
    expect(rgbaHasHoles(rgba([255, 0, 255, 255]))).toBe(true);
    expect(rgbaHasHoles(rgba([0, 0, 0, 0]))).toBe(true);
  });

  const fakeCanvas = (alphas: number[]) => ({
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => undefined,
      getImageData: () => ({ data: rgba(alphas) }),
    }),
  });
  const image = { width: 2, height: 2 } as unknown as ImageBitmap;

  it('sans OffscreenCanvas : un canevas du document lit les mêmes octets', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    try {
      vi.stubGlobal('document', {
        createElement: () => fakeCanvas([255, 255, 0, 255]),
      });
      expect(defaultHoleDetector(image)).toBe(true);
      vi.stubGlobal('document', {
        createElement: () => fakeCanvas([255, 255, 255, 255]),
      });
      expect(defaultHoleDetector(image)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sans aucun contexte 2D, ou si la lecture échoue : aucun trou signalé, sans lever', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    try {
      vi.stubGlobal('document', {
        createElement: () => ({ getContext: () => null }),
      });
      expect(defaultHoleDetector(image)).toBe(false);
      vi.stubGlobal('document', {
        createElement: () => ({
          getContext: () => ({
            drawImage: () => undefined,
            getImageData: () => {
              throw new Error('canevas altéré');
            },
          }),
        }),
      });
      expect(defaultHoleDetector(image)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('réponses obsolètes', () => {
  it('un 404 arrivé après le détachement ne marque pas la tuile manquante pour la suite', async () => {
    const lateMisses: Array<() => void> = [];
    let stale = true;
    const regionUrls: string[] = [];
    const r = rig(
      vi.fn<TileFetcher>(
        (url) =>
          new Promise((resolve, reject) => {
            if (!isRegion(url)) return resolve(bitmap());
            regionUrls.push(url);
            if (stale)
              lateMisses.push(() => reject(new TileHttpError(404, url)));
            else resolve(bitmap());
          })
      )
    );
    await approach(r);
    r.step(cameraAt(1.5), 3);
    await settleTiles();
    expect(lateMisses.length).toBeGreaterThan(0);
    // On quitte le corps (détachement) puis on y revient, AVANT l'arrivée des 404.
    r.engine.detach();
    const widths: number[] = [];
    r.engine.attach(makeHost(widths), BASE, RADIUS_KM);
    r.engine.setRegional([region()]);
    stale = false;
    const before = regionUrls.length;
    for (const miss of lateMisses) miss();
    await settleTiles();
    await approach({ ...r, widths });
    for (let i = 0; i < 4; i += 1) {
      r.step(cameraAt(1.5));
      await settleTiles();
    }
    // Les tuiles fines sont redemandées à la région puis servies : le 404 obsolète n'a rien marqué.
    expect(regionUrls.length).toBeGreaterThan(before);
    await vi.waitFor(() => {
      r.step(cameraAt(1.5));
      expect(r.engine.state?.tilesetId).toBe('region');
    });
    r.engine.dispose();
  });
});
