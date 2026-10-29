import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabelSpace } from '@/core/labelSpace';
import type { HorizonsEphemerisService } from '@/core/HorizonsEphemerisService';
import type { SpacecraftMission } from '@/config/spacecraft';
import { SpacecraftOverlay } from './spacecraftOverlay';

/**
 * LA COUCHE DES SONDES NE REPEINT QUE SI UN MARQUEUR A BOUGÉ (2026-10-29) : vider et repeindre
 * un canvas plein écran coûte surtout du travail natif du navigateur. La comparaison porte sur les
 * positions écran à 0,25 px près. Sauter une image ne doit JAMAIS faire perdre à `LabelSpace` les
 * emprises de la couche : les couches suivantes (noms de surface, événements) s'en servent pour
 * ne pas écrire par-dessus.
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
    addEventListener: () => undefined,
  });
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ctx,
      dataset,
      classList: { toggle: () => undefined },
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

const mission = {
  name: 'Voyager 1',
  displayName: { en: 'Voyager 1', fr: 'Voyager 1' },
  color: 0xffffff,
} as unknown as SpacecraftMission;

/** Une sonde à une position scène réglable, sans passer par les éphémérides. */
let probe = new THREE.Vector3(0, 0, 0);
const horizons = {
  getHeliocentricAU: () => new THREE.Vector3(1, 0, 0),
} as unknown as HorizonsEphemerisService;
const place = (out: THREE.Vector3): THREE.Vector3 => out.copy(probe);

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(55, 1280 / 800, 1e-3, 1e4);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

function overlay(): SpacecraftOverlay {
  probe = new THREE.Vector3(0, 0, 0);
  const o = new SpacecraftOverlay([mission]);
  o.setActive(true);
  o.setTarget('Voyager 1');
  return o;
}

const DATE = new Date('2024-07-01T12:00:00Z');

describe('couche des sondes : pas de repeinture sans changement', () => {
  it('ne repeint pas une vue identique, et redéclare ses emprises à LabelSpace', () => {
    const o = overlay();
    const cam = camera();
    const space = new LabelSpace();
    o.update(cam, DATE, horizons, place, 1, space);
    expect(texts).toEqual(['Voyager 1']);
    expect(o.markerAt(640, 400)).toBe('Voyager 1');
    const painted = clears;
    const claimed = space.size;
    expect(claimed).toBeGreaterThan(0);

    // Image suivante : `LabelSpace` repart à zéro (comme `labelSpace.reset()` à chaque image).
    space.reset();
    o.update(cam, DATE, horizons, place, 1, space);
    expect(clears).toBe(painted);
    expect(texts).toEqual(['Voyager 1']);
    // Les couches suivantes retrouvent la place prise par cette couche.
    expect(space.size).toBe(claimed);
    expect(o.markerAt(640, 400)).toBe('Voyager 1');
  });

  it('repeint dès qu’un marqueur bouge d’au moins un quart de pixel', () => {
    const o = overlay();
    const cam = camera();
    o.update(cam, DATE, horizons, place, 1, null);
    const painted = clears;

    probe.set(1e-6, 0, 0); // bien moins qu'un quart de pixel
    o.update(cam, DATE, horizons, place, 1, null);
    expect(clears).toBe(painted);

    probe.set(0.5, 0, 0); // plusieurs pixels
    o.update(cam, DATE, horizons, place, 1, null);
    expect(clears).toBeGreaterThan(painted);
  });

  it('repeint quand un réglage change sans que la vue bouge', () => {
    const o = overlay();
    const cam = camera();
    o.update(cam, DATE, horizons, place, 1, null);
    const painted = clears;
    o.setHiddenLabelNames(new Set(['Voyager 1']));
    // La sonde est la cible : son nom reste. Un autre réglage, lui, doit repeindre.
    o.update(cam, DATE, horizons, place, 1, null);
    expect(clears).toBeGreaterThan(painted);
  });
});
