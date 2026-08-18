import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  EmptyTileError,
  fetchTileWithContentCheck,
  isLikelyEmptyBySize,
  DEFAULT_MIN_TILE_BYTES,
} from './tileContent';

describe('isLikelyEmptyBySize', () => {
  it('flags a tile below the threshold as empty', () => {
    expect(isLikelyEmptyBySize(3000, 20000)).toBe(true);
  });
  it('accepts a tile at or above the threshold', () => {
    expect(isLikelyEmptyBySize(20000, 20000)).toBe(false);
    expect(isLikelyEmptyBySize(90000, 20000)).toBe(false);
  });
  it('disables detection when minBytes <= 0', () => {
    expect(isLikelyEmptyBySize(0, 0)).toBe(false);
    expect(isLikelyEmptyBySize(1, -5)).toBe(false);
  });
});

/** Réponse fetch factice avec un blob de taille contrôlée. */
function fakeResponse(bytes: number, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    blob: async () => ({ size: bytes }) as Blob,
  } as unknown as Response;
}

describe('fetchTileWithContentCheck', () => {
  const makeTexture = async () => new THREE.Texture();

  it('returns a texture for a large-enough tile', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(90_000));
    const tex = await fetchTileWithContentCheck('u', {
      minBytes: 20_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      makeTexture,
    });
    expect(tex).toBeInstanceOf(THREE.Texture);
    expect(fetchImpl).toHaveBeenCalledWith('u');
  });

  it('throws EmptyTileError for an empty tile (below threshold)', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(3_000));
    await expect(
      fetchTileWithContentCheck('u', {
        minBytes: 20_000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        makeTexture,
      })
    ).rejects.toBeInstanceOf(EmptyTileError);
  });

  it('does not build a texture when the tile is empty', async () => {
    const makeSpy = vi.fn(async () => new THREE.Texture());
    const fetchImpl = vi.fn(async () => fakeResponse(1_000));
    await expect(
      fetchTileWithContentCheck('u', {
        minBytes: 20_000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        makeTexture: makeSpy,
      })
    ).rejects.toBeInstanceOf(EmptyTileError);
    expect(makeSpy).not.toHaveBeenCalled();
  });

  it('throws on HTTP error', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(90_000, false));
    await expect(
      fetchTileWithContentCheck('u', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        makeTexture,
      })
    ).rejects.toThrow('HTTP 500');
  });

  it('uses DEFAULT_MIN_TILE_BYTES when minBytes is omitted', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(DEFAULT_MIN_TILE_BYTES - 1));
    await expect(
      fetchTileWithContentCheck('u', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        makeTexture,
      })
    ).rejects.toBeInstanceOf(EmptyTileError);
  });
});
