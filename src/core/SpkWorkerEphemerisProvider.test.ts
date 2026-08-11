import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { equatorialToScene } from './frames';
import { SpkWorkerEphemerisProvider } from './SpkWorkerEphemerisProvider';
import type { SpkSegmentDescriptor, SpkState } from './SpkKernel';
import type { SpkKernelWorkerTransport } from './SpkKernelWorkerClient';

const COVERAGE_START = -1e15;
const COVERAGE_END = 1e15;

class FakeTransport implements SpkKernelWorkerTransport {
  requests: Array<[number, number, number]> = [];
  state: SpkState | null = {
    positionKm: [100, 200, 300],
    velocityKmPerSecond: [1, 0, 0],
    frame: 1,
  };
  segments: readonly SpkSegmentDescriptor[] = [];

  loadUrl(): Promise<readonly SpkSegmentDescriptor[]> {
    return Promise.resolve(this.segments);
  }

  getState(
    target: number,
    center: number,
    etSeconds: number
  ): Promise<SpkState | null> {
    this.requests.push([target, center, etSeconds]);
    return Promise.resolve(this.state);
  }

  dispose(): void {}
}

function segment(
  target: number,
  center: number,
  startEtSeconds = COVERAGE_START,
  endEtSeconds = COVERAGE_END
): SpkSegmentDescriptor {
  return {
    startEtSeconds,
    endEtSeconds,
    target,
    center,
    frame: 1,
    type: 3,
    initialAddress: 1,
    finalAddress: 1,
    name: 'test segment',
  };
}

describe('SpkWorkerEphemerisProvider', () => {
  it('keeps the render-loop API synchronous while filling its cache asynchronously', async () => {
    const transport = new FakeTransport();
    transport.segments = [segment(801, 10)];
    const provider = new SpkWorkerEphemerisProvider(transport, {
      sun: 10,
      triton: 801,
      neptune: 899,
    });
    await provider.loadUrl('/assets/kernels/sat441l.bsp');

    const date = new Date('2026-01-01T00:00:00Z');
    expect(provider.getHeliocentricAU('triton', date)).toBeNull();
    expect(transport.requests).toHaveLength(1);

    await Promise.resolve();
    await Promise.resolve();

    const position = provider.getHeliocentricAU(
      'triton',
      new Date(date.getTime() + 1_000)
    );
    const expected = equatorialToScene(
      101 / 149_597_870.7,
      200 / 149_597_870.7,
      300 / 149_597_870.7
    );
    expect(position?.toArray()).toEqual(expected.toArray());
  });

  it('requests parent-relative states with the configured NAIF ids', async () => {
    const transport = new FakeTransport();
    transport.segments = [segment(901, 999)];
    const provider = new SpkWorkerEphemerisProvider(transport, {
      sun: 10,
      charon: 901,
      pluto: 999,
    });
    await provider.loadUrl('/assets/kernels/sat441l.bsp');

    expect(
      provider.getParentRelativeAU(
        'charon',
        'pluto',
        new Date('2026-01-01T00:00:00Z')
      )
    ).toBeNull();
    expect(transport.requests[0]?.slice(0, 2)).toEqual([901, 999]);
  });

  it('does not query unsupported pairs or dates outside the SPK directory', async () => {
    const transport = new FakeTransport();
    transport.segments = [segment(801, 899, 0, 1)];
    const provider = new SpkWorkerEphemerisProvider(transport, {
      sun: 10,
      moon: 301,
      triton: 801,
      neptune: 899,
    });
    await provider.loadUrl('/assets/kernels/sat441l.bsp');

    expect(
      provider.getHeliocentricAU('triton', new Date('1900-01-01T00:00:00Z'))
    ).toBeNull();
    expect(provider.getHeliocentricAU('moon', new Date())).toBeNull();
    expect(transport.requests).toHaveLength(0);
  });

  it('returns zero for a body centered on itself and ignores unsupported frames', async () => {
    const transport = new FakeTransport();
    const provider = new SpkWorkerEphemerisProvider(transport, {
      sun: 10,
      moon: 301,
    });
    await provider.loadUrl('/assets/kernels/sat441l.bsp');

    expect(provider.getParentRelativeAU('sun', 'sun', new Date())).toEqual(
      new THREE.Vector3()
    );
    transport.state = { ...transport.state!, frame: 2 };
    expect(provider.getHeliocentricAU('moon', new Date())).toBeNull();
  });
});
