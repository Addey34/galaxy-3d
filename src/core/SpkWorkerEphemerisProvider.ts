import * as THREE from 'three';
import { equatorialToScene } from './frames';
import { etSecondsFromDate } from './SpkKernel';
import type { SpkSegmentDescriptor, SpkState } from './SpkKernel';
import type { SpkKernelWorkerTransport } from './SpkKernelWorkerClient';
import type { PreciseEphemerisProvider } from './PreciseEphemerisProvider';

const AU_KM = 149_597_870.7;
const J2000_FRAME = 1;
const MAX_EXTRAPOLATION_SECONDS = 30;

interface CachedState {
  etSeconds: number;
  state: SpkState;
}

interface CoverageRange {
  startEtSeconds: number;
  endEtSeconds: number;
}

/**
 * Synchronous facade over the asynchronous SPK Worker.
 *
 * The directory returned by the Worker is used as a capability index: missing
 * target/center pairs and out-of-coverage dates never generate a Worker call.
 * Between two replies, the latest position is advanced with the SPK velocity
 * for a short bounded interval.
 */
export class SpkWorkerEphemerisProvider implements PreciseEphemerisProvider {
  private readonly cache = new Map<string, CachedState>();
  private readonly pending = new Set<string>();
  private readonly coverage = new Map<string, CoverageRange[]>();
  private loaded = false;

  constructor(
    private readonly transport: SpkKernelWorkerTransport,
    private readonly bodyIds: Readonly<Record<string, number>>
  ) {}

  async loadUrl(url: string): Promise<void> {
    const segments = await this.transport.loadUrl(url);
    this.cache.clear();
    this.coverage.clear();
    for (const segment of segments) this.indexCoverage(segment);
    this.compactCoverage();
    this.loaded = true;
  }

  getHeliocentricAU(name: string, date: Date): THREE.Vector3 | null {
    return this.getPositionAU(name, 'sun', date);
  }

  getParentRelativeAU(
    childName: string,
    parentName: string,
    date: Date
  ): THREE.Vector3 | null {
    return this.getPositionAU(childName, parentName, date);
  }

  dispose(): void {
    this.transport.dispose();
    this.cache.clear();
    this.coverage.clear();
    this.pending.clear();
    this.loaded = false;
  }

  private getPositionAU(
    targetName: string,
    centerName: string,
    date: Date
  ): THREE.Vector3 | null {
    if (targetName === centerName) return new THREE.Vector3();
    if (!this.loaded) return null;

    const target = this.bodyIds[targetName];
    const center = this.bodyIds[centerName];
    if (target === undefined || center === undefined) return null;

    const etSeconds = etSecondsFromDate(date);
    const key = this.pairKey(target, center);
    if (!this.isCovered(key, etSeconds)) return null;

    const cached = this.cache.get(key);
    if (cached) {
      const delta = etSeconds - cached.etSeconds;
      if (Math.abs(delta) <= MAX_EXTRAPOLATION_SECONDS) {
        const position = cached.state.positionKm.map(
          (value, axis) =>
            value + cached.state.velocityKmPerSecond[axis] * delta
        ) as [number, number, number];
        return this.toSceneAU(position, cached.state.frame);
      }
    }

    this.requestState(key, target, center, etSeconds);
    return null;
  }

  private indexCoverage(segment: SpkSegmentDescriptor): void {
    if (segment.type !== 2 && segment.type !== 3) return;
    if (segment.frame !== J2000_FRAME) return;
    const key = this.pairKey(segment.target, segment.center);
    const ranges = this.coverage.get(key) ?? [];
    ranges.push({
      startEtSeconds: segment.startEtSeconds,
      endEtSeconds: segment.endEtSeconds,
    });
    this.coverage.set(key, ranges);
  }

  private compactCoverage(): void {
    for (const [key, ranges] of this.coverage) {
      ranges.sort((left, right) => left.startEtSeconds - right.startEtSeconds);
      const compacted: CoverageRange[] = [];
      for (const range of ranges) {
        const previous = compacted[compacted.length - 1];
        if (!previous || range.startEtSeconds > previous.endEtSeconds) {
          compacted.push({ ...range });
        } else {
          previous.endEtSeconds = Math.max(
            previous.endEtSeconds,
            range.endEtSeconds
          );
        }
      }
      this.coverage.set(key, compacted);
    }
  }

  private isCovered(key: string, etSeconds: number): boolean {
    return (
      this.coverage
        .get(key)
        ?.some(
          (range) =>
            etSeconds >= range.startEtSeconds && etSeconds <= range.endEtSeconds
        ) ?? false
    );
  }

  private pairKey(target: number, center: number): string {
    return `${target}:${center}`;
  }

  private requestState(
    key: string,
    target: number,
    center: number,
    etSeconds: number
  ): void {
    if (this.pending.has(key)) return;
    this.pending.add(key);
    void this.transport
      .getState(target, center, etSeconds)
      .then((state) => {
        if (state?.frame === J2000_FRAME) {
          this.cache.set(key, { etSeconds, state });
        }
      })
      .catch(() => undefined)
      .finally(() => this.pending.delete(key));
  }

  private toSceneAU(
    positionKm: readonly [number, number, number],
    frame: number
  ): THREE.Vector3 | null {
    if (frame !== J2000_FRAME) return null;
    return equatorialToScene(
      positionKm[0] / AU_KM,
      positionKm[1] / AU_KM,
      positionKm[2] / AU_KM
    );
  }
}
