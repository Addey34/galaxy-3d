import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  HEIGHT_ORIGIN,
  encodeBuildingTile,
  tileOfLonLat,
} from '@/core/buildingTile';
import { quantizeToTile } from '@/core/buildingTile';
import { geographicToLocalDirection } from '@/core/frames';
import type { BuildingSetManifest } from '@/config/buildingSets';
import { BuildingLayer, type BuildingHost } from './BuildingLayer';

/**
 * LA COUCHE DE BÂTIMENTS : ce qu'elle demande, ce qu'elle retire, et surtout qu'elle ne pose rien
 * tant que le sol rendu n'est pas mesuré. Hôte factice : une sphère de rayon 1 unité pour 6 371 km.
 */

const RADIUS_KM = 6371;
const LON = 2.34;
const LAT = 48.86;
const ZOOM = 14;

const SET: BuildingSetManifest = {
  id: 'essai',
  body: 'earth',
  title: 'essai',
  zoom: ZOOM,
  directory: 'assets/buildings/essai/abc',
  bboxLonLat: [2.3, 48.8, 2.4, 48.9],
  source: {
    name: 'x',
    license: 'x',
    licenseUrl: 'x',
    attribution: 'x',
    readFrom: 'x',
    readTo: 'x',
  },
};

function makeHost(): BuildingHost {
  const group = new THREE.Object3D();
  const spinning = new THREE.Object3D();
  group.add(spinning);
  return {
    name: 'Terre',
    layerRadius: 1,
    group,
    attachSpinningChild: (object) => spinning.add(object),
  };
}

const buildingMeshes = (host: BuildingHost): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  host.group.traverse((o) => {
    if (o.userData['building']) out.push(o as THREE.Mesh);
  });
  return out;
};

/** Un carreau de sol : une grande sphère de rayon `radius` (unités du corps) autour de l'origine. */
function addGround(host: BuildingHost, radius: number): void {
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 32),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  ground.userData['surfaceTile'] = true;
  // Comme le moteur : le carreau vit dans le groupe qui tourne, pas à la racine.
  host.attachSpinningChild(ground);
  host.group.updateMatrixWorld(true);
}

function tileBytes(): ArrayBuffer {
  const id = tileOfLonLat(LON, LAT, ZOOM);
  const [x, y] = quantizeToTile(LON, LAT, id);
  const d = 800;
  return encodeBuildingTile({
    ...id,
    buildings: [
      {
        ring: Uint16Array.from([x, y, x + d, y, x + d, y + d, x, y + d]),
        heightDecimetres: 300,
        origin: HEIGHT_ORIGIN.measured,
      },
    ],
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function layer(host: BuildingHost, urls: string[], rings = 0) {
  return new BuildingLayer({
    host,
    radiusKm: RADIUS_KM,
    set: SET,
    origin: 'https://exemple.test',
    budget: { maxTiles: 9, rings },
    fetchTile: async (url) => {
      urls.push(url);
      return tileBytes();
    },
    now: () => 0,
  });
}

describe('BuildingLayer', () => {
  it('demande la tuile de la visée à l’adresse du jeu, une seule fois', async () => {
    const urls: string[] = [];
    const l = layer(makeHost(), urls);
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    await flush();
    const id = tileOfLonLat(LON, LAT, ZOOM);
    expect(urls).toEqual([
      `https://exemple.test/${SET.directory}/${ZOOM}/${id.column}/${id.row}.bin`,
    ]);
  });

  it('ne rend rien visible tant que le sol rendu n’est pas posé', async () => {
    const host = makeHost();
    const l = layer(host, []);
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    await flush();
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    expect(l.state.loaded).toBe(1);
    expect(l.state.waitingForGround).toBe(1);
    expect(l.state.buildings).toBe(0);
    expect(buildingMeshes(host)[0]!.visible).toBe(false);
  });

  it('pose la tuile sur le sol MESURÉ, pas sur le rayon nominal', async () => {
    const host = makeHost();
    addGround(host, 1.01); // 64 km au-dessus de la sphère nominale : sans ambiguïté
    const l = layer(host, []);
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    await flush();
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    expect(l.state.buildings).toBe(1);
    const mesh = buildingMeshes(host)[0]!;
    expect(mesh.visible).toBe(true);
    expect(mesh.position.length()).toBeCloseTo(1.01, 2);
    const up = geographicToLocalDirection(
      mesh.position.length() ? LAT : 0,
      LON
    );
    // Le centre de la tuile est à ~quelques mètres de la visée : même direction à 1e-3 près.
    expect(mesh.position.clone().normalize().dot(up)).toBeGreaterThan(0.99999);
  });

  it('retire une tuile quand la visée s’en éloigne, et annule ce qui est en vol', async () => {
    const host = makeHost();
    addGround(host, 1);
    const l = layer(host, []);
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    await flush();
    expect(l.state.loaded).toBe(1);
    l.update({ latitudeDeg: -33.9, longitudeDeg: 151.2 });
    expect(l.state.loaded).toBe(0);
    expect(buildingMeshes(host)).toHaveLength(0);
  });

  it('ne demande pas une tuile que le manifeste ne liste pas', async () => {
    const id = tileOfLonLat(LON, LAT, ZOOM);
    const urls: string[] = [];
    const l = new BuildingLayer({
      host: makeHost(),
      radiusKm: RADIUS_KM,
      set: { ...SET, tiles: [{ column: id.column, row: id.row }] },
      origin: 'https://exemple.test',
      budget: { maxTiles: 9, rings: 1 },
      fetchTile: async (url) => {
        urls.push(url);
        return tileBytes();
      },
    });
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    expect(urls).toHaveLength(1);
  });

  it('retient un échec et ne le redemande pas', async () => {
    let calls = 0;
    const l = new BuildingLayer({
      host: makeHost(),
      radiusKm: RADIUS_KM,
      set: SET,
      origin: 'https://exemple.test',
      budget: { maxTiles: 9, rings: 0 },
      fetchTile: async () => {
        calls++;
        throw new Error('HTTP 404');
      },
    });
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    await flush();
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    await flush();
    expect(calls).toBe(1);
    expect(l.state.failed).toBe(1);
  });

  it('respecte le plafond de tuiles, les plus proches d’abord', async () => {
    const urls: string[] = [];
    const l = new BuildingLayer({
      host: makeHost(),
      radiusKm: RADIUS_KM,
      set: SET,
      origin: 'https://exemple.test',
      budget: { maxTiles: 3, rings: 2 },
      fetchTile: async (url) => {
        urls.push(url);
        return tileBytes();
      },
    });
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain(`/${tileOfLonLat(LON, LAT, ZOOM).column}/`);
  });

  it('dispose retire tout', async () => {
    const host = makeHost();
    const l = layer(host, []);
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    await flush();
    l.dispose();
    expect(buildingMeshes(host)).toHaveLength(0);
    l.update({ latitudeDeg: LAT, longitudeDeg: LON });
    expect(l.state.loaded).toBe(0);
  });
});
