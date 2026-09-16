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
    // Bennu n'est plus ici : ce test ne compare qu'une DISTANCE au dixième d'UA, à l'époque
    // même des éléments. Il était vert pendant que Bennu dérivait de 0,47 UA « aujourd'hui ».
    // Bennu est désormais tenu par les vecteurs complets ci-dessous, sur ±10 ans.
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

/**
 * Régression de position des astéroïdes de la vague A (Éros, Itokawa, Ryugu, Ida) et de Bennu contre les
 * vecteurs d'état JPL Horizons, relevés en direct par `node scripts/derive-small-body-elements.mjs`
 * à −10, −1, 0, +1 et +10 ans de l'époque des éléments (2026-01-01).
 *
 * Tolérances MESURÉES, pas choisies : écart ≤ 2,6e-3 UA à un an, ≤ 5,3e-2 UA à dix ans (Ryugu,
 * frôlé par la Terre), d'où 0,005 et 0,08 UA. Une anomalie moyenne prise un seul jour trop tôt
 * déplace Ryugu d'environ 0,013 UA et fait échouer la première borne.
 */
const WAVE_A_VECTORS: readonly (readonly [
  string,
  string,
  number,
  number,
  number,
])[] = [
  [
    'eros',
    '2016-01-02T00:00:00.000Z',
    -0.8059560868703679,
    -1.265872466987505,
    -0.2638594941419051,
  ],
  [
    'eros',
    '2025-01-01T00:00:00.000Z',
    -0.01619866965564159,
    -1.688559955842637,
    -0.1844316998702361,
  ],
  [
    'eros',
    '2026-01-01T00:00:00.000Z',
    0.1580941121361407,
    1.167072662333513,
    0.1506883375096972,
  ],
  [
    'eros',
    '2027-01-01T00:00:00.000Z',
    0.9397261997129005,
    -1.515300283938032,
    -0.01465288108711664,
  ],
  [
    'eros',
    '2036-01-02T00:00:00.000Z',
    1.468679317874745,
    -0.91525630796997,
    0.1338295459792221,
  ],
  [
    'itokawa',
    '2016-01-02T00:00:00.000Z',
    0.2997992714222794,
    1.59581692647044,
    0.008202311113652272,
  ],
  [
    'itokawa',
    '2025-01-01T00:00:00.000Z',
    0.8760300175658677,
    1.445778958585235,
    -0.008546486572643506,
  ],
  [
    'itokawa',
    '2026-01-01T00:00:00.000Z',
    1.133923205317714,
    -0.6006193039631518,
    -0.03604197067781104,
  ],
  [
    'itokawa',
    '2027-01-01T00:00:00.000Z',
    -0.9803860409731147,
    0.7000250169432459,
    0.03298822736323294,
  ],
  [
    'itokawa',
    '2036-01-02T00:00:00.000Z',
    -0.5504280659014845,
    1.298748557526961,
    0.02776025049389191,
  ],
  [
    'ryugu',
    '2016-01-02T00:00:00.000Z',
    -1.058306985911253,
    0.1448393076229326,
    -0.1081952985520941,
  ],
  [
    'ryugu',
    '2025-01-01T00:00:00.000Z',
    -0.7523812149430513,
    0.6441092508752658,
    -0.09444993103516847,
  ],
  [
    'ryugu',
    '2026-01-01T00:00:00.000Z',
    1.008596726970665,
    0.4492306322012534,
    0.08335188260817043,
  ],
  [
    'ryugu',
    '2027-01-01T00:00:00.000Z',
    0.8836875561698768,
    -1.056255479896267,
    0.1208125561907056,
  ],
  [
    'ryugu',
    '2036-01-02T00:00:00.000Z',
    0.4864436419616561,
    -1.329697371994209,
    0.09146724734620514,
  ],
  [
    'ida',
    '2016-01-02T00:00:00.000Z',
    0.922677560489694,
    2.583319695032431,
    0.05202389927765255,
  ],
  [
    'ida',
    '2025-01-01T00:00:00.000Z',
    2.696052005868261,
    0.74064144636275,
    0.04332831613638746,
  ],
  [
    'ida',
    '2026-01-01T00:00:00.000Z',
    -0.2752245117051102,
    2.724134910300779,
    0.03999859252680889,
  ],
  [
    'ida',
    '2027-01-01T00:00:00.000Z',
    -2.855181258129642,
    0.3204479426479325,
    -0.0283900306905861,
  ],
  [
    'ida',
    '2036-01-02T00:00:00.000Z',
    -1.445289839963061,
    2.373797785944518,
    0.02029825611608795,
  ],
  [
    'bennu',
    '2016-01-02T00:00:00.000Z',
    -0.66351663150805,
    -1.171966383013292,
    -0.1213368243688913,
  ],
  [
    'bennu',
    '2025-01-01T00:00:00.000Z',
    0.325886969881149,
    0.8307071985188852,
    0.08655093838729493,
  ],
  [
    'bennu',
    '2026-01-01T00:00:00.000Z',
    1.020572806698367,
    -0.2286943928921342,
    -0.02786035919913888,
  ],
  [
    'bennu',
    '2027-01-01T00:00:00.000Z',
    0.4851003027982377,
    -1.160221343359038,
    -0.1243056583360768,
  ],
  [
    'bennu',
    '2036-01-02T00:00:00.000Z',
    -1.078151233624072,
    0.262975562816726,
    0.03159116224518278,
  ],
];

describe('wave A asteroids vs live JPL Horizons state vectors', () => {
  it.each(WAVE_A_VECTORS)('%s @ %s', (name, iso, x, y, z) => {
    const elements = SMALL_BODIES[name]?.orbitalElements;
    expect(elements, `${name}: missing orbitalElements`).toBeDefined();
    const p = new OrbitalElementsService().getHeliocentricAU(
      elements!,
      new Date(iso)
    );
    // `getHeliocentricAU` rend le repère de la SCÈNE (X, Z, −Y de l'écliptique) : on revient
    // à l'écliptique J2000 d'Horizons avant de comparer.
    const error = Math.hypot(p.x - x, -p.z - y, p.y - z);
    const years = Math.abs(
      (new Date(iso).getTime() - elements!.epoch.getTime()) /
        (365.25 * 86_400_000)
    );
    expect(
      error,
      `${name} @ ${iso}: ${error.toExponential(2)} AU off`
    ).toBeLessThan(years <= 1.01 ? 0.005 : 0.08);
  });
});
