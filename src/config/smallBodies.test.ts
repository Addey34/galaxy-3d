import { describe, expect, it } from 'vitest';
import { SMALL_BODIES, smallBodyToConfig } from './smallBodies';

const D2R = Math.PI / 180;

describe('smallBodyToConfig', () => {
  const cfg = smallBodyToConfig({
    name: 'test',
    a: 4,
    e: 0.2,
    iDeg: 30,
    omDeg: 45,
    wDeg: 60,
    maDeg: 90,
    epoch: '2000-01-01T12:00:00Z',
    radiusKm: 500,
  });

  it('converts published degrees to radians in the orbital elements', () => {
    const el = cfg.orbitalElements!;
    expect(el.semiMajorAxisAU).toBe(4);
    expect(el.eccentricity).toBe(0.2);
    expect(el.inclinationRad).toBeCloseTo(30 * D2R, 12);
    expect(el.ascendingNodeRad).toBeCloseTo(45 * D2R, 12);
    expect(el.argPerihelionRad).toBeCloseTo(60 * D2R, 12);
    expect(el.meanAnomalyAtEpochRad).toBeCloseTo(90 * D2R, 12);
    expect(el.epoch.toISOString()).toBe('2000-01-01T12:00:00.000Z');
  });

  it('derives the orbital period from the semi-major axis (Kepler III)', () => {
    expect(cfg.realData?.orbitPeriodDays).toBeCloseTo(
      365.256 * Math.pow(4, 1.5),
      6
    );
  });

  it('defaults to the asteroid kind and carries no texture (no mesh, invariant-safe)', () => {
    expect(cfg.kind).toBe('asteroid');
    expect(cfg.textures).toEqual({});
    expect(cfg.textureResolutions).toEqual({});
    expect(cfg.radius).toBeGreaterThan(0); // évite une division par zéro dans setScaleMode
  });

  it('honours an explicit kind', () => {
    expect(
      smallBodyToConfig({
        name: 'k',
        a: 2,
        e: 0,
        iDeg: 0,
        omDeg: 0,
        wDeg: 0,
        maDeg: 0,
        epoch: '2000-01-01T12:00:00Z',
        radiusKm: 10,
        kind: 'comet',
      }).kind
    ).toBe('comet');
  });

  it('connects an optional surface texture and physical rotation data', () => {
    const textured = smallBodyToConfig({
      name: 'dwarf',
      a: 40,
      e: 0.1,
      iDeg: 10,
      omDeg: 20,
      wDeg: 30,
      maDeg: 40,
      epoch: '2000-01-01T12:00:00Z',
      radiusKm: 700,
      kind: 'dwarf',
      surfaceResolutions: ['4k', '2k'],
      visualRadius: 0.2,
      rotationHours: 10,
      axialTiltDeg: 30,
    });

    expect(textured.textures.surface).toBe('dwarf/dwarfSurface');
    expect(textured.textureResolutions.surface).toEqual(['4k', '2k']);
    expect(textured.radius).toBe(0.2);
    expect(textured.rotationSpeed).toBeCloseTo((Math.PI * 2) / 36_000, 12);
    expect(textured.realData?.axialTilt).toBeCloseTo(30 * D2R, 12);
  });
});

describe('SMALL_BODIES catalogue', () => {
  it('exposes the curated notable bodies keyed by lowercase name', () => {
    for (const name of [
      'ceres',
      'vesta',
      'pallas',
      'hygiea',
      'eris',
      'haumea',
      'makemake',
      'halley',
    ]) {
      expect(SMALL_BODIES[name]).toBeDefined();
      expect(SMALL_BODIES[name]?.orbitalElements).toBeDefined();
      expect(SMALL_BODIES[name]?.astroBody).toBeUndefined(); // positionné par éléments, pas par éphéméride
    }
  });

  it('exposes local textures for the four newly rendered dwarf planets', () => {
    for (const name of ['ceres', 'eris', 'haumea', 'makemake']) {
      expect(SMALL_BODIES[name]?.textures.surface).toBe(
        `${name}/${name}Surface`
      );
      expect(SMALL_BODIES[name]?.textureResolutions.surface).toEqual([
        '4k',
        '2k',
      ]);
    }
  });

  it('models Halley as a retrograde comet (i > 90°)', () => {
    expect(SMALL_BODIES['halley']?.kind).toBe('comet');
    expect(
      SMALL_BODIES['halley']?.orbitalElements?.inclinationRad
    ).toBeGreaterThan(Math.PI / 2);
  });
});
