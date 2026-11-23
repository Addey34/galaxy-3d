import { afterEach, describe, expect, it, vi } from 'vitest';
import { complementInfoFor, loadWithComplement } from './cloudComplement';

/**
 * Provenance du comblement (GAL-CLOUD-VISUAL-001) : l'information « comblé par Aqua » est gardée par
 * adresse. Un rechargement de la MÊME adresse sans complément ne doit jamais la réutiliser.
 */
const W = 16;
const H = 8;
const TERRA =
  'https://gibs.test/wms?LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor&TIME=2026-11-21';

interface FakeBitmap {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  close: () => void;
}

function frame(black: boolean): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const half = i % W < W / 2;
    const v = black && half ? 0 : 200;
    px.set([v, v, v, 255], i * 4);
  }
  return px;
}

function install(aquaAvailable: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const aqua = url.includes('MODIS_Aqua');
      if (aqua && !aquaAvailable) return { ok: false, status: 404 };
      const rgba = frame(!aqua);
      return { ok: true, blob: async () => ({ size: 50_000, rgba }) };
    })
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (src: { rgba: Uint8ClampedArray }) => ({
      width: W,
      height: H,
      rgba: src.rgba,
      close: () => undefined,
    }))
  );
  class FakeCanvas {
    private pixels = new Uint8ClampedArray(W * H * 4);
    rgba = this.pixels;
    constructor(
      public width: number,
      public height: number
    ) {}
    getContext(): object {
      return {
        drawImage: (b: FakeBitmap) => this.pixels.set(b.rgba),
        getImageData: () => ({ data: this.pixels }),
        putImageData: (d: { data: Uint8ClampedArray }) =>
          this.pixels.set(d.data),
      };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(public data: Uint8ClampedArray) {}
    }
  );
}

const options = {
  minTileBytes: 20_000,
  composite: { noDataMax: 8, growPx: 0, featherPx: 0 },
};

afterEach(() => vi.unstubAllGlobals());

describe('provenance du comblement', () => {
  it('garde le comblement du chargement qui l’a fait', async () => {
    install(true);
    await loadWithComplement(TERRA, undefined, options);
    expect(complementInfoFor(TERRA)?.complementLabel).toBe('MODIS Aqua');
    expect(complementInfoFor(TERRA)?.filled).toBeGreaterThan(0);
  });

  it('un rechargement de la même adresse sans Aqua n’hérite pas de l’ancien comblement', async () => {
    install(true);
    await loadWithComplement(TERRA, undefined, options);
    expect(complementInfoFor(TERRA)).toBeDefined();
    install(false);
    await loadWithComplement(TERRA, undefined, options);
    expect(complementInfoFor(TERRA)).toBeUndefined();
  });
});
