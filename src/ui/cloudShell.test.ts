import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudShell } from './cloudShell';
import type { PlanetarySurfaceEngine } from '@/components/surface/PlanetarySurfaceEngine';
import * as THREE from 'three';

import { cloudTilesetForSource } from '@/config/surfaceTilesets';
import { cloudsOnScreen } from '@/core/cloudsOnScreen';
import { createCloudShellHost } from '@/components/surface/CloudShellHost';
import {
  REGIONAL_CLOUDS_GLSL,
  REGIONAL_EXTRACTION_GLSL,
  tileOceanTransform,
} from '@/components/surface/cloudShellMaterial';
import { REAL_CLOUDS_PARS_GLSL } from '@/config/layerConfig';
import { WMTS_EQUIRECTANGULAR_2x1 } from '@/core/tilePyramid';
import type { CloudShellEarth } from '@/components/surface/CloudShellHost';

afterEach(() => {
  cloudsOnScreen.value = false;
  cloudsOnScreen.source = null;
});

describe('le jeu de tuiles des nuages régionaux', () => {
  it('suit la couche ET le jour posés par la couche mondiale, jamais une voisine', () => {
    const noaa21 = cloudTilesetForSource(
      'earth',
      'VIIRS_NOAA21_CorrectedReflectance_TrueColor:2026-11-20'
    );
    expect(noaa21?.service.template).toContain(
      '/VIIRS_NOAA21_CorrectedReflectance_TrueColor/'
    );
    expect(noaa21?.service.template).toContain('/2026-11-20/');
    expect(noaa21?.day).toBe('2026-11-20');
    const noaa20 = cloudTilesetForSource(
      'earth',
      'VIIRS_NOAA20_CorrectedReflectance_TrueColor:2026-11-19'
    );
    expect(noaa20?.service.template).toContain('/VIIRS_NOAA20_');
    expect(noaa20?.day).toBe('2026-11-19');
  });

  it('refuse une couche sans fiche à 250 m (MODIS) et un identifiant mal formé', () => {
    expect(
      cloudTilesetForSource(
        'earth',
        'MODIS_Terra_CorrectedReflectance_TrueColor:2020-05-05'
      )
    ).toBeUndefined();
    expect(cloudTilesetForSource('earth', 'sans-jour')).toBeUndefined();
    expect(
      cloudTilesetForSource(
        'earth',
        'VIIRS_NOAA21_CorrectedReflectance_TrueColor:hier'
      )
    ).toBeUndefined();
    expect(cloudTilesetForSource('mars', 'x:2026-01-01')).toBeUndefined();
  });
});

describe('la façade de la coque', () => {
  const earth = (): CloudShellEarth => {
    const group = new THREE.Group();
    group.position.set(3, 4, 5);
    group.userData['radius'] = 2;
    return {
      name: 'earth',
      layerRadius: 1,
      group,
      attachSpinningChild: () => undefined,
      createSurfaceOverlayMaterial: () => new THREE.MeshBasicMaterial(),
      releaseSurfaceOverlayMaterial: () => undefined,
      worldPointToGeographic: () => ({ latitudeDeg: 1, longitudeDeg: 2 }),
      setStreamedImageryWidth: () => true,
      shippedSurfaceWidthPx: () => 8192,
      setSurfaceShellScale: () => undefined,
      getOceanMask: () => null,
      adoptOverlayMaterial: () => undefined,
    };
  };

  it('présente la Terre comme une sphère plus grande, à la même position', () => {
    const body = earth();
    const host = createCloudShellHost(body, { scale: 1.01 });
    expect(host.layerRadius).toBeCloseTo(1.01);
    expect(host.group.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([
      3, 4, 5,
    ]);
    expect(host.group.userData['radius']).toBeCloseTo(2.02);
    // Le morph Éduc↔Explo fait varier le rayon rendu : la façade le SUIT.
    body.group.userData['radius'] = 10;
    expect(host.group.userData['radius']).toBeCloseTo(10.1);
  });

  it('ne borne JAMAIS la caméra : la finesse des nuages n’est pas déclarée au corps', () => {
    const host = createCloudShellHost(earth(), { scale: 1.01 });
    expect(host.setStreamedImageryWidth(131072)).toBe(false);
    expect(host.figure).toBeNull();
  });
});

describe('le matériau régional', () => {
  it('reprend l’extraction commune, avec le masque d’eau dans le repère du carreau', () => {
    expect(REGIONAL_EXTRACTION_GLSL).not.toBe(REAL_CLOUDS_PARS_GLSL);
    expect(REGIONAL_EXTRACTION_GLSL).toContain('uCloudTile.zw');
    expect(REGIONAL_EXTRACTION_GLSL).not.toContain(
      'textureGrad( uCloudOceanMask, uv, gx, gy )'
    );
    // Les mêmes fonctions : un nuage a le même contour dans les deux couches.
    expect(REGIONAL_EXTRACTION_GLSL).toContain('bilinearCloudAlpha');
    expect(REGIONAL_CLOUDS_GLSL).toContain('bilinearCloudAlpha( vMapUv )');
  });

  it('pose le complément de la couche mondiale : ni doublon ni trou', () => {
    expect(REGIONAL_CLOUDS_GLSL).toContain('regionalWeight');
    expect(REGIONAL_CLOUDS_GLSL).toContain('2.0 * ( 1.0 - fadeGlobal )');
  });

  it('mappe l’UV d’un carreau sur la carte mondiale (v = 1 au nord)', () => {
    // Niveau 1 de la grille 2 x 1 : la tuile (ligne 0, colonne 0) est le quart nord-ouest.
    const t = tileOceanTransform(
      { level: 1, row: 0, column: 0 },
      WMTS_EQUIRECTANGULAR_2x1
    );
    expect(t.xy[0]).toBeCloseTo(0); // ouest = -180°
    expect(t.xy[1]).toBeCloseTo(0.5); // sud de la tuile = 0°
    expect(t.zw[0]).toBeCloseTo(0.25); // 90° de longitude sur 360
    expect(t.zw[1]).toBeCloseTo(0.5); // 90° de latitude sur 180
    expect(t.span[0]).toBeCloseTo(4);
    expect(t.span[1]).toBeCloseTo(2);
  });
});

describe('le pilote des nuages régionaux', () => {
  const stubEngine = () => {
    const attached: unknown[] = [];
    const engine = {
      attach: vi.fn((_h: unknown, tileset: unknown) => attached.push(tileset)),
      update: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      busyCount: 0,
      state: null,
    } as unknown as PlanetarySurfaceEngine;
    return { engine, attached };
  };
  const body = {
    name: 'earth',
    layerRadius: 1,
    group: new THREE.Group(),
    attachSpinningChild: () => undefined,
    createSurfaceOverlayMaterial: () => new THREE.MeshBasicMaterial(),
    releaseSurfaceOverlayMaterial: () => undefined,
    worldPointToGeographic: () => ({ latitudeDeg: 0, longitudeDeg: 0 }),
    setStreamedImageryWidth: () => false,
    shippedSurfaceWidthPx: () => 2048,
    setSurfaceShellScale: () => undefined,
    getOceanMask: () => null,
    adoptOverlayMaterial: () => undefined,
  } as unknown as CloudShellEarth;
  const camera = new THREE.PerspectiveCamera();

  it('rend le MÊME jeu de tuiles à chaque image tant que la source ne change pas', () => {
    // Un jeu neuf à chaque image relançait toute la génération du moteur (37 tuiles redemandées ~370 fois en 18 s).
    const { engine, attached } = stubEngine();
    const shell = createCloudShell({
      budget: { maxTiles: 8, maxConcurrentLoads: 2 },
      engine,
    });
    cloudsOnScreen.value = true;
    cloudsOnScreen.source = {
      id: 'VIIRS_NOAA21_CorrectedReflectance_TrueColor:2026-11-20',
      day: '2026-11-20',
    };
    for (let i = 0; i < 5; i += 1) shell.drive(body, 6371, 1.4, camera, 800);
    expect(attached).toHaveLength(5);
    expect(new Set(attached).size).toBe(1);
    // Un autre jour : un autre jeu, et un seul.
    cloudsOnScreen.source = {
      id: 'VIIRS_NOAA21_CorrectedReflectance_TrueColor:2026-11-19',
      day: '2026-11-19',
    };
    for (let i = 0; i < 3; i += 1) shell.drive(body, 6371, 1.4, camera, 800);
    expect(new Set(attached).size).toBe(2);
  });

  it('se retire quand les nuages ne sont plus à l’écran, trop loin, ou sans fiche à 250 m', () => {
    const { engine } = stubEngine();
    const shell = createCloudShell({
      budget: { maxTiles: 8, maxConcurrentLoads: 2 },
      engine,
    });
    cloudsOnScreen.value = true;
    cloudsOnScreen.source = {
      id: 'VIIRS_NOAA21_CorrectedReflectance_TrueColor:2026-11-20',
      day: '2026-11-20',
    };
    expect(shell.serves()).toBe(true);
    shell.drive(body, 6371, 3, camera, 800); // au-dessus du plafond
    expect(engine.attach).not.toHaveBeenCalled();
    cloudsOnScreen.source = {
      id: 'MODIS_Terra_CorrectedReflectance_TrueColor:2020-05-05',
      day: '2020-05-05',
    };
    expect(shell.serves()).toBe(false);
    cloudsOnScreen.value = false;
    expect(shell.serves()).toBe(false);
  });
});
