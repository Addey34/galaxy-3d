import * as THREE from 'three';
import { SpkKernel } from './SpkKernel';
import { SpkPositionReader } from './SpkPositionReader';

export interface PreciseEphemerisProvider {
  getHeliocentricAU(name: string, date: Date): THREE.Vector3 | null;
  getParentRelativeAU(
    childName: string,
    parentName: string,
    date: Date
  ): THREE.Vector3 | null;
}

export interface SpicePositionReader {
  getPositionAU(
    targetName: string,
    centerName: string,
    date: Date
  ): THREE.Vector3 | null;
}

export class SpiceEphemerisService implements PreciseEphemerisProvider {
  constructor(private readonly reader: SpicePositionReader) {}

  static fromSpkBuffer(
    buffer: ArrayBuffer,
    bodyIds: Readonly<Record<string, number>>
  ): SpiceEphemerisService {
    return new SpiceEphemerisService(
      new SpkPositionReader(SpkKernel.parse(buffer), bodyIds)
    );
  }

  getHeliocentricAU(name: string, date: Date): THREE.Vector3 | null {
    return this.reader.getPositionAU(name, 'sun', date);
  }

  getParentRelativeAU(
    childName: string,
    parentName: string,
    date: Date
  ): THREE.Vector3 | null {
    return this.reader.getPositionAU(childName, parentName, date);
  }
}

/** Tries a primary provider first and preserves the existing precise fallback. */
export class FallbackPreciseEphemerisProvider implements PreciseEphemerisProvider {
  constructor(
    private readonly primary: PreciseEphemerisProvider,
    private readonly fallback: PreciseEphemerisProvider
  ) {}

  getHeliocentricAU(name: string, date: Date): THREE.Vector3 | null {
    return (
      this.primary.getHeliocentricAU(name, date) ??
      this.fallback.getHeliocentricAU(name, date)
    );
  }

  getParentRelativeAU(
    childName: string,
    parentName: string,
    date: Date
  ): THREE.Vector3 | null {
    return (
      this.primary.getParentRelativeAU(childName, parentName, date) ??
      this.fallback.getParentRelativeAU(childName, parentName, date)
    );
  }
}
