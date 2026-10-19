import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EarthEvent, EarthEventLayer } from '@/core/earthEvents';
import type CelestialObject from '@/components/celestial/CelestialObject';
import { EarthEventsOverlay } from './earthEventsOverlay';

/**
 * L'INTERRUPTEUR DES ÉTIQUETTES : éteint, les marqueurs restent et leur texte disparaît.
 *
 * Le canvas est un double qui compte ses appels : `fillText` écrit une étiquette, `arc` un
 * marqueur. Les deux sont mesurés, parce qu'un interrupteur qui retirerait aussi les marqueurs
 * serait le défaut même qu'il corrige (couper la COUCHE coupe déjà tout).
 */
function fakeContext() {
  return {
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 40 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
  };
}

const LAYER = {
  id: 'earthquakes',
  minEarthRadiusPx: 0,
  priority: 0,
  maxMarkers: 10,
} as unknown as EarthEventLayer;

const EVENT = {
  id: 'e1',
  latitudeDeg: 0,
  longitudeDeg: 0,
  label: 'M9.1 Test',
  weight: 0.5,
  color: 0xff0000,
} as unknown as EarthEvent;

describe('EarthEventsOverlay.setLabelsActive', () => {
  let ctx: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    ctx = fakeContext();
    const canvas = {
      id: '',
      width: 0,
      height: 0,
      classList: { toggle: vi.fn() },
      getContext: () => ctx,
      remove: vi.fn(),
    };
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('window', {
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function paint(labels: boolean): void {
    const overlay = new EarthEventsOverlay([LAYER]);
    overlay.setEvents('earthquakes', [EVENT]);
    overlay.setLayerVisible('earthquakes', true);
    overlay.setLabelsActive(labels);

    const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.1, 1000);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const group = new THREE.Group();
    group.userData['radius'] = 1;
    const earth = {
      group,
      // Le point (lat 0, lon 0) est posé face à la caméra, sur la sphère de rayon 1.
      surfacePointToWorld: (_lat: number, _lon: number, out: THREE.Vector3) =>
        out.set(0, 0, 1),
    } as unknown as CelestialObject;
    overlay.update(camera, earth, null);
  }

  it('writes the label when the switch is on', () => {
    paint(true);
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(
      'M9.1 Test',
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('keeps the marker and drops its text when the switch is off', () => {
    paint(false);
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});
