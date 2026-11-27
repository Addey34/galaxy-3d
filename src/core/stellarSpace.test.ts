import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAIA_ENABLED } from '../../scripts/generate-neighbours.mjs';
import type { NeighbourFile, NeighbourRow } from './neighbours';
import {
  clampMotionYears,
  distanceFromSunPc,
  equatorialPosition,
  equatorialToGalactic,
  galacticPosition,
  galacticToScene,
  motionWindow,
  PARSECS_PER_UNIT,
  parsecsToLightYears,
  scaleRingsPc,
  separationPc,
  spaceSpeedKms,
  STELLAR_MOTION_LIMIT_YEARS,
  stellarScenePosition,
  yearsFromJ2000,
  type Vec3,
} from './stellarSpace';

const file = JSON.parse(
  readFileSync('public/assets/sky/neighbours.json', 'utf8')
) as NeighbourFile;
const byName = (name: string): NeighbourRow => {
  const row = file.stars.find((s) => s[0] === name);
  if (!row) throw new Error(`absent : ${name}`);
  return row;
};
const DEG = 180 / Math.PI;
/** Longitude et latitude galactiques (degrés) d'un vecteur galactique. */
const lb = (v: Vec3): [number, number] => [
  ((Math.atan2(v[1], v[0]) * DEG) % 360) +
    (Math.atan2(v[1], v[0]) < 0 ? 360 : 0),
  Math.asin(v[2] / Math.hypot(...v)) * DEG,
];

describe("l'espace stellaire : unités, origine, distances", () => {
  it('1 unité = 1 parsec, sans aucun autre facteur', () => {
    expect(PARSECS_PER_UNIT).toBe(1);
  });

  it('le Soleil est à l’origine : la distance au Soleil de chaque étoile est SA distance publiée', () => {
    for (const row of file.stars) {
      const p = stellarScenePosition(row, 0);
      expect(distanceFromSunPc(p), row[0]).toBeCloseTo(row[5], 9);
    }
  });

  it('la rotation vers le repère galactique et vers la scène conserve les distances', () => {
    const v: Vec3 = [1.2, -3.4, 2.1];
    // La matrice d'Hipparcos est donnée à 10 décimales : orthonormale à ~1e-10, pas à 1e-12.
    expect(Math.hypot(...equatorialToGalactic(v))).toBeCloseTo(
      Math.hypot(...v),
      8
    );
    expect(Math.hypot(...galacticToScene(v))).toBeCloseTo(Math.hypot(...v), 12);
  });

  it('le repère de la scène est direct (déterminant +1) et son Y est le pôle galactique nord', () => {
    const x = galacticToScene([1, 0, 0]);
    const y = galacticToScene([0, 1, 0]);
    const z = galacticToScene([0, 0, 1]);
    const det =
      x[0] * (y[1] * z[2] - y[2] * z[1]) -
      x[1] * (y[0] * z[2] - y[2] * z[0]) +
      x[2] * (y[0] * z[1] - y[1] * z[0]);
    expect(det).toBeCloseTo(1, 12);
    // Z galactique (le pôle nord) devient le HAUT de la scène ; X reste X.
    expect(z[0]).toBeCloseTo(0, 12);
    expect(z[1]).toBeCloseTo(1, 12);
    expect(z[2]).toBeCloseTo(0, 12);
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(0, 12);
  });

  it('le pôle galactique nord (α 192,85948°, δ +27,12825°, définition IAU) tombe sur +Z galactique', () => {
    const ra = (192.85948 * Math.PI) / 180;
    const dec = (27.12825 * Math.PI) / 180;
    const g = equatorialToGalactic([
      Math.cos(dec) * Math.cos(ra),
      Math.cos(dec) * Math.sin(ra),
      Math.sin(dec),
    ]);
    expect(g[2]).toBeGreaterThan(0.99999);
  });
});

describe.skipIf(!GAIA_ENABLED)(
  'les étoiles voisines aux bons endroits (témoins indépendants : Gaia DR3)',
  () => {
    // Longitude et latitude galactiques (l, b) lues dans l'archive Gaia DR3 le 2026-11-22 pour les
    // sources adoptées, à l'époque J2016,0 : c'est un calcul de Gaia, pas le nôtre.
    const gaia: Array<[string, number, number]> = [
      ['Proxima Centauri', 313.92549558326704, -1.9177544232946377],
      ["Barnard's Star", 31.049417957939717, 14.08660366802383],
    ];
    for (const [name, l, b] of gaia)
      it(`${name} : (l, b) à J2016 = Gaia, à 0,002° près, et la distance de la parallaxe`, () => {
        const row = byName(name);
        const g = galacticPosition(row, 16);
        const [ll, bb] = lb(g);
        expect(Math.abs(ll - l)).toBeLessThan(0.002);
        expect(Math.abs(bb - b)).toBeLessThan(0.002);
        // La distance à J2016 ne diffère de celle de J2000 que par la vitesse radiale (≤ 16 ans).
        expect(Math.abs(distanceFromSunPc(g) - row[5])).toBeLessThan(0.002);
      });

    it('Proxima est à 4,25 années-lumière du Soleil, Alpha Centauri à 4,32, Barnard à 5,96', () => {
      const ly = (n: string): number =>
        parsecsToLightYears(
          distanceFromSunPc(stellarScenePosition(byName(n), 0))
        );
      expect(ly('Proxima Centauri')).toBeCloseTo(4.2465, 3);
      expect(ly('Rigil Kentaurus')).toBeCloseTo(4.32, 2);
      expect(ly("Barnard's Star")).toBeCloseTo(5.963, 2);
    });

    it('Proxima est à environ 0,2 al d’α Cen A : la même région, comme dans le ciel', () => {
      const a = stellarScenePosition(byName('Rigil Kentaurus'), 0);
      const proxima = stellarScenePosition(byName('Proxima Centauri'), 0);
      // Séparation publiée dans la littérature : ~0,2 al ; ici ~0,07 pc selon HYG pour α Cen.
      const pc = separationPc(a, proxima);
      expect(pc).toBeGreaterThan(0.01);
      expect(pc).toBeLessThan(0.1);
      // Alpha Centauri A et B, à la même distance et au même endroit à 0,001 pc près.
      expect(
        separationPc(
          stellarScenePosition(byName('Rigil Kentaurus'), 0),
          stellarScenePosition(byName('Toliman'), 0)
        )
      ).toBeLessThan(0.002);
    });
  }
);

describe('mouvement rectiligne', () => {
  it('à J2000 la position ne dépend ni du mouvement propre ni de la vitesse radiale', () => {
    const row = byName("Barnard's Star");
    const frozen = [...row] as unknown as NeighbourRow & number[];
    (frozen as number[])[8] = 0;
    (frozen as number[])[9] = 0;
    (frozen as number[])[10] = 0;
    expect(equatorialPosition(row, 0)).toEqual(equatorialPosition(frozen, 0));
  });

  it('la vitesse spatiale retrouvée par différence de positions = tangentielle + radiale publiées', () => {
    const row = byName("Barnard's Star");
    const years = 1000;
    const a = equatorialPosition(row, 0);
    const b = equatorialPosition(row, years);
    const pc = separationPc(a, b);
    const { tangential, radial } = spaceSpeedKms(row);
    const kmsToPcPerYear = 31_557_600 / 3.085677581491367e13;
    const expected =
      Math.hypot(tangential, radial ?? 0) * kmsToPcPerYear * years;
    // 4,74047 km/s par (″/an · pc) est une constante ARRONDIE : 1e-4 relatif.
    expect(Math.abs(pc / expected - 1)).toBeLessThan(2e-4);
    // Barnard : environ 90 km/s tangentiels et 110 km/s en approche.
    expect(tangential).toBeGreaterThan(85);
    expect(tangential).toBeLessThan(95);
    expect(radial).toBeLessThan(-100);
  });

  it('Barnard se rapproche : sa distance au Soleil diminue pendant 1 000 ans, puis Proxima s’éloigne', () => {
    const d = (n: string, y: number): number =>
      distanceFromSunPc(stellarScenePosition(byName(n), y));
    expect(d("Barnard's Star", 1000)).toBeLessThan(d("Barnard's Star", 0));
    // Proxima a une vitesse radiale négative aussi (elle se rapproche légèrement).
    expect(byName('Proxima Centauri')[10]).toBeLessThan(0);
  });

  it('sans vitesse radiale publiée, la position ne dérive que latéralement (jamais inventée)', () => {
    const row = file.stars.find((s) => s[10] === null)!;
    const years = 2000;
    const p0 = equatorialPosition(row, 0);
    const p1 = equatorialPosition(row, years);
    // Le déplacement est perpendiculaire à la ligne de visée : le produit scalaire avec p0 est nul.
    const dot =
      (p1[0] - p0[0]) * p0[0] +
      (p1[1] - p0[1]) * p0[1] +
      (p1[2] - p0[2]) * p0[2];
    expect(Math.abs(dot) / (row[5] * row[5])).toBeLessThan(1e-6);
  });

  it('la durée est bornée à ±10 000 ans : au-delà la position ne bouge plus (falsification : sans borne elle bougerait)', () => {
    const row = byName("Barnard's Star");
    expect(STELLAR_MOTION_LIMIT_YEARS).toBe(10_000);
    expect(clampMotionYears(50_000)).toBe(10_000);
    expect(clampMotionYears(-50_000)).toBe(-10_000);
    expect(equatorialPosition(row, 50_000)).toEqual(
      equatorialPosition(row, 10_000)
    );
    expect(
      separationPc(equatorialPosition(row, 10_000), equatorialPosition(row, 0))
    ).toBeGreaterThan(1);
  });

  it('années depuis J2000 : 2000-01-01 12:00 → 0, +1 an julien → 1', () => {
    expect(yearsFromJ2000(new Date('2000-01-01T12:00:00Z'))).toBe(0);
    expect(
      yearsFromJ2000(new Date(Date.UTC(2000, 0, 1, 12) + 365.25 * 86_400_000))
    ).toBeCloseTo(1, 12);
  });
});

describe("l'échelle", () => {
  it('un cercle par parsec jusqu’au plus lointain, jamais moins de un', () => {
    expect(scaleRingsPc(0.2)).toEqual([1]);
    expect(scaleRingsPc(4.83)).toEqual([1, 2, 3, 4, 5]);
    expect(scaleRingsPc(5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('un parsec vaut 3,2616 années-lumière', () => {
    expect(parsecsToLightYears(1)).toBeCloseTo(3.26156, 5);
  });
});

describe('la fenêtre du curseur de temps', () => {
  const LIMIT = STELLAR_MOTION_LIMIT_YEARS;
  const STEP = 100;
  const cases: Array<[string, Date]> = [
    ['une scène de 2026', new Date('2026-09-15T11:00:00Z')],
    ['J2000', new Date(Date.UTC(2000, 0, 1, 12))],
    ['une date historique (1969)', new Date('1969-07-20T20:17:00Z')],
    ['une date lointaine (an 13000)', new Date('+013000-01-01T00:00:00Z')],
  ];

  for (const [label, date] of cases) {
    it(`${label} : aux deux extrémités, curseur, année et calcul décrivent le même instant`, () => {
      const sceneYears = yearsFromJ2000(date);
      const w = motionWindow(sceneYears, STEP);
      expect(Math.abs(w.min % STEP)).toBe(0);
      expect(Math.abs(w.max % STEP)).toBe(0);
      expect(w.min).toBeLessThanOrEqual(0);
      expect(w.max).toBeGreaterThanOrEqual(0);
      for (const offset of [w.min, 0, w.max]) {
        // L'instant décrit par le curseur : ce que la vue affiche (2000 + années) ET ce que le calcul utilise.
        const used = w.base + offset;
        expect(used).toBeGreaterThanOrEqual(-LIMIT);
        expect(used).toBeLessThanOrEqual(LIMIT);
        expect(clampMotionYears(used)).toBe(used);
        const displayedYear = 2000 + used;
        expect(displayedYear - 2000).toBeCloseTo(used, 9);
      }
      // L'extrémité est la plus proche de la limite que le pas permet : moins d'un pas d'écart.
      expect(LIMIT - (w.base + w.max)).toBeLessThan(STEP);
      expect(w.base + w.min + LIMIT).toBeLessThan(STEP);
    });
  }

  it('une scène de 2026 : le curseur ne dépasse plus ce que le calcul applique (régression 12 026 contre 10 000)', () => {
    const sceneYears = yearsFromJ2000(new Date('2026-09-15T11:00:00Z'));
    const w = motionWindow(sceneYears, STEP);
    expect(w.max).toBe(9900);
    expect(w.min).toBe(-10000);
    expect(sceneYears + w.max).toBeLessThan(LIMIT);
  });

  it('une scène hors de la fenêtre est ramenée à son bord, jamais au-delà', () => {
    const w = motionWindow(
      yearsFromJ2000(new Date('+013000-01-01T00:00:00Z')),
      STEP
    );
    expect(w.base).toBe(LIMIT);
    expect(w.max).toBe(0);
    expect(Object.is(w.max, -0)).toBe(false);
  });
});
