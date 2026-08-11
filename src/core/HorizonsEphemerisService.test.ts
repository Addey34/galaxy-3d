import { describe, expect, it, vi } from 'vitest';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';

describe('HorizonsEphemerisService', () => {
  it('interpolates positions from Horizons position/velocity samples', async () => {
    const samples = new Float64Array([1, 2, 3, 1, 0, 0, 5, 2, 3, 1, 0, 0]);
    const binary = samples.buffer;
    const manifest = {
      version: 1,
      source: 'test',
      generatedAt: '2026-01-01T00:00:00Z',
      frame: 'ECLIPTIC_J2000',
      center: 'SUN',
      units: 'AU-D',
      bodies: {
        test: {
          file: 'test.000000000000.bin',
          target: 'test',
          startJdTdb: 2_451_545,
          stepDays: 4,
          sampleCount: 2,
        },
      },
    };

    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/',
        origin: 'https://example.test',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => binary,
        })
    );

    const service = await HorizonsEphemerisService.load(
      'https://example.test/manifest.json'
    );
    // J2000 TT + 2 jours : avec des tangentes constantes, x est exactement au milieu.
    const position = service.getHeliocentricAU(
      'test',
      new Date('2000-01-03T11:58:56.000Z')
    );
    expect(position).not.toBeNull();
    expect(position!.x).toBeCloseTo(3, 5);
    expect(position!.y).toBeCloseTo(3, 8);
    expect(position!.z).toBeCloseTo(-2, 8);

    vi.unstubAllGlobals();
  });

  it('subtracts a precise child state from its precise parent state', async () => {
    const childSamples = new Float64Array([2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0])
      .buffer;
    const parentSamples = new Float64Array([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0])
      .buffer;
    const manifest = {
      version: 1,
      source: 'test',
      generatedAt: '2026-01-01T00:00:00Z',
      frame: 'ECLIPTIC_J2000',
      center: 'SUN',
      units: 'AU-D',
      bodies: {
        child: {
          file: 'child.000000000000.bin',
          target: 'child',
          startJdTdb: 2_451_545,
          stepDays: 4,
          sampleCount: 2,
        },
        parent: {
          file: 'parent.000000000000.bin',
          target: 'parent',
          startJdTdb: 2_451_545,
          stepDays: 4,
          sampleCount: 2,
        },
      },
    };

    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/',
        origin: 'https://example.test',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => childSamples,
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => parentSamples,
        })
    );

    const service = await HorizonsEphemerisService.load(
      '/assets/ephemerides/manifest.json'
    );
    const relative = service.getParentRelativeAU(
      'child',
      'parent',
      new Date('2000-01-03T11:58:56.000Z')
    );

    expect(relative).not.toBeNull();
    expect(relative!.x).toBeCloseTo(1, 8);
    expect(relative!.y).toBeCloseTo(0, 8);
    expect(relative!.z).toBeCloseTo(0, 8);
    vi.unstubAllGlobals();
  });

  it('returns null outside the loaded coverage', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/' } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const service = await HorizonsEphemerisService.load('/missing.json');
    expect(service.getHeliocentricAU('ceres', new Date())).toBeNull();
    vi.unstubAllGlobals();
  });

  it('reads a satellite file directly when the manifest declares its parent center', async () => {
    const childSamples = new Float64Array([
      0.01, 0, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0,
    ]).buffer;
    const manifest = {
      version: 1,
      source: 'test',
      generatedAt: '2026-01-01T00:00:00Z',
      frame: 'ECLIPTIC_J2000',
      center: 'SUN',
      units: 'AU-D',
      bodies: {
        moon: {
          file: 'moon.000000000000.bin',
          target: 'moon',
          center: 'earth',
          startJdTdb: 2_451_545,
          stepDays: 4,
          sampleCount: 2,
        },
      },
    };

    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/',
        origin: 'https://example.test',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => childSamples,
        })
    );

    const service = await HorizonsEphemerisService.load(
      '/assets/ephemerides/manifest.json'
    );
    const relative = service.getParentRelativeAU(
      'moon',
      'earth',
      new Date('2000-01-03T11:58:56.000Z')
    );

    expect(relative?.x).toBeCloseTo(0.01, 8);
    expect(relative?.y).toBeCloseTo(0, 8);
    expect(relative?.z).toBeCloseTo(0, 8);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
