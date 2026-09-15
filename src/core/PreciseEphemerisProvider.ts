import * as THREE from 'three';

export interface PreciseEphemerisProvider {
  getHeliocentricAU(name: string, date: Date): THREE.Vector3 | null;
  getParentRelativeAU(
    childName: string,
    parentName: string,
    date: Date
  ): THREE.Vector3 | null;
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
