import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REFLEX_MIN_MASS_RATIO } from '@/config/gravity';
import { alignedOffset, windowInCompanionGrid } from './ephemerisWindow';
import {
  fitReflexFactor,
  publishedFactor,
  reflexDecisions,
  type ReflexManifestEntry,
} from './reflexFactor';
import { EPHEMERIDES_DIR, horizonsManifest } from './horizonsTestFixture';

/** Une série d'états sur une grille de `step` jours : orbite lisse + f × compagnon. */
function synthetic(count: number, step: number, factor: number) {
  const body = new Float64Array(count * 6);
  const companion = new Float64Array(count * 6);
  for (let i = 0; i < count; i++) {
    const t = i * step;
    // Orbite héliocentrique lisse (5,2 UA, 12 ans) et compagnon à 691 km, 4,28 jours.
    const big = (2 * Math.PI * t) / 4380;
    const small = (2 * Math.PI * t) / 4.283;
    const r = 691 / 149_597_870.7;
    companion.set([r * Math.cos(small), r * Math.sin(small), 0], i * 6);
    body.set(
      [
        5.2 * Math.cos(big) + factor * companion[i * 6]!,
        5.2 * Math.sin(big) + factor * companion[i * 6 + 1]!,
        0.01 * Math.sin(big),
      ],
      i * 6
    );
  }
  return { body, companion };
}

describe('facteur de ballant dérivé des échantillons', () => {
  it('retrouve le facteur d’un primaire sur une orbite lisse, malgré le repliement du pas', () => {
    const { body, companion } = synthetic(400, 4, -0.2202);
    const fit = fitReflexFactor(body, companion)!;
    expect(fit.factor).toBeCloseTo(-0.2202, 4);
    expect(fit.roughnessAfter).toBeLessThan(fit.roughnessBefore / 100);
  });

  it('rend ~0 sans ballant, et rien sur une série trop courte', () => {
    const { body, companion } = synthetic(400, 4, 0);
    expect(Math.abs(fitReflexFactor(body, companion)!.factor)).toBeLessThan(
      1e-3
    );
    const short = synthetic(6, 4, -0.2);
    expect(fitReflexFactor(short.body, short.companion)).toBeNull();
  });
});

describe('grilles alignées', () => {
  const grid = (startJdTdb: number, stepDays: number, sampleCount: number) => ({
    startJdTdb,
    stepDays,
    sampleCount,
  });
  it('mesure le décalage de deux grilles sur les mêmes nœuds, et refuse les autres', () => {
    expect(alignedOffset(grid(100, 4, 50), grid(100, 4, 50))).toBe(0);
    expect(
      alignedOffset(grid(2415020.5, 4, 18354), grid(2451548.5, 4, 4648))
    ).toBe(9132);
    expect(alignedOffset(grid(100, 4, 50), grid(102, 4, 50))).toBeNull();
    expect(alignedOffset(grid(100, 4, 50), grid(100, 2, 50))).toBeNull();
  });
  it('traduit une fenêtre dans la grille du compagnon, bornée à son fichier', () => {
    const window = {
      firstIndex: 9130,
      lastIndex: 9140,
      byteStart: 0,
      byteEnd: 0,
      byteLength: 0,
    };
    const inside = windowInCompanionGrid(window, 9132, grid(0, 4, 4648))!;
    expect([inside.firstIndex, inside.lastIndex]).toEqual([0, 8]);
    expect(inside.byteStart).toBe(0);
    expect(inside.byteEnd).toBe(9 * 48 - 1);
    const before = { ...window, firstIndex: 0, lastIndex: 10 };
    expect(windowInCompanionGrid(before, 9132, grid(0, 4, 4648))).toBeNull();
  });
});

describe('le ballant publié au manifeste est celui que les binaires livrés donnent', () => {
  const bodies = horizonsManifest.bodies as Record<
    string,
    ReflexManifestEntry & {
      file: string;
      reflex?: { companion: string; factor: number };
    }
  >;
  const samplesOf = (name: string) => {
    const file = readFileSync(EPHEMERIDES_DIR + bodies[name]!.file);
    return new Float64Array(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    );
  };

  it.each(Object.keys(bodies))('%s', (name) => {
    const published = reflexDecisions(
      name,
      bodies,
      samplesOf,
      REFLEX_MIN_MASS_RATIO
    ).find((decision) => decision.published);
    expect(
      bodies[name]!.reflex,
      `${name} : relancer pnpm ephemeris:reflex`
    ).toEqual(
      published
        ? {
            companion: published.companion,
            factor: publishedFactor(published.fit.factor),
          }
        : undefined
    );
  });

  it('Patrocle porte le sien, et c’est le nombre mesuré d’abord contre Horizons', () => {
    // Témoin indépendant : primaire − solution au sol = −0,2202 × Menoetius + constante lente,
    // ajusté sur des requêtes Horizons de 2005, 2020 et 2040 (2026-10-05).
    expect(bodies.patroclus!.reflex!.companion).toBe('menoetius');
    expect(bodies.patroclus!.reflex!.factor).toBeCloseTo(-0.2202, 3);
  });
});
