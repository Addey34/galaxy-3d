import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  starAppearance,
  starColor,
  starDirection,
  yearsSinceJ2000,
  type StarCatalogueFile,
  type StarRow,
} from './starCatalogue';

const file = JSON.parse(
  readFileSync('public/assets/sky/stars.json', 'utf8')
) as StarCatalogueFile;
const find = (name: string) => file.stars.find((s) => s[8] === name)!;
const dir = (s: StarRow, years: number) => {
  const o = [0, 0, 0];
  starDirection(s, years, o);
  return o;
};
const angleDeg = (a: number[], b: number[]) =>
  (Math.acos(
    Math.max(-1, Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!))
  ) *
    180) /
  Math.PI;

describe("catalogue d'étoiles livré", () => {
  it("a la forme que ses champs annoncent et le compte qu'il déclare", () => {
    expect(file.fields).toHaveLength(9);
    expect(file.stars).toHaveLength(file.count);
    expect(file.source.license).toBe('CC-BY-SA-4.0');
    for (const s of file.stars) {
      expect(s).toHaveLength(9);
      expect(s[2]).toBeLessThanOrEqual(file.source.magnitudeLimit);
    }
  });

  it('contient les étoiles connues, la plus brillante en tête', () => {
    expect(file.stars[0]![8]).toBe('Sirius');
    expect(find('Sirius')[2]).toBeCloseTo(-1.44, 2);
    expect(find('Polaris')[1]).toBeCloseTo(89.26, 1);
    expect(find('Betelgeuse')[0]).toBeCloseTo(88.79, 1);
  });
});

describe('starDirection', () => {
  it('à J2000 rend la direction publiée, unitaire', () => {
    const s = find('Sirius');
    const v = dir(s, 0);
    expect(Math.hypot(v[0]!, v[1]!, v[2]!)).toBeCloseTo(1, 12);
    const ra = ((Math.atan2(v[1]!, v[0]!) * 180) / Math.PI + 360) % 360;
    expect(ra).toBeCloseTo(s[0], 3);
    expect((Math.asin(v[2]!) * 180) / Math.PI).toBeCloseTo(s[1], 3);
  });

  it("suit le mouvement propre publié : Barnard dérive d'environ 10 arcsec par an", () => {
    const barnard = [...file.stars].sort(
      (a, b) => Math.hypot(b[5], b[6]) - Math.hypot(a[5], a[6])
    )[0]!;
    const pm = Math.hypot(barnard[5], barnard[6]); // mas/an
    expect(pm).toBeGreaterThan(5_000);
    const moved = angleDeg(dir(barnard, 0), dir(barnard, 100)) * 3600; // arcsec
    expect(moved).toBeCloseTo((pm / 1000) * 100, -1);
    const far = angleDeg(dir(barnard, 0), dir(barnard, 10_000));
    expect(far).toBeGreaterThan(10);
    expect(far).toBeLessThan(35);
  });

  it('un mouvement rectiligne est symétrique : −Δt et +Δt écartent autant', () => {
    const s = find('Sirius');
    const a = angleDeg(dir(s, 0), dir(s, 1000));
    const b = angleDeg(dir(s, 0), dir(s, -1000));
    expect(a).toBeGreaterThan(0.1);
    expect(Math.abs(a - b) / a).toBeLessThan(0.05);
  });

  it("une étoile lointaine ne bouge pas à l'œil sur un siècle", () => {
    const far = file.stars.find((s) => s[4] > 400 && s[2] < 5)!;
    expect(angleDeg(dir(far, 0), dir(far, 100))).toBeLessThan(0.01);
  });
});

describe('couleur et éclat', () => {
  it('une étoile rouge-orangée (B−V 1,5) et une bleutée (B−V −0,03)', () => {
    const [r, , b] = starColor(1.5);
    expect(r - b).toBeGreaterThan(0.3);
    const [r2, , b2] = starColor(-0.03);
    expect(b2).toBeGreaterThanOrEqual(r2);
  });
  it('sans indice : blanc', () => expect(starColor(null)).toEqual([1, 1, 1]));
  it('une étoile plus brillante est plus grosse et plus lumineuse, bornée', () => {
    expect(starAppearance(-1.44).size).toBeLessThanOrEqual(7);
    expect(starAppearance(0).gain).toBeGreaterThan(starAppearance(6).gain);
    expect(starAppearance(0).size).toBeGreaterThan(starAppearance(6).size);
  });
  it('yearsSinceJ2000 vaut 0 à J2000 et 25 en 2025 environ', () => {
    expect(yearsSinceJ2000(new Date(Date.UTC(2000, 0, 1, 12)))).toBe(0);
    expect(yearsSinceJ2000(new Date(Date.UTC(2025, 0, 1, 12)))).toBeCloseTo(
      25,
      1
    );
  });
});
