import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex } from '../../scripts/generate-search-index.mjs';
import { MISSIONS_SLUG } from '@/seo/documentPage';
import { MISSIONS_PATH_SEGMENT, SEARCH_INDEX_URL } from '@/ui/paletteSearch';
import { NAVIGABLE_TARGETS } from './navigable';
import { allBodies } from './catalog';
import { CELESTIAL_CONFIG } from './bodies';

/**
 * L'INDEX DE LA RECHERCHE UNIVERSELLE (lot 47) est DÉRIVÉ : le fichier livré doit être exactement
 * ce que le générateur produit depuis les sources livrées, et chaque cible qu'il nomme doit être
 * une cible que l'application sait sélectionner.
 */
const shipped = readFileSync(
  resolve(import.meta.dirname, '../../public', `.${SEARCH_INDEX_URL}`),
  'utf8'
);

describe('l’index de la recherche universelle', () => {
  it('est exactement ce que le générateur dérive des sources livrées', () => {
    expect(shipped).toBe(JSON.stringify(buildSearchIndex()) + '\n');
  });

  it('ne nomme que des cibles que l’application sait sélectionner', () => {
    const selectable = new Set([
      ...allBodies(CELESTIAL_CONFIG).map((body) => body.name),
      ...NAVIGABLE_TARGETS.keys(),
    ]);
    const index = buildSearchIndex();
    const named = [
      ...Object.keys(index.places),
      ...index.missions.flatMap(([, , probe, body]) => [probe, body]),
      ...index.instruments.map(([, probe]) => probe),
      ...index.flybys.flatMap(([probe, body]) => [probe, body]),
      ...(index.orbitInsertions ?? []).flatMap(([probe, body]) => [
        probe,
        body,
      ]),
      ...(index.perihelia ?? []).flatMap(([probe, body]) => [probe, body]),
      ...(index.perijoves ?? []).flatMap(([probe, body]) => [probe, body]),
      ...(index.contacts ?? []).flatMap(([probe, body]) => [probe, body]),
      ...(index.discoveries ?? []).map(([, body]) => body),
    ].filter((id): id is string => id !== null);
    expect(named.filter((id) => !selectable.has(id))).toEqual([]);
  });

  it('le chemin des pages de mission est celui que le build écrit', () => {
    expect(MISSIONS_PATH_SEGMENT).toBe(MISSIONS_SLUG);
  });
});
