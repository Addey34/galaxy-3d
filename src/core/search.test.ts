import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fold,
  prepareSearchIndex,
  searchPrepared,
  type SearchIndexFile,
} from './search';

const NAMES: Record<string, string> = {
  earth: 'Earth',
  moon: 'Moon',
  mars: 'Mars',
  neptune: 'Neptune',
  voyager2: 'Voyager 2',
  cassini: 'Cassini',
  saturn: 'Saturn',
  juno: 'Juno',
  jupiter: 'Jupiter',
};
const nameOf = (id: string): string => NAMES[id] ?? id;

const file: SearchIndexFile = {
  format: 1,
  places: {
    moon: ['Tycho', 'Tycho A', 'Mare Tranquillitatis', 'Copernicus'],
    mars: ['Olympus Mons', 'Tharsis Tholus'],
  },
  missions: [['Cassini-Huygens', 'chs', 'cassini', 'saturn']],
  instruments: [['Imaging Science Subsystem', 'cassini']],
  flybys: [['voyager2', 'neptune', '1989-08-25T03:56:36Z']],
  orbitInsertions: [['juno', 'jupiter', '2016-07-05T02:55:34Z']],
  discoveries: [
    ['Titania', 'uranus', '1787', 'W. Herschel'],
    ['Pan', 'saturn', '1990', 'M.R. Showalter'],
    [null, 'mars', '1610', null],
  ],
};
const index = prepareSearchIndex(file, nameOf, [
  { id: 'wind', label: 'Wind (model)', body: 'earth' },
  { id: 'thermal-model', label: 'Air temperature (model)', body: 'earth' },
]);
const labels = (query: string) =>
  searchPrepared(index, query).map((hit) => `${hit.kind}:${hit.label}`);

describe('fold', () => {
  it('plie casse, accents, apostrophes et tirets', () => {
    expect(fold('  Rhéa ')).toBe('rhea');
    expect(fold('ʻOumuamua')).toBe('oumuamua');
    expect(fold('Cassini-Huygens')).toBe('cassini huygens');
  });
});

describe('searchPrepared', () => {
  it('le nom exact passe avant celui qui le prolonge', () => {
    expect(labels('tycho').slice(0, 2)).toEqual([
      'place:Tycho',
      'place:Tycho A',
    ]);
  });

  it('début de nom, puis début de mot, puis n’importe où', () => {
    expect(labels('tha')).toEqual(['place:Tharsis Tholus']);
    expect(labels('tranq')).toEqual(['place:Mare Tranquillitatis']);
    expect(labels('olus')).toEqual(['place:Tharsis Tholus']);
  });

  it('tous les mots doivent correspondre, le contexte compris', () => {
    // « moon » n'est pas dans le nom, il est dans le contexte de la formation.
    expect(labels('copernicus moon')).toEqual(['place:Copernicus']);
    expect(labels('copernicus mars')).toEqual([]);
    expect(labels('voyager neptune')).toEqual([
      'flyby:Voyager 2 · Neptune · 1989-08-25',
    ]);
  });

  it('une mise en orbite se trouve par sa sonde et son corps, et porte son instant', () => {
    expect(labels('juno jupiter')).toEqual([
      'orbitInsertion:Juno · Jupiter · 2016-07-05',
    ]);
    expect(searchPrepared(index, 'juno')[0]).toEqual({
      kind: 'orbitInsertion',
      label: 'Juno · Jupiter · 2016-07-05',
      probe: 'juno',
      body: 'jupiter',
      at: '2016-07-05T02:55:34Z',
    });
  });

  it('une sonde trouve sa mission et ses instruments', () => {
    expect(labels('cassini')).toEqual([
      'mission:Cassini-Huygens',
      'instrument:Imaging Science Subsystem',
    ]);
  });

  it('une couche de données se trouve par son libellé, et passe en tête', () => {
    expect(labels('wind')).toEqual(['dataset:Wind (model)']);
    expect(searchPrepared(index, 'temperature')[0]).toEqual({
      kind: 'dataset',
      label: 'Air temperature (model)',
      id: 'thermal-model',
      body: 'earth',
    });
    // Le corps de la couche est dans son contexte : « earth wind » la trouve aussi.
    expect(labels('earth wind')).toEqual(['dataset:Wind (model)']);
  });

  it('une découverte se trouve par son découvreur et montre son corps', () => {
    expect(labels('herschel')).toEqual(['discovery:Titania']);
    expect(searchPrepared(index, 'showalter')[0]).toEqual({
      kind: 'discovery',
      label: 'Pan',
      body: 'saturn',
      when: '1990',
      who: 'M.R. Showalter',
    });
    // Sans nom propre, la découverte prend celui du corps.
    expect(labels('mars 1610')).toEqual(['discovery:Mars']);
  });

  it('chaque résultat porte de quoi agir', () => {
    const [flyby] = searchPrepared(index, 'neptune 1989');
    expect(flyby).toEqual({
      kind: 'flyby',
      label: 'Voyager 2 · Neptune · 1989-08-25',
      probe: 'voyager2',
      body: 'neptune',
      closestAt: '1989-08-25T03:56:36Z',
    });
  });

  it('rien sous deux caractères, et un plafond par type', () => {
    expect(searchPrepared(index, 't')).toEqual([]);
    expect(searchPrepared(index, 'a', 1)).toEqual([]);
    expect(
      searchPrepared(index, 'ty', 1).filter((h) => h.kind === 'place')
    ).toHaveLength(1);
  });
});

describe('l’index livré', () => {
  const shipped = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../public/assets/search/index.json'),
      'utf8'
    )
  ) as SearchIndexFile;
  const real = prepareSearchIndex(shipped, (id) => id);

  it('trouve Tycho sur la Lune en premier', () => {
    expect(searchPrepared(real, 'Tycho')[0]).toEqual({
      kind: 'place',
      label: 'Tycho',
      body: 'moon',
    });
  });

  it('le survol de Neptune par Voyager 2', () => {
    expect(
      searchPrepared(real, 'voyager2 neptune').find((h) => h.kind === 'flyby')
    ).toMatchObject({ probe: 'voyager2', body: 'neptune' });
  });
});
