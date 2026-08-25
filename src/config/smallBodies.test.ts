import { describe, expect, it } from 'vitest';
import { SMALL_BODIES, smallBodyToConfig } from './smallBodies';
import { OrbitalElementsService } from '@/core/OrbitalElementsService';

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
    // `textures` est dérivé au niveau du catalogue (deriveTextures), pas par le converter.
    expect(cfg.textures).toBeUndefined();
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

    // Le converter déclare les résolutions ; le chemin `textures` est dérivé au catalogue.
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

  it('exposes local textures with the available resolutions', () => {
    // Le chemin `textures` est dérivé au niveau du catalogue (deriveTextures) ; ici on
    // vérifie que chaque corps déclare les résolutions réellement livrées sur disque.
    const expected: Record<string, string[]> = {
      ceres: ['4k', '2k', '1k'],
      eris: ['4k', '2k', '1k'],
      haumea: ['4k', '2k', '1k'],
      makemake: ['4k', '2k', '1k'],
      halley: ['4k', '2k'],
    };
    for (const [name, res] of Object.entries(expected)) {
      expect(SMALL_BODIES[name]?.textureResolutions.surface).toEqual(res);
    }
  });

  it('keeps small-body orbit colors distinct', () => {
    const names = [
      'ceres',
      'vesta',
      'pallas',
      'hygiea',
      'pluto',
      'eris',
      'haumea',
      'makemake',
      'halley',
    ];
    const colors = names.map((name) => SMALL_BODIES[name]?.orbitalColor);
    expect(new Set(colors).size).toBe(names.length);
  });
  it('models Halley as a retrograde comet (i > 90°)', () => {
    expect(SMALL_BODIES['halley']?.kind).toBe('comet');
    expect(
      SMALL_BODIES['halley']?.orbitalElements?.inclinationRad
    ).toBeGreaterThan(Math.PI / 2);
  });

  /**
   * Régression pour un bug réel : Vesta, Pallas, Hygiea et Halley sont les 4 corps SANS
   * fallback Horizons (voir `scripts/generate-horizons-ephemerides.mjs`) — leur position
   * dépend à 100% de ces éléments képlériens statiques. `maDeg` (anomalie moyenne à l'époque)
   * était faux pour l'époque déclarée sur les 4 : par exemple Halley affichait ~15,5 UA à sa
   * vraie date de périhélie de 1986 (1986-02-09) au lieu de ~0,575 UA — un décalage de phase
   * d'environ 6 ans sur son orbite de 76 ans, à N'IMPORTE QUELLE date simulée, pas seulement
   * aux extrêmes. Corrigé avec les éléments osculateurs JPL Horizons exacts à l'époque
   * 2000-01-01T12:00Z. Ces distances de référence viennent du vecteur d'état Horizons réel à
   * la même date (Vesta/Pallas/Hygiea) ou à la vraie date de périhélie 1986 (Halley, tolérance
   * plus large : modèle 2 corps propagé sur 14 ans pour une comète non-gravitationnellement
   * perturbée — limite documentée dans `kepler.ts`, pas une imprécision de cette correction).
   */
  it.each([
    ['vesta', new Date('2000-01-01T12:00:00Z'), 2.163],
    ['pallas', new Date('2000-01-01T12:00:00Z'), 2.144],
    ['hygiea', new Date('2000-01-01T12:00:00Z'), 2.795],
    ['halley', new Date('1986-02-09T00:00:00Z'), 0.575],
  ] as const)(
    '%s heliocentric distance matches the real Horizons ephemeris within tolerance',
    (name, date, expectedAU) => {
      const elements = SMALL_BODIES[name]?.orbitalElements;
      expect(elements, `${name}: missing orbitalElements`).toBeDefined();
      const service = new OrbitalElementsService();
      const position = service.getHeliocentricAU(elements!, date);
      expect(
        position.length(),
        `${name} @ ${date.toISOString()}: got ${position.length().toFixed(4)} AU, expected ~${expectedAU} AU`
      ).toBeCloseTo(expectedAU, 1);
    }
  );
});
