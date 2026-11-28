import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUD_SHELL_FAILURES_BEFORE_UNAVAILABLE,
  CLOUD_SHELL_UNAVAILABLE_AFTER_MS,
  createCloudShell,
} from './cloudShell';
import type { PlanetarySurfaceEngine } from '@/components/surface/PlanetarySurfaceEngine';
import * as THREE from 'three';

import { cloudTilesetForSource } from '@/config/surfaceTilesets';
import { cloudsOnScreen } from '@/core/cloudsOnScreen';
import { createCloudShellHost } from '@/components/surface/CloudShellHost';
import {
  REGIONAL_CLOUDS_GLSL,
  REGIONAL_EXTRACTION_GLSL,
  createRegionalCloudMaterial,
  tileOceanTransform,
  UNDERSIDE_NORMAL_VERTEX_GLSL,
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
      realCloudsUniforms: () => undefined,
      adoptOverlayMaterial: () => undefined,
      setCloudShellScale: () => undefined,
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

  it('fait descendre ENSEMBLE les carreaux et la coque mondiale, puis les rétablit', () => {
    const body = earth();
    const scales: number[] = [];
    body.setCloudShellScale = (f) => scales.push(f);
    const added: THREE.Object3D[] = [];
    body.attachSpinningChild = (o) => added.push(o);
    const host = createCloudShellHost(body, { scale: 1.01 });
    const tile = new THREE.Mesh();
    host.attachSpinningChild(tile);
    // Les carreaux vont dans le groupe propre aux nuages, lui-même enfant du parent qui tourne.
    expect(added).toHaveLength(1);
    expect(tile.parent).toBe(added[0]);
    host.setShellScale(0.9917);
    expect(added[0]!.scale.x).toBeCloseTo(0.9917);
    expect(scales.at(-1)).toBeCloseTo(0.9917);
    // Le rayon que voit le moteur suit l'échelle : « caméra sous la coque » se juge sur la coque abaissée.
    expect(host.group.userData['radius']).toBeCloseTo(2 * 1.01 * 0.9917);
    host.dispose();
    expect(scales.at(-1)).toBe(1);
  });

  it('se déclare servie de l’intérieur, le sol compté sur l’ellipsoïde (GAL-EARTH-ATMOSPHERE-003)', () => {
    // Aux Kerguelen l'ellipsoïde passe 3,7 km sous la sphère moyenne : compté sur la sphère, le plafond se
    // retirait à 2 km au-dessus du sol réel (mesuré). Le sol est le plus petit demi-axe, comme pour le moteur.
    const body = { ...earth(), figure: { a: 1, b: 0.99665, c: 1 } };
    const host = createCloudShellHost(body, { scale: 1.01 });
    expect(host.interiorGroundRatio?.()).toBeCloseTo(0.99665 / 1.01, 9);
    host.setShellScale(0.9917);
    expect(host.interiorGroundRatio?.()).toBeCloseTo(
      0.99665 / (1.01 * 0.9917),
      9
    );
    // Sans figure, la sphère ; `?cloud-interior=0` (A/B) : aucune déclaration, comportement d'avant.
    expect(
      createCloudShellHost(earth(), { scale: 1.01 }).interiorGroundRatio?.()
    ).toBeCloseTo(1 / 1.01, 9);
    expect(
      createCloudShellHost(earth(), { scale: 1.01, interior: false })
        .interiorGroundRatio
    ).toBeUndefined();
  });

  it('ne borne JAMAIS la caméra : la finesse des nuages n’est pas déclarée au corps', () => {
    const host = createCloudShellHost(earth(), { scale: 1.01 });
    expect(host.setStreamedImageryWidth(131072)).toBe(false);
    expect(host.figure).toBeNull();
  });
});

describe('le matériau régional', () => {
  it('vu d’en dessous, garde la normale de la face éclairée dans la passe des faces arrière (GAL-EARTH-ATMOSPHERE-003)', () => {
    // Three dessine un matériau transparent double face en deux passes ; dans la passe arrière, `FLIP_SIDED`
    // retournait la normale et le plafond vu du sol était noir en plein jour (N·L à 0, mesuré).
    const material = createRegionalCloudMaterial(
      undefined,
      new Proxy({}, { get: () => ({ value: null }) }) as never
    );
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {
      capabilities: { isWebGL2: true },
      extensions: { has: () => true },
    } as never);
    const vertex = shader.vertexShader;
    const at = vertex.indexOf('#include <defaultnormal_vertex>');
    expect(at).toBeGreaterThan(-1);
    expect(vertex.slice(at)).toContain(UNDERSIDE_NORMAL_VERTEX_GLSL);
    expect(UNDERSIDE_NORMAL_VERTEX_GLSL).toMatch(
      /#ifdef FLIP_SIDED\s+transformedNormal = - transformedNormal;/
    );
    expect(material.side).toBe(THREE.DoubleSide);
  });

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

  it('compose comme la couche mondiale, par le MÊME code (une seule définition)', () => {
    const defs =
      REAL_CLOUDS_PARS_GLSL.split('float composeCloudAlpha(').length - 1;
    expect(defs).toBe(1);
    expect(REGIONAL_CLOUDS_GLSL).toContain('composeCloudAlpha(');
    // Les masques sont lus dans l'UV MONDIAL, l'image dans l'UV du carreau.
    expect(REGIONAL_CLOUDS_GLSL).toContain(
      'vec2 maskUv = vMapUv * uCloudTile.zw + uCloudTile.xy;'
    );
  });

  it('teint par le signal mesuré, et seulement là où le carreau a pris le relais', () => {
    expect(REGIONAL_CLOUDS_GLSL).toContain('rcObsMin');
    expect(REGIONAL_CLOUDS_GLSL).toContain(
      'mix( vec3( 1.0, 0.995, 0.985 ), vec3( rcShade ), regionalWeight )'
    );
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
    realCloudsUniforms: () => undefined,
    adoptOverlayMaterial: () => undefined,
    setCloudShellScale: () => undefined,
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

  it('sert le plafond vu d’en dessous avec un GPU, jamais en rendu logiciel (GAL-EARTH-ATMOSPHERE-003)', () => {
    const hosts = (interior: boolean | undefined) => {
      const { engine } = stubEngine();
      const shell = createCloudShell({
        budget: { maxTiles: 8, maxConcurrentLoads: 2 },
        engine,
        ...(interior === undefined ? {} : { interior }),
      });
      cloudsOnScreen.value = true;
      cloudsOnScreen.source = {
        id: 'VIIRS_NOAA21_CorrectedReflectance_TrueColor:2026-11-20',
        day: '2026-11-20',
      };
      shell.drive(body, 6371, 1.0005, camera, 800);
      const host = (engine.attach as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as { interiorGroundRatio?: () => number };
      shell.dispose();
      return host;
    };
    expect(typeof hosts(undefined).interiorGroundRatio).toBe('function');
    expect(typeof hosts(true).interiorGroundRatio).toBe('function');
    expect(hosts(false).interiorGroundRatio).toBeUndefined();
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

describe('disponibilité réelle et cycle de vie des nuages régionaux', () => {
  const SOURCE = (day: string) => ({
    id: `VIIRS_NOAA21_CorrectedReflectance_TrueColor:${day}`,
    day,
  });
  function setup() {
    const calls: string[] = [];
    let painted = 0;
    let busy = 0;
    let clock = 0;
    const scales: number[] = [];
    const engine = {
      attach: vi.fn((_h: unknown, tileset: { day?: string }) =>
        calls.push(`attach:${tileset.day}`)
      ),
      update: vi.fn(),
      detach: vi.fn(() => calls.push('detach')),
      dispose: vi.fn(() => calls.push('dispose')),
      get busyCount() {
        return busy;
      },
      get state() {
        return { painted, requested: 4, level: 6, day: null };
      },
    } as unknown as PlanetarySurfaceEngine;
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
      realCloudsUniforms: () => undefined,
      adoptOverlayMaterial: () => undefined,
      setCloudShellScale: (f: number) => scales.push(f),
    } as unknown as CloudShellEarth;
    const shell = createCloudShell({
      budget: { maxTiles: 8, maxConcurrentLoads: 2 },
      engine,
      now: () => clock,
    });
    const camera = new THREE.PerspectiveCamera();
    // Une caméra à 500 km d'altitude : dans la bande, coque abaissée.
    const drive = () => shell.drive(body, 6371, 1 + 500 / 6371, camera, 800);
    return {
      shell,
      drive,
      calls,
      scales,
      paint: (n: number) => (painted = n),
      inFlight: (n: number) => (busy = n),
      advance: (ms: number) => (clock += ms),
    };
  }

  it('n’est PRÊTE qu’une fois une tuile peinte, puis le reste pour cette source', () => {
    const t = setup();
    cloudsOnScreen.value = true;
    cloudsOnScreen.source = SOURCE('2026-11-20');
    t.drive();
    expect(t.shell.serves()).toBe(true);
    expect(t.shell.ready()).toBe(false); // chargement en cours : repli de #579
    t.paint(3);
    t.drive();
    expect(t.shell.ready()).toBe(true);
    t.paint(0); // tuiles en cours de remplacement : pas de retour au fond du jour
    t.drive();
    expect(t.shell.ready()).toBe(true);
  });

  it('sans tuile peinte après le délai : indisponible, retirée, et pas d’oscillation', () => {
    const t = setup();
    cloudsOnScreen.value = true;
    cloudsOnScreen.source = SOURCE('2026-11-20');
    t.drive();
    t.advance(CLOUD_SHELL_UNAVAILABLE_AFTER_MS - 1);
    t.drive();
    expect(t.shell.serves()).toBe(true);
    t.advance(2);
    t.drive();
    expect(t.shell.serves()).toBe(false);
    expect(t.shell.ready()).toBe(false);
    expect(t.calls.at(-1)).toBe('detach');
    expect(t.scales.at(-1)).toBe(1); // la coque mondiale retrouve son altitude d'orbite
    // Une tuile qui arriverait enfin ne fait pas rebasculer le fond pour cette source.
    t.paint(5);
    const attaches = t.calls.filter((c) => c.startsWith('attach')).length;
    t.drive();
    expect(t.shell.ready()).toBe(false);
    expect(t.calls.filter((c) => c.startsWith('attach')).length).toBe(attaches);
    // Un autre jour : un nouvel essai.
    cloudsOnScreen.source = SOURCE('2026-11-21');
    expect(t.shell.serves()).toBe(true);
  });

  it('des ÉCHECS de tuiles sans aucun succès signent une panne, même avec des requêtes toujours en vol', () => {
    const t = setup();
    cloudsOnScreen.value = true;
    cloudsOnScreen.source = SOURCE('2026-11-20');
    t.inFlight(4); // le moteur redemande sans cesse : la règle d'inactivité ne verrait rien
    t.drive();
    for (let i = 0; i < CLOUD_SHELL_FAILURES_BEFORE_UNAVAILABLE - 1; i += 1)
      t.shell.recordFetch(false);
    t.drive();
    expect(t.shell.serves()).toBe(true);
    t.shell.recordFetch(false);
    t.drive();
    expect(t.shell.serves()).toBe(false);
    expect(t.calls.at(-1)).toBe('detach');
    // Un autre jour remet les comptes à zéro.
    cloudsOnScreen.source = SOURCE('2026-11-21');
    t.drive();
    expect(t.shell.serves()).toBe(true);
  });

  it('un seul succès suffit : des échecs partiels ne sont pas une panne', () => {
    const t = setup();
    cloudsOnScreen.value = true;
    cloudsOnScreen.source = SOURCE('2026-11-20');
    t.inFlight(4);
    t.shell.recordFetch(true);
    for (let i = 0; i < 20; i += 1) t.shell.recordFetch(false);
    t.drive();
    expect(t.shell.serves()).toBe(true);
  });

  it('un chargement LENT (tuiles en vol) n’est jamais pris pour une panne', () => {
    const t = setup();
    cloudsOnScreen.value = true;
    cloudsOnScreen.source = SOURCE('2026-11-20');
    t.inFlight(6); // tuiles demandées, pas encore arrivées
    for (let i = 0; i < 10; i += 1) {
      t.advance(CLOUD_SHELL_UNAVAILABLE_AFTER_MS);
      t.drive();
    }
    expect(t.shell.serves()).toBe(true);
    // Elles arrivent enfin : la couche est prête.
    t.inFlight(0);
    t.paint(6);
    t.drive();
    expect(t.shell.ready()).toBe(true);
  });

  it('jette les tuiles de l’ancien jour AVANT d’attacher le nouveau (pas de mélange temporel)', () => {
    const t = setup();
    cloudsOnScreen.value = true;
    cloudsOnScreen.source = SOURCE('2026-11-20');
    t.paint(2);
    t.drive();
    expect(t.shell.ready()).toBe(true);
    cloudsOnScreen.source = SOURCE('2026-11-21');
    t.paint(0);
    t.drive();
    const i = t.calls.lastIndexOf('attach:2026-11-21');
    expect(t.calls.slice(i - 1, i + 1)).toEqual([
      'detach',
      'attach:2026-11-21',
    ]);
    // Le nouveau jour doit à son tour peindre avant de passer pour prêt.
    expect(t.shell.ready()).toBe(false);
  });

  it('libérer retire les tuiles et rétablit la coque ; détruire libère le moteur', () => {
    const t = setup();
    cloudsOnScreen.value = true;
    cloudsOnScreen.source = SOURCE('2026-11-20');
    t.drive();
    expect(t.scales.at(-1)).toBeLessThan(1);
    t.shell.release();
    expect(t.calls.at(-1)).toBe('detach');
    expect(t.scales.at(-1)).toBe(1);
    // Retour sur la Terre : un nouvel attachement, la même coque abaissée, aucune ancienne gardée.
    t.drive();
    expect(t.calls.at(-1)).toBe('attach:2026-11-20');
    expect(t.scales.at(-1)).toBeLessThan(1);
    t.shell.dispose();
    expect(t.calls.at(-1)).toBe('dispose');
    expect(t.scales.at(-1)).toBe(1);
  });
});
