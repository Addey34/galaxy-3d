import { describe, expect, it } from 'vitest';
import { compare, median, type PerfRun } from '../../scripts/perf-ab.mjs';

/** Le calcul de l'A/B de performance (`scripts/perf-ab.mjs`, lot 56) : médianes et rapports. */
const run = (p50: number, blocked: number, mib: number | null): PerfRun => ({
  steady: {
    frames: { p50Ms: p50 },
    driver: mib === null ? null : { total: mib * 1048576 },
  },
  approach: { longTasks: { totalMs: blocked } },
});

describe('perf-ab', () => {
  it('prend la médiane, robuste à un tirage aberrant', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([10, 11, 900])).toBe(11);
    expect(median([NaN])).toBeNaN();
  });

  it('rend le rapport branche / base par scène et par grandeur', () => {
    const out = compare({
      overview: {
        a: [run(80, 20_000, 400), run(90, 21_000, 400), run(85, 99_000, 400)],
        b: [
          run(170, 20_500, 500),
          run(160, 21_500, 500),
          run(175, 20_000, 500),
        ],
      },
    });
    expect(out.overview!.steadyP50!.ratio).toBeCloseTo(170 / 85);
    expect(out.overview!.approachBlockedMs!.ratio).toBeCloseTo(20_500 / 21_000);
    expect(out.overview!.driverMiB!.ratio).toBeCloseTo(1.25);
  });

  it('rend NaN pour la mémoire quand le build n’a pas le registre du pilote', () => {
    const out = compare({ s: { a: [run(1, 1, null)], b: [run(1, 1, null)] } });
    expect(out.s!.driverMiB!.ratio).toBeNaN();
  });
});

describe('perf-ab : le verdict contre les seuils calibrés', () => {
  it('appelle régression ce qui dépasse le seuil, bruit ce qui reste dedans', async () => {
    const { verdict, THRESHOLDS } = await import('../../scripts/perf-ab.mjs');
    expect(verdict('steadyP50', 1 + THRESHOLDS.steadyP50! / 2)).toBe('noise');
    expect(verdict('steadyP50', 1 + THRESHOLDS.steadyP50! * 1.5)).toBe(
      'regression'
    );
    expect(verdict('approachBlockedMs', 0.8)).toBe('gain');
    expect(verdict('driverMiB', NaN)).toBe('unmeasured');
  });

  it('garde chaque seuil au-dessus de l’écart mesuré de la base contre elle-même', async () => {
    const { default: file } = await import('./perfAbThresholds.json');
    for (const [name, spread] of Object.entries(file.measuredSpread))
      expect(
        file.thresholds[name as keyof typeof file.thresholds]
      ).toBeGreaterThan(spread);
  });
});
