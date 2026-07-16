import { describe, expect, it } from 'vitest';
import { allBodies, assertUniqueBodyNames, flattenBodies, forEachBody } from './catalog';
import type { CelestialBodyConfig, CelestialConfig } from '../types';

const stub = (kind: CelestialBodyConfig['kind']): CelestialBodyConfig => ({
  kind,
  radius: 1,
  rotationSpeed: 0,
  orbitalRadius: 0,
  orbitalColor: 0,
  textureResolutions: {},
  textures: {},
});

const config: CelestialConfig = {
  bodies: {
    sun: stub('star'),
    earth: { ...stub('planet'), satellites: { moon: stub('moon') } },
    mars: stub('planet'),
  },
};

describe('forEachBody', () => {
  it('visits parents then their satellites, tagging the parent name', () => {
    const seen: Array<[string, string | null]> = [];
    forEachBody(config, ({ name, parentName }) => seen.push([name, parentName]));
    expect(seen).toEqual([
      ['sun', null],
      ['earth', null],
      ['moon', 'earth'],
      ['mars', null],
    ]);
  });
});

describe('allBodies / flattenBodies', () => {
  it('allBodies flattens satellites into the list', () => {
    expect(allBodies(config).map((e) => e.name)).toEqual(['sun', 'earth', 'moon', 'mars']);
  });

  it('flattenBodies resolves satellites by name', () => {
    const map = flattenBodies(config);
    expect(map.get('moon')?.kind).toBe('moon');
    expect(map.get('earth')?.kind).toBe('planet');
    expect(map.has('pluto')).toBe(false);
  });
});

describe('assertUniqueBodyNames', () => {
  it('accepts a catalogue with unique names', () => {
    expect(() => assertUniqueBodyNames(config)).not.toThrow();
  });

  it('throws when a satellite name collides with a planet name', () => {
    const dup: CelestialConfig = {
      bodies: {
        earth: { ...stub('planet'), satellites: { earth: stub('moon') } },
      },
    };
    expect(() => assertUniqueBodyNames(dup)).toThrow(/earth/);
  });

  it('throws when two planets share a name across parents', () => {
    const dup: CelestialConfig = {
      bodies: {
        earth: { ...stub('planet'), satellites: { titan: stub('moon') } },
        saturn: { ...stub('planet'), satellites: { titan: stub('moon') } },
      },
    };
    expect(() => assertUniqueBodyNames(dup)).toThrow(/titan/);
  });
});
