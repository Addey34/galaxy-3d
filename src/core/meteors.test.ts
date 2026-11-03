import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  angularDiffDeg,
  inActivityWindow,
  meteorRadiant,
  parseMeteorsFile,
  radiantDirection,
  sunLongitudeJ2000,
  type MeteorShower,
} from './meteors';

const FILE = parseMeteorsFile(
  JSON.parse(readFileSync('public/assets/sky/meteors.json', 'utf8'))
);
const byCode = (code: string): MeteorShower => {
  const s = FILE.showers.find((x) => x[1] === code);
  if (!s) throw new Error(`pluie ${code} absente`);
  return s;
};

describe('longitude solaire J2000', () => {
  it("vaut ~280,4° à J2000 (la précession y est nulle) et ~359,6° à l'équinoxe de mars 2026", () => {
    expect(
      Math.abs(
        angularDiffDeg(
          sunLongitudeJ2000(new Date('2000-01-01T12:00:00Z')),
          280.4
        )
      )
    ).toBeLessThan(0.3);
    // Équinoxe de mars 2026 : 20 mars, ~14:46 UTC. L'écliptique de la date y donne 0°, le J2000 0° − 0,375°.
    const lon = sunLongitudeJ2000(new Date('2026-03-20T14:46:00Z'));
    expect(angularDiffDeg(lon, -0.375)).toBeGreaterThan(-0.1);
    expect(angularDiffDeg(lon, -0.375)).toBeLessThan(0.1);
  });
});

describe("fenêtre d'activité", () => {
  it('franchit 360° quand le début dépasse la fin', () => {
    expect(inActivityWindow(5, 350, 20)).toBe(true);
    expect(inActivityWindow(355, 350, 20)).toBe(true);
    expect(inActivityWindow(180, 350, 20)).toBe(false);
    expect(inActivityWindow(100, 90, 120)).toBe(true);
    expect(inActivityWindow(121, 90, 120)).toBe(false);
  });
});

describe('le fichier livré, confronté à des pics que tout observateur connaît', () => {
  it('les Perséides sont actives vers le 12 août, pas en mars', () => {
    const per = byCode('PER');
    expect(
      meteorRadiant(per, sunLongitudeJ2000(new Date('2026-08-12T20:00:00Z')))
        .active
    ).toBe(true);
    expect(
      meteorRadiant(per, sunLongitudeJ2000(new Date('2026-03-01T12:00:00Z')))
        .active
    ).toBe(false);
  });

  it('les Géminides sont actives le 14 décembre, leur radiant dans les Gémeaux', () => {
    const gem = meteorRadiant(
      byCode('GEM'),
      sunLongitudeJ2000(new Date('2026-12-14T12:00:00Z'))
    );
    expect(gem.active).toBe(true);
    expect(Math.abs(gem.raDeg - 113)).toBeLessThan(3);
    expect(Math.abs(gem.decDeg - 32)).toBeLessThan(3);
  });

  it('les Quadrantides sont actives le 3 janvier et pas le 3 juillet', () => {
    const qua = byCode('QUA');
    expect(
      meteorRadiant(qua, sunLongitudeJ2000(new Date('2026-01-03T12:00:00Z')))
        .active
    ).toBe(true);
    expect(
      meteorRadiant(qua, sunLongitudeJ2000(new Date('2026-07-03T12:00:00Z')))
        .active
    ).toBe(false);
  });

  it('le radiant dérive : une semaine avant le pic, les Géminides sont à plusieurs degrés en ascension droite', () => {
    const gem = byCode('GEM');
    const peak = meteorRadiant(gem, gem[5]);
    const before = meteorRadiant(gem, gem[5] - 7 * 0.9856);
    // Dérive publiée ~ +1,04°/jour en ascension droite.
    expect(peak.raDeg - before.raDeg).toBeGreaterThan(5);
    expect(peak.raDeg - before.raDeg).toBeLessThan(9);
  });

  it('ne prolonge pas la dérive au-delà de la fenêtre décrite par la source', () => {
    const gem = byCode('GEM');
    const edge = meteorRadiant(gem, gem[4]);
    const far = meteorRadiant(gem, gem[4] + 60);
    expect(far.active).toBe(false);
    expect(far.raDeg).toBeCloseTo(edge.raDeg, 6);
  });

  it('toute pluie est active à sa longitude solaire moyenne, à la position publiée', () => {
    for (const s of FILE.showers) {
      const r = meteorRadiant(s, s[5]);
      expect(r.active, s[2]).toBe(true);
      expect(r.raDeg, s[2]).toBeCloseTo(s[6], 6);
      expect(r.decDeg, s[2]).toBeCloseTo(s[7], 6);
    }
  });

  it('chaque pluie garde son pic dans sa fenêtre, et sa dérive est publiée en degrés par jour plausibles', () => {
    for (const s of FILE.showers) {
      expect(inActivityWindow(s[5], s[3], s[4]), s[2]).toBe(true);
      // Près du pôle l'ascension droite change vite (mesuré : 6°/jour pour epsilon-Ursae Minorids) ;
      // la déclinaison, elle, ne dépasse jamais quelques degrés par jour.
      if (s[8] !== null) expect(Math.abs(s[8]), s[2]).toBeLessThan(10);
      if (s[9] !== null) expect(Math.abs(s[9]), s[2]).toBeLessThan(5);
    }
  });
});

describe('couverture du calendrier', () => {
  it('au moins une pluie est active à toute longitude solaire (la couche n’a pas d’état « aucune pluie »)', () => {
    for (let lon = 0; lon < 360; lon += 0.5) {
      const n = FILE.showers.filter((s) =>
        inActivityWindow(lon, s[3], s[4])
      ).length;
      expect(n, `λ☉ ${lon}`).toBeGreaterThan(0);
    }
  });
});

describe('radiantDirection', () => {
  it('rend un vecteur unitaire', () => {
    const v = new Float64Array(3);
    radiantDirection(113, 32, v);
    expect(Math.hypot(v[0]!, v[1]!, v[2]!)).toBeCloseTo(1, 12);
    radiantDirection(0, 90, v);
    expect(v[2]).toBeCloseTo(1, 12);
  });
});

describe('parseMeteorsFile', () => {
  it('refuse une forme inconnue, un fichier vide et une ligne illisible', () => {
    expect(() => parseMeteorsFile(null)).toThrow();
    expect(() => parseMeteorsFile({ showers: [] })).toThrow(/aucune pluie/);
    expect(() => parseMeteorsFile({ showers: [[1, 'X']] })).toThrow(
      /illisible/
    );
    const bad = [...FILE.showers[0]!];
    bad[6] = Number.NaN;
    expect(() => parseMeteorsFile({ showers: [bad] })).toThrow(/illisible/);
  });
});
