import { describe, expect, it } from 'vitest';
import {
  SMALL_BODIES,
  SMALL_BODY_ELEMENTS,
  smallBodyToConfig,
} from './smallBodies';
import { OrbitalElementsService } from '@/core/OrbitalElementsService';
import { keplerianPositionEcliptic } from '@/core/kepler';
import referenceVectorsUntyped from './smallBodyReferenceVectors.json';

// L'import JSON élargit les tuples : on redonne au fixture le type exact qu'il porte.
interface ReferenceVectors {
  waveA: readonly (readonly [string, string, number, number, number])[];
  epoch: Readonly<Record<string, readonly [number, number, number]>>;
}
const referenceVectors = referenceVectorsUntyped as unknown as ReferenceVectors;

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
// La donnée vit dans `smallBodyReferenceVectors.json` (relevés Horizons, jamais saisis
// ici) : ajouter un corps n'exige plus de toucher à ce fichier.
const WAVE_A_VECTORS: readonly (readonly [
  string,
  string,
  number,
  number,
  number,
])[] = referenceVectors.waveA;

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

/**
 * Chaque jeu d'éléments du catalogue contre le vecteur d'état Horizons À SON ÉPOQUE.
 *
 * À t = époque, la position képlérienne ne dépend d'aucune constante gravitationnelle ni
 * d'aucune perturbation : un écart y prouve un élément faux, sans excuse de modèle. C'est
 * exactement ce qui était passé inaperçu pour Cérès, Éris, Hauméa, Makémaké et Pluton, dont
 * les éléments recopiés à la main étaient faux dès l'époque (Cérès : maDeg 95,989 au lieu de
 * 6,177, soit 5,8e8 km ; Éris 1,5e9 km). Les vecteurs viennent de
 * `pnpm ephemeris:small-body` (TLIST = l'époque exacte, écliptique J2000), centre Soleil, ou
 * barycentre (`--center 500@0`) pour les corps marqués `barycentric`.
 *
 * Tolérance mesurée : ≤ 6e-11 UA (≈ 9 m, arrondi des éléments imprimés par Horizons) sur les
 * 18 corps, d'où 1e-8 UA (1,5 km). Une anomalie moyenne décalée de 0,001° déplace Cérès de
 * ~7 000 km, et la copie périmée de Gonggong (solution Horizons raffinée) était à 980 km.
 */
// Même donnée, même fichier : le vecteur À l'époque de chaque corps.
const EPOCH_VECTORS: Readonly<
  Record<string, readonly [number, number, number]>
> = referenceVectors.epoch;

describe('every small-body element set vs its Horizons state vector at its epoch', () => {
  it.each(SMALL_BODY_ELEMENTS.map((el) => [el.name, el.epoch] as const))(
    '%s @ %s',
    (name, epochIso) => {
      const epoch = new Date(epochIso);
      const waveA = WAVE_A_VECTORS.find(
        ([n, iso]) => n === name && new Date(iso).getTime() === epoch.getTime()
      );
      const truth =
        EPOCH_VECTORS[name] ?? (waveA ? [waveA[2], waveA[3], waveA[4]] : null);
      // Un corps ajouté sans vecteur à son époque échoue ici : le garde couvre TOUT le socle.
      expect(
        truth,
        `${name}: no Horizons vector at ${epochIso}`
      ).not.toBeNull();
      // Dans le repère PROPRE des éléments (Soleil, ou barycentre pour `barycentric`) : le
      // décalage barycentre→Soleil a son propre test ci-dessous.
      const p = keplerianPositionEcliptic(
        SMALL_BODIES[name]!.orbitalElements!,
        epoch
      );
      const [x, y, z] = truth!;
      const error = Math.hypot(p.x - x, p.y - y, p.z - z);
      expect(
        error,
        `${name} @ ${epochIso}: ${error.toExponential(2)} AU off`
      ).toBeLessThan(1e-8);
    }
  );
});

/**
 * Les éléments `barycentric` jusqu'à la position HÉLIOCENTRIQUE servie à la scène, contre les
 * vecteurs Horizons centre Soleil (500@10), à l'époque et à ±10 ans. Deux choses tenues :
 *   - le décalage barycentre→Soleil (sans lui, Éris est à 7,1e-3 UA en 2000, la distance
 *     Soleil-barycentre) ;
 *   - le μ augmenté des planètes (sans lui, l'anomalie moyenne dérive de 0,067 % par tour).
 * Mesuré : ≤ 6,9e-6 UA à l'époque (précision du barycentre d'astronomy-engine, ~1 000 km),
 * ≤ 3,3e-5 UA à ±10 ans (Makémaké, perturbations) ; d'où 1e-4 UA (15 000 km).
 */
const BARYCENTRIC_HELIO_VECTORS = [
  [
    'eris',
    '2000-01-01T12:00:00Z',
    88.39334192770119,
    30.76524538912099,
    -26.09439027514957,
  ],
  [
    'eris',
    '1990-01-01T00:00:00Z',
    88.92053794815993,
    27.16242392556952,
    -29.20933663427215,
  ],
  [
    'eris',
    '2010-01-01T00:00:00Z',
    87.47527749300113,
    34.22668165530747,
    -22.8665462816253,
  ],
  [
    'sedna',
    '2000-01-01T12:00:00Z',
    61.95077806808445,
    63.87632758113101,
    -18.58921559765201,
  ],
  [
    'makemake',
    '1990-01-01T00:00:00Z',
    -40.38933430845128,
    18.99240153522257,
    23.94040602597005,
  ],
  [
    'makemake',
    '2010-01-01T00:00:00Z',
    -45.51817598040682,
    3.622240614329881,
    25.17628937170614,
  ],
] as const;

describe('barycentric elements are served heliocentric', () => {
  it.each(BARYCENTRIC_HELIO_VECTORS)('%s @ %s', (name, iso, x, y, z) => {
    const elements = SMALL_BODIES[name]!.orbitalElements!;
    expect(elements.barycentric).toBe(true);
    const p = new OrbitalElementsService().getHeliocentricAU(
      elements,
      new Date(iso)
    );
    const error = Math.hypot(p.x - x, -p.z - y, p.y - z);
    expect(
      error,
      `${name} @ ${iso}: ${error.toExponential(2)} AU off`
    ).toBeLessThan(1e-4);
  });
});
