import { describe, expect, it } from 'vitest';
import {
  OCEAN_LIKE_FULL,
  OCEAN_LIKE_NONE,
  OCEAN_MATCH_FRAGMENT_GLSL,
  oceanLiftLinear,
  oceanLikeness,
  oceanTileLinear,
} from './oceanMatch';

describe('oceanLiftLinear', () => {
  it('is the linear difference base minus tile, never negative for a darker tile', () => {
    const lift = oceanLiftLinear({
      tileSrgb: [2, 5, 20],
      baseSrgb: [31, 60, 118],
    });
    for (const channel of lift) expect(channel).toBeGreaterThan(0);
    // Le bleu porte l'essentiel de l'écart : l'eau de la base est bien plus bleue.
    expect(lift[2]).toBeGreaterThan(lift[1]);
    expect(lift[1]).toBeGreaterThan(lift[0]);
  });

  it('is zero when the mosaic already has the colour of the base', () => {
    expect(
      oceanLiftLinear({ tileSrgb: [31, 60, 118], baseSrgb: [31, 60, 118] })
    ).toEqual([0, 0, 0]);
  });
});

describe('the ocean-match shader', () => {
  it('reads the base water mask with the SphereGeometry convention', () => {
    expect(OCEAN_MATCH_FRAGMENT_GLSL).toContain(
      'atan( oceanDir.z, - oceanDir.x )'
    );
    expect(OCEAN_MATCH_FRAGMENT_GLSL).toContain('1.0 - acos(');
  });

  it('re-wraps the gradients at the u = 0 seam', () => {
    expect(OCEAN_MATCH_FRAGMENT_GLSL).toContain('oceanGx.x -= floor');
  });
});

describe('oceanLikeness (GAL-EARTH-VISUAL-COHERENCE-001)', () => {
  const s2Ocean = [15, 28, 51] as const;

  it('ramène entièrement l’eau du large, dont la couleur est celle mesurée', () => {
    expect(oceanLikeness([15, 28, 51], s2Ocean)).toBe(1);
    expect(oceanLikeness([18, 31, 55], s2Ocean)).toBe(1);
  });

  it('laisse la terre, même sombre, et une eau très claire telle que publiée', () => {
    // Forêt sombre, sable, champ : jamais bleuis, même dans la bande côtière du masque grossier.
    expect(oceanLikeness([40, 60, 30], s2Ocean)).toBe(0);
    expect(oceanLikeness([180, 160, 120], s2Ocean)).toBe(0);
    expect(oceanLikeness([90, 120, 60], s2Ocean)).toBe(0);
    // Lagon peu profond, turquoise : publié, pas ramené.
    expect(oceanLikeness([60, 150, 160], s2Ocean)).toBe(0);
  });

  it('passe progressivement d’un cas à l’autre (aucun bord dur)', () => {
    const mid = oceanLikeness([30, 48, 72], s2Ocean);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('le shader porte les mêmes bornes que le jumeau testé', () => {
    expect(OCEAN_MATCH_FRAGMENT_GLSL).toContain(
      `smoothstep( ${OCEAN_LIKE_FULL.toFixed(3)}, ${OCEAN_LIKE_NONE.toFixed(3)}`
    );
    expect(OCEAN_MATCH_FRAGMENT_GLSL).toContain('* oceanShare * oceanLike');
  });

  it('la couleur d’océan passée au shader est la couleur mesurée, en linéaire', () => {
    const lin = oceanTileLinear({ tileSrgb: [255, 0, 128] });
    expect(lin[0]).toBeCloseTo(1, 6);
    expect(lin[1]).toBe(0);
    expect(lin[2]).toBeGreaterThan(0.2);
    expect(lin[2]).toBeLessThan(0.23);
  });
});

describe('la variation d’un jour à l’autre de VIIRS reste dans la zone pleinement ramenée', () => {
  it('NOAA-21, les sept jours mesurés le 2026-11-25 autour de la médiane [19, 22, 35]', () => {
    for (const day of [
      [26, 29, 41],
      [18, 21, 34],
      [17, 21, 33],
      [24, 27, 39],
      [19, 22, 35],
    ] as const)
      expect(oceanLikeness(day, [19, 22, 35]), day.join(',')).toBe(1);
  });
});
