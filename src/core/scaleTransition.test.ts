import { describe, expect, it } from 'vitest';
import { equatorialToScene } from './frames';
import {
  AU_PER_PARSEC,
  auToParsecs,
  easeInOut,
  ECLIPTIC_RINGS_AU,
  fieldWidthPc,
  homeDirection,
  OPENING_ELEVATION_RAD,
  FIELD_AU_LIMIT_PC,
  parsecsToAu,
  readField,
  START_DISTANCE_AU,
  TRANSITION_MS,
  transitionDistancePc,
  transitionProgress,
} from './scaleTransition';
import { solarSceneToStellar, type Vec3 } from './stellarSpace';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

describe('les unités du changement d’échelle', () => {
  it('un parsec vaut 206 264,806 UA (648 000 / π, définition exacte)', () => {
    expect(AU_PER_PARSEC).toBeCloseTo(206_264.806247, 5);
    expect(parsecsToAu(auToParsecs(37))).toBeCloseTo(37, 9);
  });

  it('la largeur du champ est 2 d tan(fov/2) × aspect', () => {
    // fov 90° : tan 45° = 1, donc la largeur est 2 d × aspect.
    expect(fieldWidthPc(3, 90, 1)).toBeCloseTo(6, 12);
    expect(fieldWidthPc(3, 90, 1.5)).toBeCloseTo(9, 12);
  });

  it('se lit en UA dans le Système solaire, en années-lumière au-delà', () => {
    const near = readField(auToParsecs(100));
    expect(near.unit).toBe('au');
    if (near.unit === 'au') expect(near.au).toBeCloseTo(100, 9);
    const far = readField(2);
    expect(far.unit).toBe('ly');
    if (far.unit === 'ly') {
      expect(far.pc).toBe(2);
      expect(far.ly).toBeCloseTo(6.5231, 3);
    }
    expect(readField(FIELD_AU_LIMIT_PC * 0.999).unit).toBe('au');
    expect(readField(FIELD_AU_LIMIT_PC).unit).toBe('ly');
  });
});

describe('la progression de la transition', () => {
  const start = auToParsecs(START_DISTANCE_AU);
  const end = 10.5;

  it('part exactement du début, arrive exactement à la fin, sans dépasser', () => {
    expect(transitionDistancePc(0, start, end)).toBe(start);
    expect(transitionDistancePc(1, start, end)).toBe(end);
    expect(transitionDistancePc(-3, start, end)).toBe(start);
    expect(transitionDistancePc(7, start, end)).toBe(end);
    expect(transitionProgress(-5)).toBe(0);
    expect(transitionProgress(TRANSITION_MS * 4)).toBe(1);
  });

  it('est GÉOMÉTRIQUE : le rapport des distances suit l’adoucissement, jamais une droite', () => {
    for (const p of [0.1, 0.3, 0.5, 0.8]) {
      const d = transitionDistancePc(p, start, end);
      expect(Math.log(d / start) / Math.log(end / start)).toBeCloseTo(
        easeInOut(p),
        12
      );
      // Une interpolation linéaire serait déjà proche de la fin : la progression géométrique, non.
      expect(d).toBeLessThan(start + (end - start) * p);
    }
  });

  it('croît strictement du début à la fin', () => {
    let previous = 0;
    for (let i = 0; i <= 100; i++) {
      const d = transitionDistancePc(i / 100, start, end);
      expect(d).toBeGreaterThanOrEqual(previous);
      previous = d;
    }
  });

  it('couvre plus de quatre ordres de grandeur, de 70 UA à environ 10 pc', () => {
    expect(Math.log10(end / start)).toBeGreaterThan(4.4);
    expect(ECLIPTIC_RINGS_AU[0]).toBe(1);
    expect(ECLIPTIC_RINGS_AU.at(-1)).toBeGreaterThan(START_DISTANCE_AU);
  });
});

describe('le regard : de la scène solaire à la scène stellaire', () => {
  const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
  const lb = (v: Vec3): { l: number; b: number } => {
    // Scène stellaire : X = x, Y = z, Z = −y (x centre, y rotation, z pôle nord galactique).
    const x = v[0];
    const y = -v[2];
    const z = v[1];
    return {
      l: (Math.atan2(y, x) * DEG + 360) % 360,
      b: Math.asin(z / length(v)) * DEG,
    };
  };

  it('conserve les longueurs (rotation pure, sans échelle)', () => {
    const v: Vec3 = [0.3, -1.2, 2.5];
    expect(length(solarSceneToStellar(v))).toBeCloseTo(length(v), 9);
  });

  it('le nord écliptique (+Y solaire) est à l ≈ 96,38°, b ≈ +29,81° (pôle écliptique, valeur publiée)', () => {
    const { l, b } = lb(solarSceneToStellar([0, 1, 0]));
    expect(l).toBeCloseTo(96.384, 1);
    expect(b).toBeCloseTo(29.811, 1);
  });

  it('la direction du centre galactique (α 266,405°, δ −28,936°) tombe sur +X de la scène stellaire', () => {
    const ra = 266.405 * RAD;
    const dec = -28.936 * RAD;
    const eq: Vec3 = [
      Math.cos(dec) * Math.cos(ra),
      Math.cos(dec) * Math.sin(ra),
      Math.sin(dec),
    ];
    const solar = equatorialToScene(eq[0], eq[1], eq[2]);
    const out = solarSceneToStellar([solar.x, solar.y, solar.z]);
    expect(out[0]).toBeGreaterThan(0.9999);
    expect(Math.abs(out[1])).toBeLessThan(2e-3);
    expect(Math.abs(out[2])).toBeLessThan(2e-3);
  });

  it('un cercle de l’écliptique reste un cercle de même rayon, incliné de 60,2° sur le plan galactique', () => {
    const r = 5;
    const pts: Vec3[] = [];
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2;
      pts.push(solarSceneToStellar([Math.cos(a) * r, 0, Math.sin(a) * r]));
    }
    for (const p of pts) expect(length(p)).toBeCloseTo(r, 9);
    // Hauteur maximale au-dessus du plan galactique (Y de la scène stellaire) = r sin(inclinaison).
    const top = Math.max(...pts.map((p) => p[1]));
    expect(top / r).toBeCloseTo(Math.sin(60.19 * RAD), 2);
  });
});

describe('la direction d’arrivée garde le cap du regard', () => {
  const unit = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

  it('sans regard, ou regard le long de l’axe : la direction d’ouverture, unitaire', () => {
    const open = homeDirection(null);
    expect(unit(open)).toBeCloseTo(1, 12);
    expect(homeDirection([0, 1, 0])).toEqual(open);
    expect(homeDirection([0, -1, 0])).toEqual(open);
  });

  it('la caméra est à l’opposé du regard : elle regarde le Soleil du même côté du ciel', () => {
    const d = homeDirection([1, 0, 0]);
    expect(d[0]).toBeLessThan(0);
    expect(Math.abs(d[2])).toBeLessThan(1e-12);
    const e = homeDirection([0, 0, -1]);
    expect(e[2]).toBeGreaterThan(0);
  });

  it('l’élévation est toujours celle d’ouverture, quel que soit le regard (même rasant)', () => {
    for (const g of [
      [1, 0, 0],
      [0.3, 0.9, -0.2],
      [-0.5, -0.7, 0.5],
      [0, 0.001, 1],
    ] as Vec3[]) {
      const d = homeDirection(g);
      expect(unit(d)).toBeCloseTo(1, 12);
      expect(Math.asin(d[1])).toBeCloseTo(OPENING_ELEVATION_RAD, 12);
    }
  });

  it('le cap suit le regard : deux regards de même cap horizontal donnent la même direction', () => {
    const a = homeDirection([1, 0.2, 1]);
    const b = homeDirection([2, -0.9, 2]);
    expect(a[0]).toBeCloseTo(b[0], 12);
    expect(a[2]).toBeCloseTo(b[2], 12);
  });
});
