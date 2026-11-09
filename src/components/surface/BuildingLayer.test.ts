import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
  HEIGHT_ORIGIN,
  encodeBuildingTile,
  tileOfLonLat,
} from '@/core/buildingTile';
import { quantizeToTile } from '@/core/buildingTile';
import { geographicToLocalDirection } from '@/core/frames';
import { HttpStatusError, type FailureRecord } from '@/core/fetchRetry';
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

  /** Couche à horloge simulée dont le fetcher suit un scénario (une entrée par appel). */
  function scripted(
    script: Array<() => Promise<ArrayBuffer>>,
    shared?: {
      failures?: Map<string, FailureRecord>;
      set?: BuildingSetManifest;
    }
  ) {
    const clock = { t: 0 };
    let calls = 0;
    const signals: AbortSignal[] = [];
    const urls: string[] = [];
    const l = new BuildingLayer({
      host: makeHost(),
      radiusKm: RADIUS_KM,
      set: shared?.set ?? SET,
      origin: 'https://exemple.test',
      budget: { maxTiles: 9, rings: 0 },
      ...(shared?.failures ? { failures: shared.failures } : {}),
      fetchTile: (url, signal) => {
        urls.push(url);
        signals.push(signal);
        const step = script[Math.min(calls, script.length - 1)]!;
        calls++;
        return step();
      },
      now: () => clock.t,
    });
    const tick = async (): Promise<void> => {
      l.update({ latitudeDeg: LAT, longitudeDeg: LON });
      await flush();
    };
    const home = (): number =>
      urls.filter((u) => u.endsWith(`/${tileOfLonLat(LON, LAT, ZOOM).row}.bin`))
        .length;
    return { l, clock, tick, signals, calls: () => calls, home };
  }
  const http =
    (status: number, retryAfterMs: number | null = null) =>
    () =>
      Promise.reject(new HttpStatusError(status, retryAfterMs));

  it('un 404 est définitif : une seule requête', async () => {
    const s = scripted([http(404)]);
    await s.tick();
    s.clock.t = 1e9;
    await s.tick();
    expect(s.calls()).toBe(1);
    expect(s.l.state.failed).toBe(1);
    expect(s.l.state.retrying).toBe(0);
  });

  it('une coupure réseau puis un succès : redemandée après le retard, posée, échec effacé', async () => {
    const s = scripted([
      () => Promise.reject(new TypeError('Failed to fetch')),
      async () => tileBytes(),
    ]);
    await s.tick();
    expect(s.l.state.retrying).toBe(1);
    s.clock.t = 1499;
    await s.tick();
    expect(s.calls()).toBe(1);
    s.clock.t = 2000;
    await s.tick();
    expect(s.calls()).toBe(2);
    expect(s.l.state.loaded).toBe(1);
    expect(s.l.state.retrying).toBe(0);
    expect(s.l.state.failed).toBe(0);
  });

  it('un 503 sans Retry-After lisible attend le plancher de 8 s ; un 429 avec Retry-After plus long l’attend', async () => {
    const s = scripted([
      http(503),
      http(429, 300_000),
      async () => tileBytes(),
    ]);
    await s.tick();
    s.clock.t = 8000;
    await s.tick();
    expect(s.calls()).toBe(2);
    s.clock.t = 8000 + 299_999;
    await s.tick();
    expect(s.calls()).toBe(2);
    s.clock.t = 8000 + 300_000;
    await s.tick();
    expect(s.calls()).toBe(3);
    expect(s.l.state.loaded).toBe(1);
  });

  it('un 503 avec Retry-After de 7 200 s : aucune requête avant l’échéance, une seule après', async () => {
    const s = scripted([http(503, 7_200_000), async () => tileBytes()]);
    await s.tick();
    s.clock.t = 3_600_001; // au-delà de l’ancien plafond d’une heure
    for (let i = 0; i < 20; i++) await s.tick();
    expect(s.calls()).toBe(1);
    s.clock.t = 7_199_999;
    await s.tick();
    expect(s.calls()).toBe(1);
    s.clock.t = 7_200_000;
    await s.tick();
    expect(s.calls()).toBe(2);
    expect(s.l.state.loaded).toBe(1);
  });

  it('100 images dans la fenêtre d’attente : une seule requête, pas de tempête', async () => {
    const s = scripted([http(503)]);
    await s.tick();
    for (let i = 0; i < 100; i++) await s.tick();
    expect(s.calls()).toBe(1);
  });

  it('une panne persistante ne devient jamais définitive : une redemande par échéance, même en bougeant la visée', async () => {
    const s = scripted([http(503)]);
    for (let i = 0; i < 20; i++) {
      s.clock.t += 100_000;
      s.l.update({ latitudeDeg: LAT + 5, longitudeDeg: LON }); // la tuile sort du champ
      await flush();
      await s.tick(); // et revient
    }
    expect(s.home()).toBe(20);
    expect(s.l.state.retrying).toBeGreaterThanOrEqual(1);
    expect(s.l.state.failed).toBe(0);
  });

  it('au rythme réel, une panne longue redemande une fois toutes les 45 à 60 s au plus par tuile', async () => {
    const s = scripted([http(503)]);
    for (let t = 0; t <= 600_000; t += 1000) {
      s.clock.t = t;
      await s.tick();
    }
    // 10 minutes de panne : 8 s, 8 s, 8 s puis 12 à 16 s, 24 à 32 s, 45 à 60 s, puis une toutes les 45 à 60 s.
    expect(s.home()).toBeGreaterThanOrEqual(9);
    expect(s.home()).toBeLessThanOrEqual(16);
    expect(s.l.state.failed).toBe(0);
  });

  it('un 429 sans Retry-After lisible n’est pas redemandé avant 8 s', async () => {
    const s = scripted([http(429), async () => tileBytes()]);
    await s.tick();
    s.clock.t = 7999;
    await s.tick();
    expect(s.calls()).toBe(1);
    s.clock.t = 8000;
    await s.tick();
    expect(s.calls()).toBe(2);
  });

  it('la panne persiste au-delà de la couche : une couche neuve attend l’échéance puis récupère', async () => {
    const store = new Map<string, FailureRecord>();
    const first = scripted([http(503)], { failures: store });
    for (let i = 0; i < 10; i++) {
      first.clock.t += 100_000;
      await first.tick();
    }
    expect(first.home()).toBe(10);
    expect(first.l.state.failed).toBe(0);
    expect(first.l.state.retrying).toBe(1);
    first.l.dispose();
    // « suspend → reprise » : une couche neuve sur le même magasin et le même jeu. Avant
    // l'échéance, rien ; après, la tuile est redemandée et récupérée.
    const second = scripted([async () => tileBytes()], { failures: store });
    second.clock.t = first.clock.t; // le retard n'est pas écoulé : retryAt vient de l'horloge de la première
    const retryAt = [...store.values()][0]!.retryAt;
    second.clock.t = retryAt - 1;
    await second.tick();
    expect(second.home()).toBe(0);
    second.clock.t = retryAt;
    await second.tick();
    expect(second.home()).toBe(1);
    expect(second.l.state.loaded).toBe(1);
    expect(store.size).toBe(0);
  });

  it('le compte d’échecs survit à la couche : il continue de croître, sans jamais condamner', async () => {
    const store = new Map<string, FailureRecord>();
    const first = scripted([http(503)], { failures: store });
    for (let i = 0; i < 2; i++) {
      first.clock.t += 100_000;
      await first.tick();
    }
    expect(first.home()).toBe(2);
    first.l.dispose();
    const second = scripted([http(503)], { failures: store });
    second.clock.t = 1e9;
    for (let i = 0; i < 10; i++) {
      second.clock.t += 100_000;
      await second.tick();
    }
    expect(second.home()).toBe(10);
    expect([...store.values()][0]).toMatchObject({
      kind: 'transient',
      attempts: 12,
    });
  });

  it('le jeu fait partie de la clé : un autre jeu a son propre budget', async () => {
    const store = new Map<string, FailureRecord>();
    const first = scripted([http(404)], { failures: store });
    await first.tick();
    first.l.dispose();
    const other = scripted([http(404)], {
      failures: store,
      set: { ...SET, id: 'autre' },
    });
    await other.tick();
    expect(other.home()).toBe(1);
    expect(other.l.state.failed).toBe(1);
  });

  it('un binaire invalide est définitif, même quand le décodeur lève une TypeError', async () => {
    const s = scripted([async () => new ArrayBuffer(3)]);
    await s.tick();
    s.clock.t = 1e9;
    await s.tick();
    expect(s.calls()).toBe(1);
    expect(s.l.state.failed).toBe(1);
  });

  it('une erreur levée par la pose est définitive, pas une panne réseau', async () => {
    const s = scripted([async () => tileBytes()]);
    const place = vi
      .spyOn(s.l as unknown as { _place: () => void }, '_place')
      .mockImplementation(() => {
        throw new TypeError('géométrie');
      });
    await s.tick();
    s.clock.t = 1e9;
    await s.tick();
    expect(place).toHaveBeenCalledTimes(1);
    expect(s.calls()).toBe(1);
    expect(s.l.state.failed).toBe(1);
  });

  it('une erreur tardive d’une requête annulée ne compte pas', async () => {
    const fails: Array<(e: unknown) => void> = [];
    const s = scripted([
      () => new Promise<ArrayBuffer>((_, r) => fails.push(r)),
    ]);
    await s.tick();
    // la visée s’éloigne : la requête est annulée
    s.l.update({ latitudeDeg: LAT + 5, longitudeDeg: LON });
    expect(s.signals[0]!.aborted).toBe(true);
    fails[0]!(new Error('boom (pas un AbortError)'));
    await flush();
    expect(s.l.state.failed).toBe(0);
    expect(s.l.state.retrying).toBe(0);
  });

  it('une réponse tardive d’une requête annulée ne pose rien', async () => {
    const resolves: Array<(b: ArrayBuffer) => void> = [];
    const s = scripted([
      () => new Promise<ArrayBuffer>((r) => resolves.push(r)),
    ]);
    await s.tick();
    s.l.update({ latitudeDeg: LAT + 5, longitudeDeg: LON });
    resolves[0]!(tileBytes());
    await flush();
    expect(s.l.state.loaded).toBe(0);
  });

  it('après dispose, ni échec compté ni requête, qu’il s’agisse d’une réponse ou d’une erreur', async () => {
    let fail!: (e: unknown) => void;
    const s = scripted([() => new Promise<ArrayBuffer>((_, r) => (fail = r))]);
    await s.tick();
    s.l.dispose();
    fail(new HttpStatusError(503));
    await flush();
    s.clock.t = 1e9;
    await s.tick();
    expect(s.calls()).toBe(1);
    expect(s.l.state.failed + s.l.state.retrying).toBe(0);
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
