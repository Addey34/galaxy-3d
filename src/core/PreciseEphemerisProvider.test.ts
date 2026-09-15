import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  FallbackPreciseEphemerisProvider,
  type PreciseEphemerisProvider,
} from './PreciseEphemerisProvider';

/** Fournisseur de test : ne connaît que les positions qu'on lui donne, `null` sinon. */
function stubProvider(
  helio: Record<string, THREE.Vector3>,
  relative: Record<string, THREE.Vector3> = {}
): PreciseEphemerisProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getHeliocentricAU(name) {
      calls.push(`helio:${name}`);
      return helio[name] ?? null;
    },
    getParentRelativeAU(child, parent) {
      calls.push(`rel:${child}/${parent}`);
      return relative[`${child}/${parent}`] ?? null;
    },
  };
}

const DATE = new Date('2026-01-01T00:00:00Z');

describe('FallbackPreciseEphemerisProvider', () => {
  it('prend la source primaire quand elle répond, sans interroger le repli', () => {
    const spk = new THREE.Vector3(1, 2, 3);
    const primary = stubProvider({ titan: spk });
    const fallback = stubProvider({ titan: new THREE.Vector3(9, 9, 9) });
    const provider = new FallbackPreciseEphemerisProvider(primary, fallback);

    expect(provider.getHeliocentricAU('titan', DATE)).toBe(spk);
    expect(fallback.calls).toEqual([]);
  });

  it('bascule sur le repli quand la primaire ne couvre pas le corps ou la date', () => {
    // C'est le cas nominal du SPK en production : le Worker répond `null` tant que son cache
    // n'est pas rempli, et Horizons doit alors tenir la position sans trou.
    const horizons = new THREE.Vector3(4, 5, 6);
    const moon = new THREE.Vector3(0.1, 0.2, 0.3);
    const provider = new FallbackPreciseEphemerisProvider(
      stubProvider({}),
      stubProvider({ titan: horizons }, { 'titan/saturn': moon })
    );

    expect(provider.getHeliocentricAU('titan', DATE)).toBe(horizons);
    expect(provider.getParentRelativeAU('titan', 'saturn', DATE)).toBe(moon);
  });

  it('renvoie null quand aucune des deux sources ne connaît le corps', () => {
    const provider = new FallbackPreciseEphemerisProvider(
      stubProvider({}),
      stubProvider({})
    );

    expect(provider.getHeliocentricAU('sedna', DATE)).toBeNull();
    expect(provider.getParentRelativeAU('styx', 'pluto', DATE)).toBeNull();
  });
});
