import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PILOT_METADATA,
  assertLocalMetadata,
  assertMaxPages,
  datasetsFromIipt,
  optionValue,
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

describe('options sans valeur : échec fermé', () => {
  it('optionValue : absente → null, valeur → valeur', () => {
    expect(optionValue(['--body', 'mercury'], '--dataset')).toBeNull();
    expect(optionValue(['--dataset', 'a|b|c|d'], '--dataset')).toBe('a|b|c|d');
  });
  for (const argv of [
    ['--body', 'mercury', '--dataset'], // argument final
    ['--dataset', '--plan'], // suivi d'une option
    ['--dataset', '-x'],
    ['--dataset', ''],
  ])
    it(`refuse ${JSON.stringify(argv)}`, () => {
      expect(() => optionValue(argv, '--dataset')).toThrow(/exige une valeur/);
    });
  it('--max-pages : refuse un nombre au-delà de Number.MAX_SAFE_INTEGER', () => {
    expect(parseMaxPages(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER
    );
    for (const big of [
      String(Number.MAX_SAFE_INTEGER + 2),
      '9007199254740993',
      '99999999999999999999999',
    ])
      expect(() => parseMaxPages(big)).toThrow(/sûr/);
  });
});

describe('script : options sans valeur refusées (sortie 2, cache intact)', () => {
  let cache: string;
  beforeEach(() => {
    cache = mkdtempSync(join(tmpdir(), 'odeds2-'));
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
      '--dataset argument final',
      ['--body', 'mercury', '--dataset'],
      /--dataset exige une valeur/,
    ],
    [
      '--dataset suivi d’une option',
      ['--body', 'mercury', '--dataset', '--plan'],
      /--dataset exige une valeur/,
    ],
    [
      '--max-pages argument final',
      ['--body', 'mercury', '--max-pages'],
      /--max-pages exige une valeur/,
    ],
    [
      '--max-pages suivi d’une option',
      ['--body', 'mercury', '--max-pages', '--plan'],
      /--max-pages exige une valeur/,
    ],
    [
      '--max-pages excessif',
      ['--body', 'mercury', '--max-pages', '9007199254740993'],
      /sûr/,
    ],
  ] as const)
    it(`${label} : erreur explicite, sortie 2, rien écrit`, () => {
      const r = run(...args);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(message);
      expect(readdirSync(cache)).toEqual([]);
    });
});

describe('pilote : métadonnées locales obligatoires, aucune requête', () => {
  it('assertLocalMetadata liste les fichiers manquants', () => {
    expect(() => assertLocalMetadata('/c', () => true)).not.toThrow();
    expect(() =>
      assertLocalMetadata('/c', (f) => !f.endsWith('counts.json'))
    ).toThrow(/counts\.json/);
    expect(PILOT_METADATA).toEqual([
      'iipt.json',
      'counts.json',
      'redundancy.json',
      'unfrozen.json',
      'freeze.json',
    ]);
  });

  let cache: string;
  let guard: string;
  beforeEach(() => {
    cache = mkdtempSync(join(tmpdir(), 'odeds3-'));
    guard = join(cache, '..', `odeguard-${Date.now()}-${Math.random()}.cjs`);
    // toute requête réseau échoue bruyamment ET laisse une trace
    writeFileSync(
      guard,
      `globalThis.fetch = () => { require('node:fs').writeFileSync(${JSON.stringify(join(cache, 'FETCH'))}, 'x'); throw new Error('REQUETE-RESEAU'); };`
    );
  });
  afterEach(() => {
    rmSync(cache, { recursive: true, force: true });
    rmSync(guard, { force: true });
  });
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        '--require',
        guard,
        join(process.cwd(), 'scripts', 'pull-ode-footprints.mjs'),
        '--cache-dir',
        cache,
        ...args,
      ],
      { encoding: 'utf8', timeout: 30000 }
    );

  it('cache vide + pilote : échec explicite, ni verrou, ni gel, ni requête', () => {
    const r = run(
      '--body',
      'mercury',
      '--dataset',
      'Mercury|MESSENGER|MLA|radr',
      '--plan'
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/métadonnées absentes du cache/);
    expect(readdirSync(cache)).toEqual([]);
  });

  it('--max-pages seul compte aussi comme pilote (cache vide : échec)', () => {
    const r = run('--body', 'mercury', '--max-pages', '3', '--plan');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/métadonnées absentes/);
    expect(readdirSync(cache)).toEqual([]);
  });

  it('une seule métadonnée manquante suffit à refuser, sans rien créer', () => {
    for (const f of [
      'iipt.json',
      'counts.json',
      'redundancy.json',
      'freeze.json',
    ])
      writeFileSync(join(cache, f), '{}');
    const before = readdirSync(cache).sort();
    const r = run(
      '--body',
      'mercury',
      '--dataset',
      'Mercury|MESSENGER|MLA|radr'
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unfrozen\.json/);
    expect(readdirSync(cache).sort()).toEqual(before);
  });

  it('collecte normale (sans --dataset ni --max-pages) : le préflight local n’est PAS imposé', () => {
    const source = readFileSync(
      join(process.cwd(), 'scripts', 'pull-ode-footprints.mjs'),
      'utf8'
    );
    expect(source).toMatch(/if \(PILOT\) assertLocalMetadata\(CACHE\)/);
    // seconde barrière : cached() ne calcule (donc ne requête) jamais en pilote
    expect(source).toMatch(/if \(PILOT\)\s+return Promise\.reject\(/);
    expect(source).toContain('PILOT = DATASET !== null || MAX_PAGES !== null');
  });
});

describe('pilote sur un cache local complet : refus et plan SANS requête', () => {
  let cache: string;
  let guard: string;
  beforeEach(() => {
    cache = mkdtempSync(join(tmpdir(), 'odeds4-'));
    guard = join(cache, '..', `odeguard4-${Date.now()}-${Math.random()}.cjs`);
    writeFileSync(
      guard,
      `globalThis.fetch = () => { require('node:fs').writeFileSync(${JSON.stringify(join(cache, 'FETCH'))}, 'x'); throw new Error('REQUETE-RESEAU'); };`
    );
    const keys = [
      'Mercury|MESSENGER|MLA|radr',
      'Mercury|MESSENGER|MLA|scirdrv1',
      'Mars|MRO|HIRISE|DTM',
    ];
    const iipt = {
      ODEResults: {
        IIPTSets: {
          IIPTSet: keys.map((k) => {
            const [db, ihid, iid, pt] = k.split('|');
            return entry(db, ihid, iid, pt);
          }),
        },
      },
    };
    const w = (f: string, v: unknown) =>
      writeFileSync(join(cache, f), JSON.stringify(v));
    w('iipt.json', iipt);
    w('counts.json', Object.fromEntries(keys.map((k) => [k, 3278])));
    w(
      'redundancy.json',
      Object.fromEntries(keys.map((k) => [k, { verdict: 'kept' }]))
    );
    w('unfrozen.json', {});
    w('freeze.json', {
      mincreationtime: '1900-01-01',
      maxcreationtime: '2026-09-29',
    });
  });
  afterEach(() => {
    rmSync(cache, { recursive: true, force: true });
    rmSync(guard, { force: true });
  });
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        '--require',
        guard,
        join(process.cwd(), 'scripts', 'pull-ode-footprints.mjs'),
        '--cache-dir',
        cache,
        '--body',
        'mercury',
        '--plan',
        ...args,
      ],
      { encoding: 'utf8', timeout: 30000 }
    );

  it('le plan du pilote vient du cache : 1 jeu, 3 278 produits, aucune requête', () => {
    const r = run(
      '--dataset',
      'Mercury|MESSENGER|MLA|radr',
      '--max-pages',
      '1'
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      /1 cles, 0 redondantes .*1 a tirer, 3278 produits/
    );
    expect(existsSync(join(cache, 'FETCH'))).toBe(false);
  });
  it('clé inconnue : refus sans requête', () => {
    const r = run('--dataset', 'Mercury|MESSENGER|MLA|nope');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/clé absente des jeux/);
    expect(existsSync(join(cache, 'FETCH'))).toBe(false);
  });
  it('clé du mauvais corps : refus sans requête', () => {
    const r = run('--dataset', 'Mars|MRO|HIRISE|DTM');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/appartient à mars, pas à --body mercury/);
    expect(existsSync(join(cache, 'FETCH'))).toBe(false);
  });
});

describe('câblage de pull-ode-footprints.mjs', () => {
  const source = readFileSync(
    join(process.cwd(), 'scripts', 'pull-ode-footprints.mjs'),
    'utf8'
  );
  it('valide la syntaxe avant main(), passe la clé à selectDatasets, applique --max-pages avant le tirage', () => {
    expect(source).toContain("parseDatasetArg(optionValue(argv, '--dataset'))");
    expect(source).toContain("parseMaxPages(optionValue(argv, '--max-pages'))");
    expect(source.indexOf('parseDatasetArg(')).toBeLessThan(
      source.indexOf('async function main()')
    );
    expect(source).toMatch(/dataset: DATASET/);
    expect(source.indexOf('assertMaxPages(tasks.length')).toBeLessThan(
      source.indexOf('collectPages({')
    );
  });
});
