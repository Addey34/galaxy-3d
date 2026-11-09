import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpStatusError, PermanentFetchError } from '@/core/fetchRetry';
import {
  createBuildingsOverlay,
  type BuildingTarget,
} from './buildingsOverlay';

/**
 * L'ÉCRAN DES BÂTIMENTS ET LES PANNES PASSAGÈRES (GAL-A002) : l'index et les manifestes sont lus par
 * un `fetchJson` injecté et une horloge simulée. Rien ne touche le réseau : les tuiles de la couche
 * créée en fin de chaîne sont refusées par un `fetch` global factice.
 */

const LAT = 48.86;
const LON = 2.34;

const INDEX = {
  sets: [
    {
      id: 'essai',
      body: 'earth',
      bboxLonLat: [2.2, 48.8, 2.5, 48.9],
      manifest: 'assets/buildings/essai/manifest.json',
    },
  ],
};

const MANIFEST = {
  id: 'essai',
  body: 'earth',
  title: 'essai',
  zoom: 14,
  directory: 'assets/buildings/essai/abc',
  bboxLonLat: [2.2, 48.8, 2.5, 48.9],
  source: {
    name: 'x',
    license: 'x',
    licenseUrl: 'x',
    attribution: 'x',
    readFrom: 'x',
    readTo: 'x',
  },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeHost(): BuildingTarget {
  const group = new THREE.Object3D();
  const spinning = new THREE.Object3D();
  group.add(spinning);
  return {
    name: 'Terre',
    layerRadius: 1,
    group,
    attachSpinningChild: (o) => spinning.add(o),
    worldPointToGeographic: () => ({ latitudeDeg: LAT, longitudeDeg: LON }),
  };
}

type Responder = (url: string) => Promise<unknown>;

function setup(respond: Responder) {
  const clock = { t: 0 };
  const urls: string[] = [];
  const mount = {
    hidden: true,
    replaceChildren: () => undefined,
  } as unknown as HTMLElement;
  const overlay = createBuildingsOverlay(mount, {
    fetchJson: (url) => {
      urls.push(url);
      return respond(url);
    },
    now: () => clock.t,
  });
  const host = makeHost();
  const tick = async (): Promise<void> => {
    overlay.update({
      bodyId: 'earth',
      host,
      radiusKm: 6371,
      cameraPosition: new THREE.Vector3(),
    });
    await flush();
  };
  const count = (suffix: string): number =>
    urls.filter((u) => u.endsWith(suffix)).length;
  return { overlay, clock, tick, count, urls };
}

/** Une réponse JSON dont le corps est celui qu'on donne (ou interrompu en route). */
const jsonResponse = (body: string | ReadableStream<Uint8Array>): Response =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('buildingsOverlay : pannes de l’index et des manifestes', () => {
  beforeEach(() => {
    // Les tuiles de la couche créée en fin de chaîne : refusées, hors réseau.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('un index valide n’est plus jamais redemandé : 100 appels à update()', async () => {
    const s = setup(async (url) =>
      url.endsWith('index.json')
        ? INDEX
        : Promise.reject(new HttpStatusError(404))
    );
    await s.tick();
    for (let i = 0; i < 100; i++) await s.tick();
    expect(s.count('index.json')).toBe(1);
  });

  it('un index en vol n’est pas redemandé non plus', async () => {
    let release!: (v: unknown) => void;
    const s = setup(() => new Promise((r) => (release = r)));
    for (let i = 0; i < 100; i++) await s.tick();
    expect(s.count('index.json')).toBe(1);
    release(INDEX);
  });

  it('un index en 503 est redemandé après le retard, puis gardé', async () => {
    let n = 0;
    const s = setup(async (url) => {
      if (url.endsWith('index.json')) {
        if (n++ === 0) throw new HttpStatusError(503);
        return INDEX;
      }
      throw new HttpStatusError(404);
    });
    await s.tick();
    s.clock.t = 7999;
    for (let i = 0; i < 50; i++) await s.tick();
    expect(s.count('index.json')).toBe(1);
    s.clock.t = 8000;
    await s.tick();
    for (let i = 0; i < 50; i++) await s.tick();
    expect(s.count('index.json')).toBe(2);
  });

  it('un index en 404 ou qui n’est pas du JSON est définitif', async () => {
    for (const failure of [
      new HttpStatusError(404),
      new PermanentFetchError('réponse non JSON'),
    ]) {
      const s = setup(() => Promise.reject(failure));
      await s.tick();
      s.clock.t = 1e9;
      await s.tick();
      expect(s.count('index.json')).toBe(1);
    }
  });

  it('un index invalide (JSON sans « sets ») est définitif', async () => {
    const s = setup(async () => ({ pas: 'un index' }));
    await s.tick();
    s.clock.t = 1e9;
    await s.tick();
    expect(s.count('index.json')).toBe(1);
  });

  it('un manifeste en 503 est redemandé après le retard, puis gardé', async () => {
    let n = 0;
    const s = setup(async (url) => {
      if (url.endsWith('index.json')) return INDEX;
      if (n++ === 0) throw new HttpStatusError(503);
      return MANIFEST;
    });
    await s.tick();
    await s.tick();
    expect(s.count('manifest.json')).toBe(1);
    s.clock.t = 7999;
    for (let i = 0; i < 50; i++) await s.tick();
    expect(s.count('manifest.json')).toBe(1);
    s.clock.t = 8000;
    await s.tick();
    for (let i = 0; i < 50; i++) await s.tick();
    expect(s.count('manifest.json')).toBe(2);
    expect(s.overlay.state.setId).toBe('essai');
    s.overlay.suspend();
  });

  it('un manifeste en 404 est définitif', async () => {
    const s = setup(async (url) => {
      if (url.endsWith('index.json')) return INDEX;
      throw new HttpStatusError(404);
    });
    await s.tick();
    await s.tick();
    s.clock.t = 1e9;
    for (let i = 0; i < 20; i++) await s.tick();
    expect(s.count('manifest.json')).toBe(1);
  });

  it('un manifeste invalide est définitif', async () => {
    const s = setup(async (url) =>
      url.endsWith('index.json') ? INDEX : { id: 3 }
    );
    await s.tick();
    await s.tick();
    s.clock.t = 1e9;
    for (let i = 0; i < 20; i++) await s.tick();
    expect(s.count('manifest.json')).toBe(1);
  });

  it('un manifeste en panne persistante n’est jamais abandonné mais redemandé au plus toutes les 45 à 60 s', async () => {
    const s = setup(async (url) => {
      if (url.endsWith('index.json')) return INDEX;
      throw new HttpStatusError(503);
    });
    await s.tick();
    // Dix minutes de panne, une image par seconde.
    for (let i = 0; i < 600; i++) {
      s.clock.t += 1000;
      await s.tick();
    }
    expect(s.count('manifest.json')).toBeGreaterThanOrEqual(9);
    expect(s.count('manifest.json')).toBeLessThanOrEqual(16);
  });

  it('un JSON mal formé servi en 200 est définitif : une seule requête', async () => {
    const fetchMock = vi.fn(async () => jsonResponse('{"sets": ['));
    vi.stubGlobal('fetch', fetchMock);
    const clock = { t: 0 };
    const mount = { hidden: true } as unknown as HTMLElement;
    const overlay = createBuildingsOverlay(mount, { now: () => clock.t });
    const host = makeHost();
    const tick = async (): Promise<void> => {
      overlay.update({
        bodyId: 'earth',
        host,
        radiusKm: 6371,
        cameraPosition: new THREE.Vector3(),
      });
      await flush();
    };
    await tick();
    clock.t = 1e9;
    for (let i = 0; i < 20; i++) await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un corps interrompu en route reste une panne passagère : redemandé après le retard', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      if (n++ === 0)
        return jsonResponse(
          new ReadableStream<Uint8Array>({
            start: (c) => c.error(new TypeError('network error')),
          })
        );
      return jsonResponse(JSON.stringify(INDEX));
    });
    vi.stubGlobal('fetch', fetchMock);
    const clock = { t: 0 };
    const overlay = createBuildingsOverlay(
      { hidden: true } as unknown as HTMLElement,
      { now: () => clock.t }
    );
    const host = makeHost();
    const tick = async (): Promise<void> => {
      overlay.update({
        bodyId: 'earth',
        host,
        radiusKm: 6371,
        cameraPosition: new THREE.Vector3(),
      });
      await flush();
    };
    await tick();
    clock.t = 1499;
    for (let i = 0; i < 20; i++) await tick();
    const indexCalls = (): number =>
      fetchMock.mock.calls.filter((c) =>
        String(c[0 as never]).endsWith('index.json')
      ).length;
    expect(indexCalls()).toBe(1);
    clock.t = 2000;
    await tick();
    for (let i = 0; i < 5; i++) await tick();
    expect(indexCalls()).toBe(2);
  });

  it('suspend puis reprise : le compte d’échecs des tuiles survit, aucune rafale au retour', async () => {
    const tileCalls = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        tileCalls.set(url, (tileCalls.get(url) ?? 0) + 1);
        return new Response(null, { status: 503 });
      })
    );
    const s = setup(async (url) =>
      url.endsWith('index.json') ? INDEX : MANIFEST
    );
    await s.tick();
    await s.tick();
    for (let i = 0; i < 12; i++) {
      s.clock.t += 100_000;
      await s.tick();
    }
    expect(tileCalls.size).toBeGreaterThan(0);
    const before = new Map(tileCalls);
    expect([...before.values()].every((n) => n === 12)).toBe(true);
    // Sortie de la zone ou caméra remontée : la couche est détruite, puis recréée.
    s.overlay.suspend();
    for (let i = 0; i < 12; i++) {
      s.clock.t += 100_000;
      await s.tick();
    }
    // Chaque tuile n'est redemandée qu'une fois par échéance, couche détruite ou non : 12 pas
    // de 100 s de plus, au plus 12 requêtes de plus par tuile (jamais une rafale à la reprise).
    expect(
      [...tileCalls].every(([u, n]) => n - (before.get(u) ?? 0) <= 12)
    ).toBe(true);
    s.overlay.suspend();
  });
});
