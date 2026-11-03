import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { equatorialToScene } from '@/core/frames';
import type { StarRow } from '@/core/starCatalogue';
import { Starfield } from './Starfield';

// Sirius (J2000, 2,64 pc, fort mouvement propre) et une étoile fixe du pôle nord.
const SIRIUS: StarRow = [
  101.2875,
  -16.7161,
  -1.44,
  0,
  2.64,
  -546,
  -1223,
  -5.5,
  'Sirius',
];
const POLE: StarRow = [0, 89.9, 5, 0.6, 99999, 0, 0, 0, ''];

const J2000 = new Date(Date.UTC(2000, 0, 1, 12));

function positionOf(field: Starfield, i: number): THREE.Vector3 {
  const a = field.points.geometry.getAttribute('position');
  return new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i));
}

describe('Starfield', () => {
  it('place chaque étoile là où frames.equatorialToScene la met, sur la sphère céleste', () => {
    const field = new Starfield();
    field.setCatalogue([SIRIUS, POLE], J2000);
    const p = positionOf(field, 0);
    const a = (SIRIUS[0] * Math.PI) / 180;
    const d = (SIRIUS[1] * Math.PI) / 180;
    const expected = equatorialToScene(
      Math.cos(d) * Math.cos(a),
      Math.cos(d) * Math.sin(a),
      Math.sin(d)
    ).multiplyScalar(p.length());
    expect(p.distanceTo(expected)).toBeLessThan(1e-2);
    expect(p.length()).toBeGreaterThan(1000);
    expect(field.count).toBe(2);
    expect(field.source).toBe('catalogue');
  });

  it('déplace une étoile à mouvement propre fort avec la date, et pas une étoile fixe', () => {
    const field = new Starfield();
    field.setCatalogue([SIRIUS, POLE], J2000);
    const s0 = positionOf(field, 0);
    const f0 = positionOf(field, 1);
    field.setDate(new Date(Date.UTC(5000, 0, 1)));
    expect(positionOf(field, 0).distanceTo(s0)).toBeGreaterThan(50);
    expect(positionOf(field, 1).distanceTo(f0)).toBeLessThan(0.01);
  });

  it("ne recalcule rien tant que la date n'a pas avancé de plus d'un quart d'année", () => {
    const field = new Starfield();
    field.setCatalogue([SIRIUS], J2000);
    const spy = vi.spyOn(
      field.points.geometry.getAttribute('position'),
      'setXYZ'
    );
    field.setDate(new Date(J2000.getTime() + 10 * 86_400_000));
    expect(spy).not.toHaveBeenCalled();
    field.setDate(new Date(J2000.getTime() + 400 * 86_400_000));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retombe sur le semis procédural, et le dit, quand le fichier est illisible', async () => {
    const field = new Starfield();
    const failing = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await field.load(failing as unknown as typeof fetch, '/absent.json');
    expect(field.source).toBe('procedural');
    expect(field.count).toBe(2500);
  });

  it("charge un catalogue lisible et n'est visible qu'ensuite", async () => {
    const field = new Starfield();
    expect(field.points.visible).toBe(false);
    const ok = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stars: [SIRIUS, POLE] }),
    });
    await field.load(ok as unknown as typeof fetch);
    expect(field.source).toBe('catalogue');
    expect(field.points.visible).toBe(true);
  });
});

describe('Starfield : figures des constellations', () => {
  const FIGURES = { constellations: [{ id: 'X', name: 'X', lines: [[0, 1]] }] };

  it('sont éteintes par défaut et ne se montrent que sur demande', () => {
    const field = new Starfield();
    field.setCatalogue([SIRIUS, POLE], J2000);
    field.setConstellations(FIGURES);
    expect(field.hasConstellations).toBe(true);
    const lines = field.points.getObjectByName('constellations')!;
    expect(lines.visible).toBe(false);
    field.setConstellationsVisible(true);
    expect(lines.visible).toBe(true);
  });

  it('suivent les étoiles : elles partagent le tampon de positions, donc la date les déplace', () => {
    const field = new Starfield();
    field.setCatalogue([SIRIUS, POLE], J2000);
    field.setConstellations(FIGURES);
    const lines = field.points.getObjectByName(
      'constellations'
    ) as THREE.LineSegments;
    const attr = lines.geometry.getAttribute('position');
    expect(attr).toBe(field.points.geometry.getAttribute('position'));
    const before = new THREE.Vector3().fromBufferAttribute(attr, 0);
    field.setDate(new Date(Date.UTC(5000, 0, 1)));
    expect(
      new THREE.Vector3().fromBufferAttribute(attr, 0).distanceTo(before)
    ).toBeGreaterThan(50);
  });

  it("un fichier de figures illisible n'ôte rien aux étoiles", async () => {
    const field = new Starfield();
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('constellations')
        ? { ok: false, status: 404 }
        : { ok: true, json: async () => ({ stars: [SIRIUS, POLE] }) }
    );
    await field.load(fetcher as unknown as typeof fetch);
    expect(field.source).toBe('catalogue');
    expect(field.hasConstellations).toBe(false);
    expect(field.count).toBe(2);
  });
});
