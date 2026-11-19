/**
 * Vent et données absentes (GAL-METEO-DATA-001) : une cellule sans donnée ne fait ni dériver ni
 * dessiner la particule, ne laisse aucune valeur invalide dans les buffers, et un retour à un
 * champ valide rétablit le mouvement. Fixtures synthétiques seulement.
 */
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { WindParticles } from './WindParticles';
import type { WindGrid } from '@/core/windField';

const NLAT = 19;
const NLON = 36;

function field(u: number, v: number): WindGrid {
  return {
    step: 10,
    latMin: -90,
    lonMin: -180,
    nLat: NLAT,
    nLon: NLON,
    u: new Float32Array(NLAT * NLON).fill(u),
    v: new Float32Array(NLAT * NLON).fill(v),
  };
}

/** Le même champ, mais avec `holes` : cellules (rangée, colonne) rendues inconnues. */
function withHoles(
  base: WindGrid,
  holes: ReadonlyArray<readonly [number, number]>
): WindGrid {
  const g: WindGrid = { ...base, u: base.u.slice(), v: base.v.slice() };
  for (const [r, c] of holes) {
    g.u[r * NLON + c] = NaN;
    g.v[r * NLON + c] = NaN;
  }
  return g;
}

const OPTIONS = {
  radius: 1.012,
  count: 300,
  speedScale: 0.02,
  lifeSeconds: 4,
  opacity: 0.35,
  size: 0.01,
  maxLat: 80,
  calmKmh: 6,
  trailSeconds: 2,
};

const array = (g: THREE.BufferGeometry, name: string): Float32Array =>
  g.getAttribute(name).array as Float32Array;

/** Tous les buffers que le rendu lit : aucun ne doit contenir un NaN ou un infini. */
function allBuffersFinite(p: WindParticles): boolean {
  const names = ['position', 'alpha', 'color', 'aSize'];
  for (const n of names)
    if (!array(p.points.geometry, n).every(Number.isFinite)) return false;
  for (const n of ['position', 'color'])
    if (!array(p.trails.geometry, n).every(Number.isFinite)) return false;
  return true;
}

function warm(p: WindParticles, grid: WindGrid, steps = 4): void {
  for (let i = 0; i < steps; i++) p.update(0.5, grid);
}

const headAlpha = (p: WindParticles, i: number): number =>
  array(p.trails.geometry, 'color')[i * 8 + 3]!;

describe('vent inconnu : aucune particule invalide', () => {
  it('une grille ENTIÈREMENT inconnue ne dessine rien, ne bouge rien, ne pollue aucun buffer', () => {
    const p = new WindParticles(OPTIONS);
    warm(p, field(10, 5)); // des particules vivantes, positionnées
    const before = array(p.points.geometry, 'position').slice();
    p.update(0.5, field(NaN, NaN));
    p.update(0.5, field(NaN, NaN));
    expect(allBuffersFinite(p)).toBe(true);
    // Aucune dérive : les positions sont celles d'avant, sauf les particules ré-ensemencées
    // (fin de vie), qui restent sur la sphère.
    const after = array(p.points.geometry, 'position');
    let moved = 0;
    for (let i = 0; i < OPTIONS.count; i++) {
      if (
        before[i * 3] !== after[i * 3] ||
        before[i * 3 + 1] !== after[i * 3 + 1] ||
        before[i * 3 + 2] !== after[i * 3 + 2]
      )
        moved++;
    }
    expect(moved).toBeLessThan(OPTIONS.count); // la plupart n'ont pas bougé
    for (let i = 0; i < OPTIONS.count; i++) {
      expect(array(p.points.geometry, 'alpha')[i]).toBe(0);
      expect(headAlpha(p, i)).toBe(0);
    }
  });

  it('une zone inconnue : les particules y restent invisibles, le reste du champ continue', () => {
    const p = new WindParticles(OPTIONS);
    // Hémisphère sud inconnu (rangées 0..8), nord valide.
    const holes: Array<[number, number]> = [];
    for (let r = 0; r <= 9; r++)
      for (let c = 0; c < NLON; c++) holes.push([r, c]);
    const g = withHoles(field(8, 0), holes);
    warm(p, g, 3);
    expect(allBuffersFinite(p)).toBe(true);
    const alpha = array(p.points.geometry, 'alpha');
    const position = array(p.points.geometry, 'position');
    let visibleNorth = 0;
    for (let i = 0; i < OPTIONS.count; i++) {
      const lat =
        (Math.asin(position[i * 3 + 1]! / OPTIONS.radius) * 180) / Math.PI;
      if (lat < -5)
        expect(alpha[i]).toBe(0); // zone sans donnée : pas de vent dessiné
      else if (alpha[i]! > 0) visibleNorth++;
    }
    expect(visibleNorth).toBeGreaterThan(0);
  });

  it('valide → inconnu → valide : aucune contamination permanente, le mouvement reprend', () => {
    const p = new WindParticles(OPTIONS);
    warm(p, field(10, 4));
    expect(allBuffersFinite(p)).toBe(true);
    for (let i = 0; i < 6; i++) p.update(0.25, field(NaN, NaN));
    expect(allBuffersFinite(p)).toBe(true);
    const frozen = array(p.points.geometry, 'position').slice();
    warm(p, field(10, 4), 3);
    expect(allBuffersFinite(p)).toBe(true);
    const moving = array(p.points.geometry, 'position');
    let changed = 0;
    for (let i = 0; i < moving.length; i++)
      if (moving[i] !== frozen[i]) changed++;
    expect(changed).toBeGreaterThan(0);
    const alpha = array(p.points.geometry, 'alpha');
    expect([...alpha].some((a) => a > 0)).toBe(true);
  });

  it('la traînée d’une particule devenue inconnue disparaît (queue = tête, alpha 0)', () => {
    const p = new WindParticles(OPTIONS);
    warm(p, field(15, 0));
    const grid = field(NaN, NaN);
    p.update(0.1, grid);
    const t = array(p.trails.geometry, 'position');
    for (let i = 0; i < OPTIONS.count; i++) {
      if (headAlpha(p, i) !== 0) continue;
      expect(t[i * 6]).toBe(t[i * 6 + 3]);
      expect(t[i * 6 + 1]).toBe(t[i * 6 + 4]);
      expect(t[i * 6 + 2]).toBe(t[i * 6 + 5]);
    }
    expect(array(p.trails.geometry, 'color').every(Number.isFinite)).toBe(true);
  });

  it('un trou près de l’antiméridien : ni NaN ni traînée en corde autour du globe', () => {
    const p = new WindParticles(OPTIONS);
    const holes: Array<[number, number]> = [];
    for (let r = 0; r < NLAT; r++) holes.push([r, 0], [r, NLON - 1]); // ±180°
    const g = withHoles(field(30, 0), holes);
    warm(p, g, 12);
    expect(allBuffersFinite(p)).toBe(true);
  });

  it('une particule dont la position est déjà invalide est ré-ensemencée', () => {
    const p = new WindParticles(OPTIONS);
    warm(p, field(5, 0));
    // Simule un état hérité corrompu : la position seule est invalide.
    (p as unknown as { lat: Float32Array }).lat[0] = NaN;
    p.update(0.1, field(NaN, NaN));
    expect(allBuffersFinite(p)).toBe(true);
    expect(
      Number.isFinite((p as unknown as { lat: Float32Array }).lat[0])
    ).toBe(true);
  });

  it('un champ valide (zéros compris) se comporte comme avant : calme = rien dessiné, rien de NaN', () => {
    const p = new WindParticles(OPTIONS);
    warm(p, field(0, 0));
    expect(allBuffersFinite(p)).toBe(true);
    expect(array(p.points.geometry, 'alpha').every((a) => a === 0)).toBe(true);
    warm(p, field(12, 3));
    expect([...array(p.points.geometry, 'alpha')].some((a) => a > 0)).toBe(
      true
    );
  });
});
