import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSmallBodyDataset } from '@/core/sbdb';
import { POSITION_REFRESH_MS, SmallBodyOverlay } from './smallBodyOverlay';

/**
 * LES POSITIONS DU CHAMP NE SE RECALCULENT QU'AVEC LA DATE (lot 54) : la projection suit la
 * caméra à chaque image, la résolution de Kepler non. Et ce qui est dessiné reste ce que dessinait
 * le calcul à chaque image, tant que la date n'a pas bougé de plus que `POSITION_REFRESH_MS`.
 */
const dataset = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../public/assets/small-bodies/dataset.json'),
    'utf-8'
  )
) as Parameters<typeof parseSmallBodyDataset>[0];

let rects: string[] = [];
beforeEach(() => {
  rects = [];
  const ctx = {
    fillRect: (x: number, y: number) =>
      rects.push(`${x.toFixed(3)},${y.toFixed(3)}`),
    clearRect: () => undefined,
    setTransform: () => undefined,
    fillStyle: '',
  };
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ctx,
      dataset: {},
      classList: { toggle: () => undefined },
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function overlay(): SmallBodyOverlay {
  const o = new SmallBodyOverlay();
  o.setBodies(parseSmallBodyDataset(dataset).bodies);
  o.setActive(true);
  return o;
}

/** Une caméra d'Explo près de la Terre, regardant la ceinture principale. */
function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(55, 1280 / 800, 1e-6, 1e6);
  c.position.set(36, 0, 0);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

describe('champ des petits corps : positions mises en cache par date (lot 54)', () => {
  it('ne résout Kepler qu’une fois tant que la date bouge de moins que le seuil', () => {
    const o = overlay();
    const n = parseSmallBodyDataset(dataset).bodies.length;
    const t0 = Date.parse('2024-07-01T12:00:00Z');
    const cam = camera();
    for (let i = 0; i < 10; i += 1) o.update(cam, new Date(t0 + i * 16), 1);
    expect(o.solves).toBe(n);
    o.update(cam, new Date(t0 + POSITION_REFRESH_MS + 1), 1);
    expect(o.solves).toBe(2 * n);
    // Un saut en ARRIÈRE compte autant qu'un saut en avant.
    o.update(cam, new Date(t0 - POSITION_REFRESH_MS * 3), 1);
    expect(o.solves).toBe(3 * n);
  });

  it('dessine exactement ce que dessine un calcul neuf à la même date', () => {
    const cam = camera();
    const t = new Date('2024-07-01T12:00:00Z');
    const cached = overlay();
    cached.update(cam, new Date(t.getTime() - 5_000), 1);
    rects.splice(0);
    // Un changement de filtre force la repeinture, avec les positions encore en cache.
    cached.setVisibleCategories(new Set(['main-belt', 'neo', 'comet', 'tno']));
    cached.update(cam, t, 1);
    // Le cache date de 5 s plus tôt : comparé à un calcul neuf, l'écart reste sous le pixel.
    const fromCache = rects.splice(0);
    overlay().update(cam, t, 1);
    const fresh = rects.splice(0);
    expect(fromCache.length).toBe(fresh.length);
    expect(fresh.length).toBeGreaterThan(100);
    const maxGap = Math.max(
      ...fromCache.map((r, i) => {
        const [x1, y1] = r.split(',').map(Number) as [number, number];
        const [x2, y2] = fresh[i]!.split(',').map(Number) as [number, number];
        return Math.hypot(x1 - x2, y1 - y2);
      })
    );
    expect(maxGap).toBeLessThan(1);
  });
});

describe('champ des petits corps : pas de repeinture sans changement', () => {
  it('ne repeint pas quand caméra, date et filtres sont inchangés, et repeint dès que la caméra bouge', () => {
    const o = overlay();
    const cam = camera();
    const t = new Date('2024-07-01T12:00:00Z');
    o.update(cam, t, 1);
    expect(rects.length).toBeGreaterThan(0);
    rects.splice(0);
    o.update(cam, new Date(t.getTime() + 16), 1);
    expect(rects.length).toBe(0);
    cam.position.set(36, 0, 0.5);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    o.update(cam, t, 1);
    expect(rects.length).toBeGreaterThan(0);
  });
});
