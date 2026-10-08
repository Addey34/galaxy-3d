import { describe, expect, it } from 'vitest';
import { mapWithByteBudget, mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('never runs more tasks at once than the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      return n;
    });
    expect(peak).toBe(4);
  });

  it('keeps the results in the order of the inputs, not of completion', async () => {
    const results = await mapWithConcurrency([3, 1, 2], 3, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n));
      return n;
    });
    expect(results).toEqual([3, 1, 2]);
  });

  it('runs every item even when there are more items than workers', async () => {
    const done: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      done.push(n);
      return n;
    });
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('degrades to a single worker for a non-positive limit instead of doing nothing', async () => {
    const results = await mapWithConcurrency([1, 2], 0, async (n) => n + 1);
    expect(results).toEqual([2, 3]);
  });
});

describe('mapWithByteBudget (ligne 45.5)', () => {
  /** Pic de tâches simultanées, pour un budget donné. */
  const peakOf = async (
    allowance: () => number | null,
    { count = 40, cost = 1_000, floor = 6, ceiling = 64 } = {}
  ): Promise<number> => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: count }, (_, i) => i);
    const results = await mapWithByteBudget(
      items,
      { floor, ceiling, cost: () => cost, allowance },
      async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight--;
        return n * 2;
      }
    );
    expect(results).toEqual(items.map((n) => n * 2));
    return peak;
  };

  it('reste au PLANCHER tant que le débit n’est pas mesuré', async () => {
    expect(await peakOf(() => null)).toBe(6);
  });

  it('reste au plancher sur un lien lent : le budget ne couvre pas une tâche de plus', async () => {
    expect(await peakOf(() => 500)).toBe(6);
  });

  it('élargit autant que les octets en vol tiennent dans le budget', async () => {
    // 6 au plancher (6 000 octets), puis jusqu'à 20 000 octets en vol : 20 tâches.
    expect(await peakOf(() => 20_000)).toBe(20);
  });

  it('ne dépasse jamais le plafond, même sur un lien illimité', async () => {
    expect(await peakOf(() => Number.POSITIVE_INFINITY, { ceiling: 24 })).toBe(
      24
    );
  });

  it('rend la main sur une liste vide, et avance même avec un plancher nul', async () => {
    expect(
      await mapWithByteBudget(
        [],
        { floor: 6, ceiling: 64, cost: () => 1, allowance: () => null },
        async () => 1
      )
    ).toEqual([]);
    expect(await peakOf(() => null, { floor: 0, count: 5 })).toBe(1);
  });

  it('revient au plancher tant qu’une tâche en vol est trop VIEILLE (lien dégradé)', async () => {
    // Débit mémorisé illimité, mais les dix premières tâches « vieillissent » d'une seconde
    // avant de finir : la suivante ne doit partir que sous le plancher, pas sur la foi d'un
    // débit qui décrit un autre lien.
    let t = 0;
    let inFlight = 0;
    const atFirstLateStart: number[] = [];
    const items = Array.from({ length: 30 }, (_, i) => i);
    const run = mapWithByteBudget(
      items,
      {
        floor: 2,
        ceiling: 10,
        cost: () => 1,
        allowance: () => Number.POSITIVE_INFINITY,
        maxAgeMs: 100,
        now: () => t,
      },
      async (n) => {
        inFlight++;
        if (t > 0 && atFirstLateStart.length === 0)
          atFirstLateStart.push(inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2 + (n % 5)));
        inFlight--;
        return n;
      }
    );
    t = 1_000;
    await run;
    // Avant le frein : la première relance part avec neuf tâches vieilles encore en vol.
    expect(atFirstLateStart[0]).toBeLessThanOrEqual(2);
  });
});
