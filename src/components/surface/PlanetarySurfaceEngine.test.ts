import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  PlanetarySurfaceEngine,
  type AttachedHeights,
  type HeightFetcher,
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

function makeHost(): SurfaceHost & { declared: number[]; shell: number[] } {
  const group = new THREE.Object3D();
  // Rayon RENDU : la caméra du test est placée en unités de scène par rapport à lui.
  group.userData['radius'] = 1;
  const declared: number[] = [];
  const shell: number[] = [];
  return {
    declared,
    shell,
    setSurfaceShellScale: (factor) => shell.push(factor),
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

/**
 * LE RELIEF : partagé, facultatif, et jamais annoncé sans être posé.
 *
 * Une tuile de hauteurs du socle couvre 256 carreaux d'imagerie au niveau 8 : la demander par
 * carreau serait exactement l'erreur que la phase 9C a payée sur l'imagerie. Et un relief
 * indisponible ne doit pas emporter l'imagerie avec lui.
 */
describe('le relief sous les carreaux', () => {
  /** Une tuile de hauteurs encodée au format du cuiseur, plate à l'altitude donnée. */
  const heightTileBytes = (
    index: { level: number; row: number; column: number },
    metres: number
  ): ArrayBuffer => {
    const samples = 257;
    const buffer = new ArrayBuffer(32 + samples * samples * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < 4; i += 1) view.setUint8(i, 'GXHT'.charCodeAt(i));
    view.setUint16(4, 1, true);
    view.setUint16(6, 32, true);
    view.setUint16(8, index.level, true);
    view.setUint16(10, index.row, true);
    view.setUint16(12, index.column, true);
    view.setUint16(14, samples, true);
    view.setFloat64(16, 0.5, true);
    view.setFloat64(24, 0, true);
    new Int16Array(buffer, 32).fill(Math.round(metres / 0.5));
    return buffer;
  };

  const HEIGHTS: AttachedHeights = {
    set: {
      id: 'essai-relief',
      body: 'essai',
      title: 'Relief d’essai',
      mission: 'Essai',
      instrument: 'Essai',
      manifestPath: 'assets/height-tiles/essai/manifest.json',
      acquired: { from: 0, to: 1 },
      credit: 'Essai',
    },
    manifest: {
      directory: 'assets/height-tiles/essai/abcdef',
      samples: 257,
      quantumMetres: 0.5,
      offsetMetres: 0,
      datumRadiusKm: RADIUS_KM,
      coverage: [{ levels: [4] }],
      minElevationMetres: -9000,
      maxElevationMetres: 10000,
      baseLevel: 4,
    },
  };

  it('ne demande une tuile de hauteurs qu’une fois pour tous les carreaux qu’elle couvre', async () => {
    const fetchTile = vi.fn<TileFetcher>(async () => bitmap());
    const fetchHeights = vi.fn<HeightFetcher>(async (url) => {
      const [level, row, column] = url
        .replace(/\.hgt$/, '')
        .split('/')
        .slice(-3)
        .map(Number);
      return heightTileBytes(
        { level: level!, row: row!, column: column! },
        -2000
      );
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
      fetchHeights,
    });
    const host = makeHost();
    engine.attach(host, TILESET, RADIUS_KM, HEIGHTS);

    const camera = cameraAt(8);
    engine.update(camera, 800);
    await vi.waitFor(() => expect(fetchTile).toHaveBeenCalledTimes(25));
    await vi.waitFor(() => expect(host.shell.length).toBeGreaterThan(0));

    // 25 carreaux du niveau 8, mais au plus quatre tuiles de socle sous eux.
    expect(fetchHeights.mock.calls.length).toBeLessThanOrEqual(4);
    expect(fetchHeights).toHaveBeenCalled();
    // La sphère livrée descend au minimum MESURÉ du jeu, une seule fois.
    expect(host.shell).toEqual([(RADIUS_KM - 9) / RADIUS_KM]);

    engine.update(camera, 800);
    expect(engine.state?.relief?.level).toBe(4);
    expect(engine.state?.relief?.title).toBe('Relief d’essai');

    // Au détachement, la sphère reprend sa taille : sinon le corps resterait rétréci.
    engine.detach();
    expect(host.shell[host.shell.length - 1]).toBe(1);
  });

  it('borne la jupe au dénivelé du carreau, pas à la sphère abaissée', async () => {
    // Première version : la jupe descendait jusqu'à la sphère livrée abaissée, pour qu'on ne
    // voie jamais à travers. Sur la Lune cela fait dix kilomètres de mur sous CHAQUE carreau,
    // et le bord de chacun se dessinait en noir. Ici les hauteurs sont constantes : le carreau
    // n'a aucun dénivelé, donc il ne doit avoir AUCUNE épaisseur.
    const fetchTile = vi.fn<TileFetcher>(async () => bitmap());
    const fetchHeights = vi.fn<HeightFetcher>(async (url) => {
      const [level, row, column] = url
        .replace(/\.hgt$/, '')
        .split('/')
        .slice(-3)
        .map(Number);
      return heightTileBytes(
        { level: level!, row: row!, column: column! },
        -2000
      );
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
      fetchHeights,
    });
    const host = makeHost();
    engine.attach(host, TILESET, RADIUS_KM, HEIGHTS);
    engine.update(cameraAt(8), 800);
    await vi.waitFor(() =>
      expect(host.group.children.length).toBeGreaterThan(0)
    );

    const mesh = host.group.children[0] as THREE.Mesh;
    const position = mesh.geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i);
      lowest = Math.min(lowest, vertex.length());
      highest = Math.max(highest, vertex.length());
    }
    // Le sommet est bien descendu de 2 000 m, mesurés dans l'unité locale du corps…
    expect(highest).toBeCloseTo(1 - 2 / RADIUS_KM, 6);
    // … et l'épaisseur du carreau reste nulle, là où une jupe jusqu'au socle vaudrait
    // 7 000 m, soit 4,0e-3 unité.
    expect(highest - lowest).toBeLessThan(1e-4);
    engine.dispose();
  });

  it('lit la tuile VOISINE pour la couronne d’un carreau de bord', async () => {
    // Deux carreaux d'imagerie de part et d'autre d'une frontière de tuile de hauteurs : leurs
    // normales de bord doivent coïncider. Sans traversée de frontière, la couronne est rabattue
    // sur le bord, la pente y est fausse des deux côtés, et l'éclairage trace une ligne nette
    // sur toute la largeur de l'écran. Le relief employé ici est COURBE : une pente droite ne
    // montrerait rien, puisque différence centrée et unilatérale y coïncident.
    const fetchTile = vi.fn<TileFetcher>(async () => bitmap());
    const fetchHeights = vi.fn<HeightFetcher>(async (url) => {
      const [level, row, column] = url
        .replace(/\.hgt$/, '')
        .split('/')
        .slice(-3)
        .map(Number);
      const samples = 257;
      const buffer = new ArrayBuffer(32 + samples * samples * 2);
      const view = new DataView(buffer);
      for (let i = 0; i < 4; i += 1) view.setUint8(i, 'GXHT'.charCodeAt(i));
      view.setUint16(4, 1, true);
      view.setUint16(6, 32, true);
      view.setUint16(8, level!, true);
      view.setUint16(10, row!, true);
      view.setUint16(12, column!, true);
      view.setUint16(14, samples, true);
      view.setFloat64(16, 0.5, true);
      view.setFloat64(24, 0, true);
      const values = new Int16Array(buffer, 32);
      // Paraboloïde CONTINU d'une tuile à l'autre, exprimé dans l'index global de colonne.
      for (let y = 0; y < samples; y += 1)
        for (let x = 0; x < samples; x += 1) {
          // Relief ONDULÉ et CONTINU d'une tuile à l'autre, exprimé dans l'index global de
          // colonne. Il faut une courbure forte à l'échelle de l'échantillon : un relief mou
          // rendrait pente centrée et pente unilatérale indiscernables, et la garde ne
          // tiendrait rien (mesuré en falsifiant, avec un paraboloïde trop doux).
          const global = column! * (samples - 1) + x;
          values[y * samples + x] = Math.round(
            (3000 * Math.sin(global * 0.25)) / 0.5
          );
        }
      return buffer;
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
      fetchHeights,
    });
    const host = makeHost();
    engine.attach(host, TILESET, RADIUS_KM, HEIGHTS);
    engine.update(cameraAt(8), 800);
    await vi.waitFor(() => expect(host.group.children.length).toBe(25));

    // La caméra vise 0°, 0° : la frontière des tuiles de socle (niveau 4) tombe exactement
    // entre les colonnes 255 et 256 du niveau 8.
    const west = host.group.children.find(
      (child) => child.name === 'tile_8_128_255'
    ) as THREE.Mesh | undefined;
    const east = host.group.children.find(
      (child) => child.name === 'tile_8_128_256'
    ) as THREE.Mesh | undefined;
    expect(west, 'carreau ouest absent').toBeDefined();
    expect(east, 'carreau est absent').toBeDefined();

    const normalOf = (mesh: THREE.Mesh, index: number): THREE.Vector3 =>
      new THREE.Vector3().fromBufferAttribute(
        mesh.geometry.getAttribute('normal'),
        index
      );
    // (s + 1)² sommets de nappe PLUS 4s de jupe : la racine carrée seule donnerait un s faux
    // d'un ou deux, et les indices de bord tomberaient à côté.
    const count = west!.geometry.getAttribute('position').count;
    const segments = Math.round(-3 + Math.sqrt(count + 8));
    const side = segments + 1;
    let worst = 0;
    for (let j = 0; j < side; j += 1) {
      const a = normalOf(west!, j * side + segments);
      const b = normalOf(east!, j * side);
      worst = Math.max(worst, 1 - Math.min(1, a.dot(b)));
    }
    // Les deux normales doivent être la MÊME : 1e-6 sur leur produit scalaire. La couronne
    // rabattue en donne cent fois plus (mesuré en falsifiant).
    expect(worst).toBeLessThan(1e-6);
    engine.dispose();
  });

  it('pose les carreaux PLATS quand les hauteurs manquent, sans rien annoncer', async () => {
    const fetchTile = vi.fn<TileFetcher>(async () => bitmap());
    const fetchHeights = vi.fn<HeightFetcher>(async () => {
      throw new Error('404');
    });
    const engine = new PlanetarySurfaceEngine({
      budget: { maxTiles: 25, maxConcurrentLoads: 25 },
      fetchTile,
      fetchHeights,
    });
    const host = makeHost();
    engine.attach(host, TILESET, RADIUS_KM, HEIGHTS);

    const camera = cameraAt(8);
    engine.update(camera, 800);
    await vi.waitFor(() => expect(host.group.children.length).toBe(25));
    engine.update(camera, 800);

    // L'imagerie reste : un relief absent ne fait pas disparaître le sol.
    expect(engine.state?.painted).toBe(25);
    // Et le bandeau ne parle pas d'un relief qui n'est pas là.
    expect(engine.state?.relief).toBeNull();
    expect(host.shell).toEqual([]);
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
