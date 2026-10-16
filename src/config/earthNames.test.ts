import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import index from './earthNamesIndex.json';
import type { EarthName } from '@/core/earthNames';

/**
 * LES NOMS DE LA TERRE LIVRÉS (lot 53, pas 1), confrontés à leur index et à des témoins nommés.
 * Régénérer avec `pnpm earthnames:generate` ; `--check` dit si le fichier livré a dérivé.
 */
const names = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'public',
      'assets',
      'earth-names',
      'earth.json'
    ),
    'utf8'
  )
) as EarthName[];

const find = (name: string): EarthName => {
  const hit = names.find((n) => n.name === name);
  if (!hit) throw new Error(`témoin absent : ${name}`);
  return hit;
};

describe('noms de la Terre livrés (lot 53)', () => {
  it('le fichier et son index disent le même compte, couche par couche', () => {
    expect(names.length).toBe(index.count);
    expect(Object.values(index.layers).reduce((a, b) => a + b, 0)).toBe(
      index.count
    );
    // LE TÉMOIN : quatre couches, aucune vide.
    expect(Object.keys(index.layers)).toHaveLength(4);
    for (const n of Object.values(index.layers)) expect(n).toBeGreaterThan(100);
  });

  it('chaque nom a une position et la règle de zoom de sa source', () => {
    for (const n of names) {
      expect(n.name.trim(), JSON.stringify(n)).not.toBe('');
      expect(Math.abs(n.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(n.lon)).toBeLessThanOrEqual(180);
      expect(Number.isFinite(n.minZoom)).toBe(true);
      if (n.maxZoom !== undefined)
        expect(n.maxZoom).toBeGreaterThanOrEqual(n.minZoom);
    }
  });

  it('les plus importants d’abord : la couche tronque dans cet ordre', () => {
    for (let i = 1; i < names.length; i += 1)
      expect(names[i]!.minZoom).toBeGreaterThanOrEqual(names[i - 1]!.minZoom);
  });

  it('pose ses témoins au bon endroit, dans les quatre langues', () => {
    const everest = find('Mount Everest');
    expect(everest.lat).toBeCloseTo(27.99, 0);
    expect(everest.lon).toBeCloseTo(86.93, 0);
    expect(everest.names?.pt).toBe('Evereste');
    // Le nom d'une mer se pose DANS la mer : le centroïde d'un golfe en croissant tomberait à
    // terre, d'où le pôle d'inaccessibilité du générateur.
    const med = find('Mediterranean Sea');
    expect(med.lat).toBeGreaterThan(31);
    expect(med.lat).toBeLessThan(44);
    expect(med.lon).toBeGreaterThan(-5);
    expect(med.lon).toBeLessThan(36);
    expect(med.names?.fr).toBe('mer Méditerranée');
    expect(med.maxZoom).toBeDefined();
    // Les MAJUSCULES de la source ramenées à la casse d'un nom.
    expect(find('Himalayas').names?.fr).toBe('Himalaya');
  });

  it('déclare sa licence et l’endroit où la source l’écrit', () => {
    expect(index.provider.rights).toBe('public-domain');
    expect(index.provider.rightsStatedAt).toMatch(
      /^https:\/\/www\.naturalearthdata\.com\//
    );
    expect(index.provider.source).toContain('/v5.1.2/');
  });
});
