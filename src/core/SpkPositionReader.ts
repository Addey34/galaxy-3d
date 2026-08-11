import * as THREE from 'three';
import { equatorialToScene } from './frames';
import type { SpicePositionReader } from './PreciseEphemerisProvider';
import { etSecondsFromDate, SpkKernel } from './SpkKernel';

const AU_KM = 149_597_870.7;
const J2000_FRAME = 1;

export class SpkPositionReader implements SpicePositionReader {
  constructor(
    private readonly kernel: SpkKernel,
    private readonly bodyIds: Readonly<Record<string, number>>
  ) {}

  getPositionAU(
    targetName: string,
    centerName: string,
    date: Date
  ): THREE.Vector3 | null {
    if (targetName === centerName) return new THREE.Vector3();
    const target = this.bodyIds[targetName];
    const center = this.bodyIds[centerName];
    if (target === undefined || center === undefined) return null;
    const state = this.kernel.getState(target, center, etSecondsFromDate(date));
    if (!state || state.frame !== J2000_FRAME) return null;
    return equatorialToScene(
      state.positionKm[0] / AU_KM,
      state.positionKm[1] / AU_KM,
      state.positionKm[2] / AU_KM
    );
  }
}
