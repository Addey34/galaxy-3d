import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { segmentIndices, type ConstellationFile } from './constellations';
import type { StarCatalogueFile, StarRow } from './starCatalogue';

const starsText = readFileSync('public/assets/sky/stars.json', 'utf8');
const stars = (JSON.parse(starsText) as StarCatalogueFile).stars;
const file = JSON.parse(
  readFileSync('public/assets/sky/constellations.json', 'utf8')
) as ConstellationFile;

const angleDeg = (a: StarRow, b: StarRow) => {
  const r = Math.PI / 180;
  const c =
    Math.sin(a[1] * r) * Math.sin(b[1] * r) +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.cos((a[0] - b[0]) * r);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};

describe('figures des constellations livrées', () => {
  it("sont écrites pour CE catalogue d'étoiles : l'empreinte de stars.json concorde", () => {
    expect(file.stars.sha256).toBe(
      createHash('sha256').update(starsText).digest('hex')
    );
  });

  it('ont les 88 constellations, une licence et un commit épinglé', () => {
    expect(file.count).toBe(88);
    expect(file.constellations).toHaveLength(88);
    expect(file.source.license).toBe('BSD-3-Clause');
    expect(file.source.linesCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(file.source.namesCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('ne pointent que des étoiles du catalogue, et jamais deux fois la même à la suite', () => {
    for (const c of file.constellations)
      for (const line of c.lines) {
        expect(line.length).toBeGreaterThanOrEqual(2);
        for (const i of line) {
          expect(Number.isInteger(i)).toBe(true);
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(stars.length);
        }
      }
    expect(() => segmentIndices(file, stars.length)).not.toThrow();
  });

  it('relient des étoiles voisines : aucun segment ne traverse plus de 40° de ciel', () => {
    const seg = segmentIndices(file, stars.length);
    expect(seg.length).toBeGreaterThan(1000);
    for (let k = 0; k < seg.length; k += 2)
      expect(angleDeg(stars[seg[k]!]!, stars[seg[k + 1]!]!)).toBeLessThan(40);
  });

  it('Orion relie Bételgeuse, Rigel et les trois étoiles de la Ceinture', () => {
    const orion = file.constellations.find((c) => c.id === 'Ori')!;
    expect(orion.name).toBe('Orion');
    const named = new Set(
      orion.lines
        .flat()
        .map((i) => stars[i]![8])
        .filter(Boolean)
    );
    for (const n of ['Betelgeuse', 'Rigel', 'Alnitak', 'Alnilam', 'Mintaka'])
      expect(named.has(n), `${n} absente de la figure d'Orion`).toBe(true);
  });

  it('la Grande Ourse porte Dubhe et Merak, les deux Pointeurs', () => {
    const uma = file.constellations.find((c) => c.id === 'UMa')!;
    const named = new Set(
      uma.lines
        .flat()
        .map((i) => stars[i]![8])
        .filter(Boolean)
    );
    expect(named.has('Dubhe')).toBe(true);
    expect(named.has('Merak')).toBe(true);
  });
});

describe('segmentIndices', () => {
  it('une ligne de n sommets donne n − 1 segments', () => {
    const r = segmentIndices(
      { constellations: [{ id: 'X', name: 'X', lines: [[0, 1, 2, 3]] }] },
      10
    );
    expect(Array.from(r)).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it("refuse un indice hors du catalogue (indices écrits pour un autre fichier d'étoiles)", () => {
    expect(() =>
      segmentIndices(
        { constellations: [{ id: 'X', name: 'X', lines: [[0, 99]] }] },
        10
      )
    ).toThrow(/hors du catalogue/);
  });
});
