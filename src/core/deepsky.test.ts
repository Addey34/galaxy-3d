import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deepSkyDirection,
  deepSkyLabel,
  type DeepSkyFile,
  type DeepSkyObject,
} from './deepsky';

const file = JSON.parse(
  readFileSync('public/assets/sky/deepsky.json', 'utf8')
) as DeepSkyFile;
const find = (designation: string) =>
  file.objects.find((o) => o[0] === designation)!;

describe('ciel profond livré', () => {
  it('a la forme que ses champs annoncent et le compte qu’il déclare', () => {
    expect(file.fields).toHaveLength(9);
    expect(file.objects).toHaveLength(file.count);
    expect(file.count).toBeGreaterThan(450);
    expect(file.source.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(file.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(file.source.license).toBe('CC-BY-SA-4.0');
    expect(file.source.licenseUrl).toContain(file.source.commit);
  });

  it('applique la règle de sélection écrite : Messier, ou magnitude V catalogée <= la limite', () => {
    for (const o of file.objects) {
      const isMessier = o[1] !== null;
      const vmag = o[7];
      expect(
        isMessier || (vmag !== null && vmag <= file.source.vLimit),
        o[0]
      ).toBe(true);
      expect(['Dup', 'NonEx', '*', '**', '*Ass', 'Other']).not.toContain(o[3]);
    }
  });

  it('a des positions valides, des désignations uniques, et null (jamais 0 ni NaN) pour une valeur absente', () => {
    const seen = new Set<string>();
    for (const o of file.objects) {
      expect(o[5]).toBeGreaterThanOrEqual(0);
      expect(o[5]).toBeLessThan(360);
      expect(Math.abs(o[6])).toBeLessThanOrEqual(90);
      expect(seen.has(o[0]), o[0]).toBe(false);
      seen.add(o[0]);
      for (const v of [o[7], o[8]])
        if (v !== null) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).not.toBe(0);
        }
    }
  });

  it('contient les 105 objets Messier du catalogue NGC/IC avec leur numéro', () => {
    const messier = file.objects.filter((o) => o[1] !== null);
    expect(messier.length).toBeGreaterThanOrEqual(100);
    expect(new Set(messier.map((o) => o[1])).size).toBe(messier.length);
  });

  it('connaît des objets repères à leur place : M31, M42, Omega du Centaure', () => {
    const m31 = find('NGC 224');
    expect(m31[1]).toBe(31);
    expect(m31[5]).toBeCloseTo(10.68, 0);
    expect(m31[6]).toBeCloseTo(41.27, 0);
    expect(find('NGC 1976')[1]).toBe(42);
    expect(find('NGC 5139')[6]).toBeCloseTo(-47.48, 0);
  });

  it("est celui que la source épinglée a produit : l'empreinte du CSV en cache concorde", () => {
    const cache = '.cache/deepsky/NGC.csv';
    // Le cache n'est pas versionné : sans lui (CI, clone neuf), seule la forme est vérifiée.
    if (!existsSync(cache)) return;
    expect(file.source.csvSha256).toBe(
      createHash('sha256').update(readFileSync(cache, 'utf8')).digest('hex')
    );
  });
});

describe('deepSkyDirection', () => {
  const dir = (ra: number, dec: number) => {
    const out = new Float64Array(3);
    deepSkyDirection([0, 0, 0, 0, 0, ra, dec] as never, out);
    return out;
  };

  it('rend un vecteur unitaire aux points cardinaux du ciel', () => {
    expect(Array.from(dir(0, 0))).toEqual([1, 0, 0]);
    const east = dir(90, 0);
    expect(east[0]).toBeCloseTo(0);
    expect(east[1]).toBeCloseTo(1);
    const pole = dir(123, 90);
    expect(pole[0]).toBeCloseTo(0);
    expect(pole[1]).toBeCloseTo(0);
    expect(pole[2]).toBeCloseTo(1);
    const o = dir(201.7, -47.48);
    expect(Math.hypot(o[0]!, o[1]!, o[2]!)).toBeCloseTo(1);
  });
});

describe('deepSkyLabel', () => {
  const object = (messier: number | null, common: string | null) =>
    ['NGC 1', messier, common, 'G', null, 0, 0, null, null] as DeepSkyObject;

  it('écrit « M n · nom » pour un Messier nommé, « M n » sans nom, le nom seul pour les autres', () => {
    expect(deepSkyLabel(object(31, 'Andromeda Galaxy'))).toBe(
      'M 31 · Andromeda Galaxy'
    );
    expect(deepSkyLabel(object(13, null))).toBe('M 13');
    expect(deepSkyLabel(object(null, 'Omega Centauri'))).toBe('Omega Centauri');
    expect(deepSkyLabel(object(null, null))).toBeNull();
  });

  it('écrit au plus quelques centaines de noms, pas les 494 désignations', () => {
    const written = file.objects.filter((o) => deepSkyLabel(o) !== null).length;
    expect(written).toBeLessThan(file.count);
    expect(written).toBeGreaterThan(100);
  });
});
