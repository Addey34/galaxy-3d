import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type CelestialObject from '@/components/celestial/CelestialObject';
import { GazetteerOverlay } from './gazetteerOverlay';

/**
 * LA COUCHE DES NOMS NE REPEINT QUE SI LA VUE A CHANGÉ (2026-10-29) : vider et repeindre un
 * canvas plein écran coûte surtout du travail natif du navigateur. Ce qui est peint, les témoins
 * lus par l'e2e (`data-*`) et les noms cliquables (`placeAt`) restent ceux de la dernière image
 * peinte ; une rotation de la cible, un déplacement de la caméra ou la perte de la cible les
 * remettent à jour.
 */
let clears = 0;
let texts: string[] = [];
const dataset: Record<string, string> = {};

beforeEach(() => {
  clears = 0;
  texts = [];
  for (const k of Object.keys(dataset)) delete dataset[k];
  const ctx = {
    clearRect: () => clears++,
    fillText: (t: string) => texts.push(t),
    measureText: () => ({ width: 40 }),
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    setTransform: () => undefined,
    font: '',
    fillStyle: '',
  };
  vi.stubGlobal('window', {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
  });
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ctx,
      dataset,
      classList: { toggle: () => undefined },
      style: {},
    }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          name: 'Alpha',
          code: 'CR',
          type: 'Crater',
          lat: 0,
          lon: 0,
          diameterKm: 0,
        },
      ],
    }))
  );
});
afterEach(() => vi.unstubAllGlobals());

/** Un corps de rayon 1 à l'origine ; le point visé est face à la caméra, sur l'axe +x. */
function target(): CelestialObject {
  const group = new THREE.Group();
  group.userData['radius'] = 1;
  group.updateMatrixWorld(true);
  return {
    group,
    surfacePointToWorld: (_lat: number, _lon: number, out: THREE.Vector3) =>
      out.set(1, 0, 0),
  } as unknown as CelestialObject;
}

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(55, 1280 / 800, 1e-3, 1e4);
  c.position.set(3, 0, 0);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

async function loaded(
  o: GazetteerOverlay,
  cam: THREE.PerspectiveCamera,
  t: CelestialObject
): Promise<void> {
  o.draw(cam, t, 'moon', null); // lance le chargement du répertoire
  await new Promise((r) => setTimeout(r, 0));
}

function overlay(): GazetteerOverlay {
  const o = new GazetteerOverlay(new Map([['moon', 1737]]));
  o.setActive(true);
  return o;
}

describe('couche des noms : pas de repeinture sans changement', () => {
  it('peint une fois, garde les noms cliquables, repeint quand la cible tourne', async () => {
    const o = overlay();
    const cam = camera();
    const t = target();
    await loaded(o, cam, t);

    o.draw(cam, t, 'moon', null);
    expect(texts).toEqual(['Alpha']);
    expect(dataset['names']).toBe('1');
    const clearsAfterFirst = clears;

    // Rien n'a bougé : ni nouvelle repeinture, ni témoins perdus, ni nom injoignable.
    o.draw(cam, t, 'moon', null);
    o.draw(cam, t, 'moon', null);
    expect(clears).toBe(clearsAfterFirst);
    expect(texts).toEqual(['Alpha']);
    expect(dataset['names']).toBe('1');
    expect(o.placeAt(668, 400)?.name).toBe('Alpha');

    // La surface tourne : un nom suit sa surface, donc la couche repeint.
    t.group.rotation.y += 0.01;
    t.group.updateMatrixWorld(true);
    o.draw(cam, t, 'moon', null);
    expect(clears).toBeGreaterThan(clearsAfterFirst);
    expect(texts).toEqual(['Alpha', 'Alpha']);
  });

  it('remet les témoins à zéro quand la cible disparaît, et repeint au retour', async () => {
    const o = overlay();
    const cam = camera();
    const t = target();
    await loaded(o, cam, t);
    o.draw(cam, t, 'moon', null);
    expect(dataset['names']).toBe('1');

    o.draw(cam, undefined, null, null);
    expect(dataset['names']).toBe('0');
    expect(o.placeAt(668, 400)).toBeNull();

    o.draw(cam, t, 'moon', null);
    expect(dataset['names']).toBe('1');
    expect(o.placeAt(668, 400)?.name).toBe('Alpha');
  });
});
