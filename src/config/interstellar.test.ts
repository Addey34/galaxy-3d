import { describe, expect, it } from 'vitest';
import {
  INTERSTELLAR_OBJECTS,
  INTERSTELLAR_TRAJECTORY_SAMPLES,
  INTERSTELLAR_WINDOW_YEARS,
  interstellarWindow,
} from './interstellar';
import {
  keplerianPositionEcliptic,
  sampleHyperbolicTrajectory,
} from '@/core/kepler';

const byName = (name: string) => {
  const object = INTERSTELLAR_OBJECTS.find((o) => o.name === name);
  if (!object) throw new Error(`objet interstellaire absent : ${name}`);
  return object;
};

const JD_UNIX_EPOCH = 2_440_587.5;
const jdToDate = (jd: number): Date =>
  new Date((jd - JD_UNIX_EPOCH) * 86_400_000);

describe('INTERSTELLAR_OBJECTS', () => {
  it('lists the three known interstellar objects, all on hyperbolas (e > 1, a < 0)', () => {
    expect(INTERSTELLAR_OBJECTS.map((o) => o.name)).toEqual([
      'oumuamua',
      'borisov',
      'atlas',
    ]);
    for (const { name, elements } of INTERSTELLAR_OBJECTS) {
      expect(elements.eccentricity, name).toBeGreaterThan(1);
      expect(elements.semiMajorAxisAU, name).toBeLessThan(0);
    }
  });

  it('keeps marker colours distinct', () => {
    expect(new Set(INTERSTELLAR_OBJECTS.map((o) => o.color)).size).toBe(
      INTERSTELLAR_OBJECTS.length
    );
  });

  /**
   * Le périhélie est DÉRIVÉ des éléments (époque + anomalie moyenne), pas stocké. On le compare
   * au Tp qu'Horizons publie pour la même solution : c'est ce qui vérifie qu'aucune anomalie
   * moyenne n'a été prise à une autre époque que celle déclarée.
   */
  it.each([
    ['oumuamua', 2_458_006.007321375],
    ['borisov', 2_458_826.052845906],
    ['atlas', 2_460_977.995262848],
  ] as const)(
    '%s perihelion matches Horizons Tp to the minute',
    (name, tpJd) => {
      const { perihelion } = interstellarWindow(byName(name));
      expect(
        Math.abs(perihelion.getTime() - jdToDate(tpJd).getTime())
      ).toBeLessThan(60_000);
    }
  );
});

/**
 * Régression de position contre les vecteurs d'état JPL Horizons (héliocentriques,
 * écliptique J2000, UA), relevés en direct par `node scripts/derive-interstellar-elements.mjs
 * --vectors` : avant, au, et après le périhélie, jusqu'aux bords de la fenêtre affichée.
 *
 * Tolérance : 0,2 % de la distance + 0,001 UA. Écart mesuré au moment du relevé : ≤ 0,1 %
 * partout, sauf au périhélie de 1I (0,3 % de 0,26 UA, soit 7,8e-4 UA — d'où le terme absolu).
 * Horizons intègre les perturbations planétaires et les accélérations non gravitationnelles ;
 * le modèle, lui, est une conique fixe. Cet écart-là est la limite du modèle, pas un défaut.
 * Une anomalie moyenne mal époquée, un M réduit modulo 2π ou un signe inversé dans le plan
 * orbital produisent des écarts de plusieurs UA et échouent ici.
 */
const HORIZONS_VECTORS: readonly (readonly [
  string,
  string,
  number,
  number,
  number,
])[] = [
  [
    'oumuamua',
    '1997-09-10T00:00:00.000Z',
    15.1927015675667,
    -62.01630787931504,
    97.43820960869807,
  ], // Tp -20 an(s)
  [
    'oumuamua',
    '2012-09-09T00:00:00.000Z',
    3.53479059019552,
    -16.91645561390073,
    26.19517793778551,
  ], // Tp -5 an(s)
  [
    'oumuamua',
    '2016-09-09T00:00:00.000Z',
    0.2984679142736559,
    -4.254900397589189,
    6.209680971451283,
  ], // Tp -1 an(s)
  [
    'oumuamua',
    '2017-09-10T00:00:00.000Z',
    -0.1426210542487285,
    0.07581293519475449,
    -0.1995686636211733,
  ], // Tp +0 an(s)
  [
    'oumuamua',
    '2018-09-10T00:00:00.000Z',
    6.986116029737794,
    1.504840867861513,
    2.394364509016872,
  ], // Tp +1 an(s)
  [
    'oumuamua',
    '2022-09-10T00:00:00.000Z',
    28.68734752112798,
    4.765237435250004,
    11.84799483757036,
  ], // Tp +5 an(s)
  [
    'oumuamua',
    '2037-09-10T00:00:00.000Z',
    105.9731427745965,
    16.28068255389589,
    45.66156571486869,
  ], // Tp +20 an(s)
  [
    'borisov',
    '1999-12-09T00:00:00.000Z',
    57.55343854824583,
    84.74663446936636,
    94.37650900242967,
  ], // Tp -20 an(s)
  [
    'borisov',
    '2014-12-08T00:00:00.000Z',
    13.4288038748838,
    23.25899726314998,
    24.10421035774394,
  ], // Tp -5 an(s)
  [
    'borisov',
    '2018-12-08T00:00:00.000Z',
    1.348885536593186,
    6.244930175827875,
    4.757915020362089,
  ], // Tp -1 an(s)
  [
    'borisov',
    '2019-12-09T00:00:00.000Z',
    -1.636854719979979,
    0.9362000832543587,
    -0.6859083441002009,
  ], // Tp +0 an(s)
  [
    'borisov',
    '2020-12-08T00:00:00.000Z',
    -1.7259206621682,
    -6.02420123303812,
    -4.91320107881081,
  ], // Tp +1 an(s)
  [
    'borisov',
    '2024-12-08T00:00:00.000Z',
    -0.1608687390571861,
    -30.90910380361567,
    -18.58710824451922,
  ], // Tp +5 an(s)
  [
    'borisov',
    '2039-12-09T00:00:00.000Z',
    5.806827758503027,
    -121.3691380665215,
    -68.0471574597588,
  ], // Tp +20 an(s)
  [
    'atlas',
    '2005-10-29T00:00:00.000Z',
    96.8615116474789,
    -225.7226298914374,
    10.15850029059988,
  ], // Tp -20 an(s)
  [
    'atlas',
    '2020-10-29T00:00:00.000Z',
    23.3560187539867,
    -57.44219318738158,
    2.652521604027106,
  ], // Tp -5 an(s)
  [
    'atlas',
    '2024-10-29T00:00:00.000Z',
    3.637887528174545,
    -12.26407759152913,
    0.6372180570649636,
  ], // Tp -1 an(s)
  [
    'atlas',
    '2025-10-29T00:00:00.000Z',
    -1.308221312522443,
    -0.3469102774098815,
    0.09204588345817627,
  ], // Tp +0 an(s)
  [
    'atlas',
    '2026-10-30T00:00:00.000Z',
    -2.66022869404392,
    12.51275020013433,
    -0.6991330898377687,
  ], // Tp +1 an(s)
  [
    'atlas',
    '2030-10-30T00:00:00.000Z',
    -6.893931603299423,
    61.56794104111651,
    -3.750188665613829,
  ], // Tp +5 an(s)
  [
    'atlas',
    '2045-10-29T00:00:00.000Z',
    -22.61689033312649,
    244.3515571919829,
    -15.11965012002742,
  ], // Tp +20 an(s)
];

describe('interstellar positions vs live JPL Horizons state vectors', () => {
  it.each(HORIZONS_VECTORS)('%s @ %s', (name, iso, x, y, z) => {
    const p = keplerianPositionEcliptic(byName(name).elements, new Date(iso));
    const r = Math.hypot(x, y, z);
    const error = Math.hypot(p.x - x, p.y - y, p.z - z);
    expect(
      error,
      `${name} @ ${iso}: ${error.toExponential(2)} AU off at r = ${r.toFixed(3)} AU`
    ).toBeLessThan(0.002 * r + 0.001);
  });

  it('covers the displayed window edge to edge, on both legs', () => {
    for (const object of INTERSTELLAR_OBJECTS) {
      const { from, to } = interstellarWindow(object);
      const dates = HORIZONS_VECTORS.filter(([n]) => n === object.name).map(
        ([, iso]) => new Date(iso).getTime()
      );
      // Un jour de marge : les références tombent au minuit TDB le plus proche.
      const day = 86_400_000;
      expect(Math.min(...dates), object.name).toBeLessThanOrEqual(
        from.getTime() + day
      );
      expect(Math.max(...dates), object.name).toBeGreaterThanOrEqual(
        to.getTime() - day
      );
    }
  });
});

describe('interstellarWindow', () => {
  it(`spans ±${INTERSTELLAR_WINDOW_YEARS} Julian years around perihelion`, () => {
    const { from, perihelion, to } = interstellarWindow(byName('atlas'));
    const year = 365.25 * 86_400_000;
    expect((perihelion.getTime() - from.getTime()) / year).toBeCloseTo(
      INTERSTELLAR_WINDOW_YEARS,
      9
    );
    expect((to.getTime() - perihelion.getTime()) / year).toBeCloseTo(
      INTERSTELLAR_WINDOW_YEARS,
      9
    );
  });
});

/**
 * Le défaut de Halley, version trajectoire ouverte. Échantillonnée uniformément dans le TEMPS,
 * la ligne de 1I franchissait 178,5° entre deux points consécutifs et ne descendait jamais sous
 * 2,17 × q : le virage du périhélie disparaissait dans une corde droite. Ce garde-fou mesure
 * la ligne réellement tracée (même nombre de points que la couche instrument).
 */
describe('interstellar trajectory line sampling', () => {
  it.each(INTERSTELLAR_OBJECTS.map((o) => [o.name, o] as const))(
    '%s: reaches perihelion and never jumps more than 5° between samples',
    (_name, object) => {
      const { from, to } = interstellarWindow(object);
      const points = sampleHyperbolicTrajectory(
        object.elements,
        from,
        to,
        INTERSTELLAR_TRAJECTORY_SAMPLES
      );
      const { semiMajorAxisAU: a, eccentricity: e } = object.elements;
      const q = Math.abs(a) * (e - 1);

      let minRadius = Infinity;
      let maxGapDeg = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const r = Math.hypot(p.x, p.y, p.z);
        minRadius = Math.min(minRadius, r);
        if (i === 0) continue;
        const prev = points[i - 1];
        const cos =
          (p.x * prev.x + p.y * prev.y + p.z * prev.z) /
          (r * Math.hypot(prev.x, prev.y, prev.z));
        maxGapDeg = Math.max(
          maxGapDeg,
          (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
        );
      }
      expect(minRadius / q).toBeLessThan(1.001);
      expect(maxGapDeg).toBeLessThan(5);
    }
  );
});
