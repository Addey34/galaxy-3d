import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import type { NamedFeature } from '@/core/gazetteer';
import { LOCALES } from '@/i18n/locales';
import {
  allGreatPlaces,
  GREAT_PLACE_RATIO,
  greatPlaces,
  placeNameSlug,
  placePages,
  placeSlug,
  type DescriptorTerms,
  type PlacePageInputs,
} from './placePages';

/**
 * LES PAGES DES GRANDS LIEUX (lot 55) : la règle relative, les adresses, et le corpus RÉEL (le
 * gazetteer livré, les termes de l'UAI lus à la source), pas une copie de lui.
 */
const feature = (name: string, diameterKm: number): NamedFeature => ({
  name,
  code: '',
  type: 'Crater, craters',
  lat: 0,
  lon: 0,
  diameterKm,
  approved: '1970',
  origin: '',
  iauId: 1,
});

describe('la règle des grands lieux', () => {
  it('garde un diamètre d’au moins 0,2 rayon, seuil compris, du plus grand au plus petit', () => {
    const radius = 100;
    const kept = greatPlaces(
      [
        feature('Petit', GREAT_PLACE_RATIO * radius - 0.1),
        feature('Seuil', GREAT_PLACE_RATIO * radius),
        feature('Grand', 80),
      ],
      radius
    );
    expect(kept.map((f) => f.name)).toEqual(['Grand', 'Seuil']);
  });

  it('n’invente aucune taille : un diamètre non publié n’est jamais grand', () => {
    expect(greatPlaces([feature('Sans taille', 0)], 0)).toEqual([]);
  });

  it('écrit une adresse sans accents ni ponctuation', () => {
    expect(placeNameSlug('Ahmakiq Undae')).toBe('ahmakiq-undae');
    expect(placeNameSlug('Mare Orientale’')).toBe('mare-orientale');
    expect(placeNameSlug('Ganesa Macula (Ganeśa)')).toBe(
      'ganesa-macula-ganesa'
    );
    expect(placeSlug('moon', 'Mare Imbrium')).toBe('places/moon/mare-imbrium');
  });
});

describe('le corpus réel', () => {
  const dir = resolve(__dirname, '../../public/assets/gazetteer');
  const gazetteer = new Map<string, NamedFeature[]>(
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [
        f.slice(0, -5),
        JSON.parse(readFileSync(resolve(dir, f), 'utf-8')),
      ])
  );
  const terms = JSON.parse(
    readFileSync(resolve(__dirname, 'descriptorTerms.json'), 'utf-8')
  ) as DescriptorTerms;
  const inputs: PlacePageInputs = {
    config: CELESTIAL_CONFIG,
    gazetteer,
    gazetteerProvider: {
      publisher: 'IAU',
      title: 'Gazetteer',
      url: 'https://planetarynames.wr.usgs.gov/',
      accessed: '2026-09-29',
    },
    terms,
    observations: () => null,
    observationProvider: {
      url: 'https://example.test/',
      frozenAt: '2026-09-29',
    },
    missionsByBody: new Map(),
    origin: 'https://example.test',
  };
  const places = allGreatPlaces(inputs);

  it('chaque corps nommé du catalogue a un rayon : aucun n’est écarté sans le dire', () => {
    const counted = new Set(places.map((p) => p.body));
    const named = [...gazetteer.keys()];
    // Les corps sans grand lieu sont ceux dont aucune formation n'a de diamètre assez grand.
    for (const body of named.filter((b) => !counted.has(b)))
      for (const f of gazetteer.get(body)!)
        expect(f.diameterKm, `${body} : ${f.name}`).toBeLessThan(
          GREAT_PLACE_RATIO * 1e9
        );
    expect(counted.size).toBeGreaterThan(30);
  });

  it('chaque type d’un grand lieu a sa définition de l’UAI', () => {
    const labels = new Set(terms.terms.map((t) => t.label));
    for (const p of places)
      expect(labels.has(p.feature.type), p.feature.type).toBe(true);
  });

  it('aucune adresse en double', () => {
    const slugs = places.map((p) => placeSlug(p.body, p.feature.name));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(LOCALES)(
    'une page par lieu plus l’index, sans gabarit vide ni tiret long (%s)',
    (locale) => {
      const pages = placePages(inputs, locale);
      expect(pages).toHaveLength(places.length + 1);
      for (const page of pages) {
        const text = `${page.title} ${page.description} ${page.body}`;
        expect(text, page.slug).not.toMatch(/\{\w+\}/);
        expect(text, page.slug).not.toContain('—');
        expect(text, page.slug).not.toMatch(/&amp;(quot|apos|amp);/);
      }
    }
  );
});
