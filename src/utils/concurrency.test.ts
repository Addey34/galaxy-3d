import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

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
