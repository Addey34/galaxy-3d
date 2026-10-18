import { describe, expect, it } from 'vitest';
import { GL, GpuLedger, bytesPerTexel } from './gpuLedger';

const RGBA8 = 0x8058;
const SRGB8_ALPHA8 = 0x8c43;
const R8 = 0x8229;
const RGBA = 0x1908;
const UNSIGNED_BYTE = 0x1401;
const HALF_FLOAT = 0x140b;
const DEPTH24_STENCIL8 = 0x88f0;
const ARRAY_BUFFER = 0x8892;

describe('bytesPerTexel', () => {
  it('reads sized formats from their size and unsized ones from their type', () => {
    expect(bytesPerTexel(RGBA8)).toBe(4);
    expect(bytesPerTexel(R8)).toBe(1);
    expect(bytesPerTexel(0x881a)).toBe(8); // RGBA16F
    expect(bytesPerTexel(RGBA, UNSIGNED_BYTE)).toBe(4);
    expect(bytesPerTexel(RGBA, HALF_FLOAT)).toBe(8);
    expect(bytesPerTexel(0xdead)).toBeNull();
  });
});

describe('GpuLedger', () => {
  it('counts a 2D upload, replaces it on re-upload and frees it on delete', () => {
    const ledger = new GpuLedger();
    const tex = {};
    ledger.bindTexture(GL.TEXTURE_2D, tex);
    ledger.texImage(GL.TEXTURE_2D, 0, SRGB8_ALPHA8, 1024, 512);
    expect(ledger.totals().textures.bytes).toBe(1024 * 512 * 4);
    // Même niveau re-téléversé : remplacé, pas ajouté.
    ledger.texImage(GL.TEXTURE_2D, 0, R8, 1024, 512);
    expect(ledger.totals().textures.bytes).toBe(1024 * 512);
    ledger.deleteTexture(tex);
    expect(ledger.totals().textures).toMatchObject({ live: 0, bytes: 0 });
  });

  it('adds the whole mip chain on generateMipmap', () => {
    const ledger = new GpuLedger();
    const tex = {};
    ledger.bindTexture(GL.TEXTURE_2D, tex);
    ledger.texImage(GL.TEXTURE_2D, 0, RGBA8, 4, 2);
    ledger.generateMipmap(GL.TEXTURE_2D);
    // 4×2 + 2×1 + 1×1 texels
    expect(ledger.textureBytes(tex)).toBe((8 + 2 + 1) * 4);
  });

  it('counts the six faces of a cubemap, whether uploaded face by face or stored at once', () => {
    const byFace = new GpuLedger();
    const cube = {};
    byFace.bindTexture(GL.TEXTURE_CUBE_MAP, cube);
    for (let f = 0; f < 6; f += 1)
      byFace.texImage(GL.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, RGBA8, 4096, 4096);
    byFace.generateMipmap(GL.TEXTURE_CUBE_MAP);
    const faced = byFace.totals().textures;
    expect(faced.cubeFaces).toBe(6);
    // La cubemap du ciel du 2026-10-18 : environ 512 Mio.
    expect(faced.cubeBytes / 1048576).toBeCloseTo(512, -1);

    const stored = new GpuLedger();
    const cube2 = {};
    stored.bindTexture(GL.TEXTURE_CUBE_MAP, cube2);
    stored.texStorage(GL.TEXTURE_CUBE_MAP, 13, RGBA8, 4096, 4096);
    expect(stored.totals().textures.cubeBytes).toBe(faced.cubeBytes);
  });

  it('tracks bindings per texture unit', () => {
    const ledger = new GpuLedger();
    const a = {};
    const b = {};
    ledger.activeTexture(GL.TEXTURE0);
    ledger.bindTexture(GL.TEXTURE_2D, a);
    ledger.activeTexture(GL.TEXTURE0 + 3);
    ledger.bindTexture(GL.TEXTURE_2D, b);
    ledger.texImage(GL.TEXTURE_2D, 0, R8, 10, 10);
    ledger.activeTexture(GL.TEXTURE0);
    ledger.texImage(GL.TEXTURE_2D, 0, R8, 20, 20);
    expect(ledger.textureBytes(a)).toBe(400);
    expect(ledger.textureBytes(b)).toBe(100);
  });

  it('counts multisampled renderbuffers and buffers, and frees them', () => {
    const ledger = new GpuLedger();
    const rb = {};
    ledger.bindRenderbuffer(rb);
    ledger.renderbufferStorage(4, DEPTH24_STENCIL8, 100, 50);
    const buf = {};
    ledger.bindBuffer(ARRAY_BUFFER, buf);
    ledger.bufferData(ARRAY_BUFFER, 1200);
    expect(ledger.totals()).toMatchObject({
      renderbuffers: { live: 1, bytes: 100 * 50 * 4 * 4 },
      buffers: { live: 1, bytes: 1200 },
      total: 100 * 50 * 16 + 1200,
    });
    ledger.deleteRenderbuffer(rb);
    ledger.deleteBuffer(buf);
    expect(ledger.totals().total).toBe(0);
  });

  it('names an unknown internal format instead of silently guessing it', () => {
    const ledger = new GpuLedger();
    ledger.bindTexture(GL.TEXTURE_2D, {});
    ledger.texImage(GL.TEXTURE_2D, 0, 0xbeef, 2, 2);
    expect(ledger.totals().unknownFormats).toEqual([0xbeef]);
  });
});
