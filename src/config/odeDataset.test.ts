import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertMaxPages,
  datasetsFromIipt,
  parseDatasetArg,
  parseMaxPages,
  selectDatasets,
} from '../../scripts/ode-selection.mjs';

/**
 * `--dataset <clé>` et `--max-pages <n>` (GAL-A003-05A) : sélection EXACTE d'un jeu, validée avant
 * toute requête ODE. Aucun test ne touche le réseau.
 */

const entry = (db: string, ihid: string, iid: string, pt: string) => ({
  ODEMetaDB: db,
  IHID: ihid,
  IID: iid,
  PT: pt,
  DataSetId: `${ihid}-${iid}-${pt}`,
  ValidFootprints: 'T',
});
// la forme réelle d'un relevé `iipt` : MESSENGER couvre Mercure ET Vénus
const LIST = datasetsFromIipt({
  ODEResults: {
    IIPTSets: {
      IIPTSet: [
        entry('Mercury', 'MESSENGER', 'MLA', 'radr'),
        entry('Mercury', 'MESSENGER', 'MLA', 'scirdrv1'),
        entry('Mercury', 'MESSENGER', 'MDIS-WAC', 'CDRWAC'),
        entry('Mars', 'MRO', 'HIRISE', 'DTM'),
        entry('Mars', 'MGS', 'MOLA', 'PEDR'),
      ],
    },
  },
}) as { key: string; target: string; IHID: string }[];

describe('parseDatasetArg', () => {
  it('accepte une clé à quatre segments, null si absente', () => {
    expect(parseDatasetArg('Mercury|MESSENGER|MLA|radr')).toBe(
      'Mercury|MESSENGER|MLA|radr'
    );
    expect(parseDatasetArg(null)).toBeNull();
    expect(parseDatasetArg(undefined)).toBeNull();
  });
  for (const bad of [
    '',
    'Mercury',
    'Mercury|MESSENGER|MLA',
    'Mercury|MESSENGER|MLA|radr|x',
    'Mercury||MLA|radr',
    ' Mercury|MESSENGER|MLA|radr',
    'Mercury|MESSENGER|MLA|radr ',
    'Mercury|MESSENGER|MLA |radr',
  ])
    it(`refuse ${JSON.stringify(bad)}`, () => {
      expect(() => parseDatasetArg(bad)).toThrow(/clé invalide/);
    });
});

describe('parseMaxPages / assertMaxPages', () => {
  it('entier strictement positif ou null', () => {
    expect(parseMaxPages('3')).toBe(3);
    expect(parseMaxPages(null)).toBeNull();
    for (const bad of ['0', '-1', '1.5', 'abc', '', '03', '1e2'])
      expect(() => parseMaxPages(bad)).toThrow(/entier strictement positif/);
  });
  it('refuse au-delà de la limite, accepte à la limite ou sans limite', () => {
    expect(() => assertMaxPages(4, 3)).toThrow(/collecte refusée/);
    expect(() => assertMaxPages(3, 3)).not.toThrow();
    expect(() => assertMaxPages(0, 3)).not.toThrow();
    expect(() => assertMaxPages(342, null)).not.toThrow();
  });
});

describe('selectDatasets avec dataset', () => {
  it('égalité exacte avec la clé : un seul jeu', () => {
    const picked = selectDatasets(LIST, {
      body: 'mercury',
      dataset: 'Mercury|MESSENGER|MLA|radr',
    });
    expect(picked.map((s) => s.key)).toEqual(['Mercury|MESSENGER|MLA|radr']);
  });
  it('sans dataset, la sélection par corps est inchangée', () => {
    expect(selectDatasets(LIST, { body: 'mercury' })).toHaveLength(3);
    expect(selectDatasets(LIST, { body: 'mars' })).toHaveLength(2);
  });
  it('pas de correspondance partielle ni de casse approchée', () => {
    for (const dataset of [
      'Mercury|MESSENGER|MLA|rad',
      'Mercury|MESSENGER|MLA|RADR',
      'mercury|MESSENGER|MLA|radr',
      'Mercury|MESSENGER|MLA|*',
    ])
      expect(() => selectDatasets(LIST, { body: 'mercury', dataset })).toThrow(
        /absente/
      );
  });
  it('une clé d’un autre corps est refusée, avec le corps nommé', () => {
    expect(() =>
      selectDatasets(LIST, {
        body: 'mercury',
        dataset: 'Mars|MRO|HIRISE|DTM',
      })
    ).toThrow(/appartient à mars, pas à --body mercury/);
  });
  it('intersection avec --only : cohérent accepté, incohérent refusé', () => {
    const dataset = 'Mercury|MESSENGER|MLA|radr';
    expect(
      selectDatasets(LIST, { body: 'mercury', only: 'MESSENGER', dataset })
    ).toHaveLength(1);
    expect(() =>
      selectDatasets(LIST, { body: 'mercury', only: 'MRO', dataset })
    ).toThrow(/aucun jeu/);
  });
  it('body reste obligatoire', () => {
    expect(() =>
      selectDatasets(LIST, {
        body: null,
        dataset: 'Mercury|MESSENGER|MLA|radr',
      })
    ).toThrow(/obligatoire/);
  });
  it('ne modifie pas la liste complète', () => {
    const before = LIST.length;
    selectDatasets(LIST, {
      body: 'mercury',
      dataset: 'Mercury|MESSENGER|MLA|radr',
    });
    expect(LIST).toHaveLength(before);
  });
});

describe('script : refus AVANT toute requête (sortie 2, cache intact)', () => {
  let cache: string;
  beforeEach(() => {
    cache = mkdtempSync(join(tmpdir(), 'odeds-'));
  });
  afterEach(() => rmSync(cache, { recursive: true, force: true }));

  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'pull-ode-footprints.mjs'),
        '--cache-dir',
        cache,
        ...args,
      ],
      { encoding: 'utf8', timeout: 30000 }
    );

  for (const [label, args, message] of [
    [
      '--dataset sans --body',
      ['--dataset', 'Mercury|MESSENGER|MLA|radr', '--plan'],
      /exige --body/,
    ],
    ['clé invalide', ['--body', 'mercury', '--dataset', 'MLA'], /clé invalide/],
    [
      '--max-pages invalide',
      ['--body', 'mercury', '--max-pages', '0'],
      /entier strictement positif/,
    ],
  ] as const)
    it(`${label} : refusé, rien écrit dans le cache`, () => {
      const r = run(...args);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(message);
      expect(readdirSync(cache)).toEqual([]);
    });
});

describe('câblage de pull-ode-footprints.mjs', () => {
  const source = readFileSync(
    join(process.cwd(), 'scripts', 'pull-ode-footprints.mjs'),
    'utf8'
  );
  it('valide la syntaxe avant main(), passe la clé à selectDatasets, applique --max-pages avant le tirage', () => {
    expect(source).toContain("parseDatasetArg(argValue('--dataset'))");
    expect(source).toContain("parseMaxPages(argValue('--max-pages'))");
    expect(source.indexOf('parseDatasetArg(')).toBeLessThan(
      source.indexOf('async function main()')
    );
    expect(source).toMatch(/dataset: DATASET/);
    expect(source.indexOf('assertMaxPages(tasks.length')).toBeLessThan(
      source.indexOf('collectPages({')
    );
  });
});
