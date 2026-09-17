import * as THREE from 'three';

export interface PreciseEphemerisProvider {
  /**
   * Nom de la source pour la provenance affichée. Absent : un binaire Horizons, la source
   * précise par défaut.
   */
  readonly source?: 'horizons' | 'spk';
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

  /**
   * Le fournisseur qui répond à cette question (même ordre que les deux méthodes ci-dessus),
   * ou `null` si aucun. `parentName` null : question héliocentrique.
   */
  answering(
    name: string,
    parentName: string | null,
    date: Date
  ): PreciseEphemerisProvider | null {
    const covers = (provider: PreciseEphemerisProvider): boolean =>
      (parentName === null
        ? provider.getHeliocentricAU(name, date)
        : provider.getParentRelativeAU(name, parentName, date)) !== null;
    if (covers(this.primary)) return this.primary;
    return covers(this.fallback) ? this.fallback : null;
  }
}
