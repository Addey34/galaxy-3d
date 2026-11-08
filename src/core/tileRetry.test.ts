import { describe, expect, it } from 'vitest';
import {
  isTileRetryPending,
  TILE_RETRY_BASE_MS,
  TILE_RETRY_MAX_MS,
  tileRetryDelayMs,
} from './tileRetry';

describe('tileRetryDelayMs', () => {
  it('double à chaque échec consécutif, puis plafonne', () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(tileRetryDelayMs)).toEqual([
      8000, 16_000, 32_000, 60_000, 60_000, 60_000, 60_000,
    ]);
    expect(tileRetryDelayMs(1)).toBe(TILE_RETRY_BASE_MS);
    expect(tileRetryDelayMs(1000)).toBe(TILE_RETRY_MAX_MS);
  });

  it('tolère un compte absurde sans produire de retard infini ou négatif', () => {
    for (const bad of [0, -3, 0.5, Number.NaN, Infinity]) {
      const delay = tileRetryDelayMs(bad);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(TILE_RETRY_BASE_MS);
      expect(delay).toBeLessThanOrEqual(TILE_RETRY_MAX_MS);
    }
  });
});

describe('isTileRetryPending', () => {
  it('retient jusqu’au retard, puis rend la main', () => {
    expect(isTileRetryPending(1000, 1, 1000 + 7999)).toBe(true);
    expect(isTileRetryPending(1000, 1, 1000 + 8000)).toBe(false);
    expect(isTileRetryPending(1000, 3, 1000 + 31_999)).toBe(true);
    expect(isTileRetryPending(1000, 3, 1000 + 32_000)).toBe(false);
  });

  it('un échec « à moins l’infini » est aussitôt rejouable', () => {
    expect(isTileRetryPending(-Infinity, 9, 0)).toBe(false);
  });
});
