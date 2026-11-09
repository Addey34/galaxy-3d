import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COLLECTABLE_BODIES,
  acquireLock,
  assertMetadataComplete,
  resolveCacheDir,
  selectDatasets,
  type OdeDataset,
} from '../../scripts/ode-selection.mjs';

/**
 * LA COLLECTE ODE VISE UN CORPS, PAS UNE MISSION (GAL-A003-03). `--only` filtre par IHID, et
 * MESSENGER couvre Mercure ET Vénus : ces tests le prouvent sur la forme réelle des jeux, puis
 * exigent que les métadonnées partagées ne puissent pas être réduites par une collecte partielle.
 */

const set = (target: string, IHID: string, n: string): OdeDataset => ({
  key: `${target}|${IHID}|${n}`,
  target,
  IHID,
});
const LIST: OdeDataset[] = [
  set('mercury', 'MESSENGER', 'MDIS'),
  set('mercury', 'MESSENGER', 'MLA'),
  set('venus', 'MESSENGER', 'MASCS'), // survol de Vénus par MESSENGER
  set('venus', 'MGN', 'RDRS'),
  set('mars', 'MRO', 'HIRISE'),
  set('mars', 'MGS', 'MOLA'),
  set('moon', 'LRO', 'LROC'),
  set('moon', 'ARCB-NRAO', 'RTLS'),
  set('venus', 'ARCB-NRAO', 'RTLS'),
];

describe('selectDatasets : strict par cible', () => {
  it('Mercure : seulement ses jeux, jamais ceux de Vénus pour la même mission', () => {
    const picked = selectDatasets(LIST, { body: 'mercury' });
    expect(picked.map((s) => s.key)).toEqual([
      'mercury|MESSENGER|MDIS',
      'mercury|MESSENGER|MLA',
    ]);
    // ce que faisait --only MESSENGER seul : trois jeux dont un de Vénus
    expect(LIST.filter((s) => s.IHID === 'MESSENGER')).toHaveLength(3);
  });
  it('Mars : seulement Mars, aucune autre cible', () => {
    const picked = selectDatasets(LIST, { body: 'mars' });
    expect(new Set(picked.map((s) => s.target))).toEqual(new Set(['mars']));
    expect(picked).toHaveLength(2);
  });
  it('--only est une intersection avec --body', () => {
    expect(
      selectDatasets(LIST, { body: 'mars', only: 'MRO' }).map((s) => s.key)
    ).toEqual(['mars|MRO|HIRISE']);
    expect(() =>
      selectDatasets(LIST, { body: 'mars', only: 'MESSENGER' })
    ).toThrow(/aucun jeu/);
  });
  it('refuse l’absence de corps, un corps inconnu ou non collectable', () => {
    expect(() => selectDatasets(LIST, { body: null })).toThrow(/obligatoire/);
    expect(() => selectDatasets(LIST, { body: undefined })).toThrow(
      /obligatoire/
    );
    expect(() => selectDatasets(LIST, { body: 'marz' })).toThrow(/inconnu/);
    expect(() => selectDatasets(LIST, { body: 'moon' })).toThrow(/inconnu/);
    expect(() => selectDatasets(LIST, { body: 'venus' })).toThrow(/inconnu/);
    expect(COLLECTABLE_BODIES).toEqual(['mercury', 'mars']);
  });
  it('une sélection vide est une erreur, pas « rien à tirer »', () => {
    expect(() => selectDatasets([], { body: 'mars' })).toThrow(/aucun jeu/);
  });
  it('ne modifie pas la liste complète (les métadonnées restent celles de tous les jeux)', () => {
    const before = LIST.length;
    selectDatasets(LIST, { body: 'mercury' });
    expect(LIST).toHaveLength(before);
  });
});

describe('resolveCacheDir : hors de tout dépôt', () => {
  let tmp: string;
  let root: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ode-'));
    root = join(tmp, 'repo');
    mkdirSync(join(root, '.git'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('sans chemin : exigé pour une collecte, ancien emplacement sinon', () => {
    expect(() =>
      resolveCacheDir({ arg: null, env: null, root, requireExternal: true })
    ).toThrow(/exige --cache-dir/);
    expect(
      resolveCacheDir({ arg: null, env: null, root, requireExternal: false })
    ).toBe(join(root, '.cache', 'ode-footprints'));
  });
  it('l’argument prime sur la variable d’environnement', () => {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    mkdirSync(a);
    mkdirSync(b);
    expect(
      resolveCacheDir({ arg: a, env: b, root, requireExternal: true })
    ).toBe(a);
    expect(
      resolveCacheDir({ arg: null, env: b, root, requireExternal: true })
    ).toBe(b);
  });
  it('refuse un chemin relatif, le dépôt lui-même, ou un dossier du dépôt', () => {
    expect(() =>
      resolveCacheDir({ arg: 'cache', env: null, root, requireExternal: true })
    ).toThrow(/absolu/);
    expect(() =>
      resolveCacheDir({ arg: root, env: null, root, requireExternal: true })
    ).toThrow(/dans le dépôt/);
    expect(() =>
      resolveCacheDir({
        arg: join(root, '.cache', 'x'),
        env: null,
        root,
        requireExternal: true,
      })
    ).toThrow(/dans le dépôt/);
  });
  it('refuse un dossier sous un autre worktree git (un .git existe plus haut)', () => {
    const otherTree = join(tmp, 'other-worktree');
    mkdirSync(otherTree);
    writeFileSync(join(otherTree, '.git'), 'gitdir: ../repo/.git/worktrees/x');
    expect(() =>
      resolveCacheDir({
        arg: join(otherTree, 'cache'),
        env: null,
        root,
        requireExternal: true,
      })
    ).toThrow(/worktree git/);
  });
  it('accepte un dossier extérieur, même inexistant', () => {
    const ok = join(tmp, 'donnees', 'ode');
    expect(
      resolveCacheDir({ arg: ok, env: null, root, requireExternal: true })
    ).toBe(ok);
  });
});

describe('assertMetadataComplete : un tirage partiel ne réduit pas les métadonnées', () => {
  const FREEZE = {
    mincreationtime: '1900-01-01',
    maxcreationtime: '2026-09-29',
  };
  const counts = Object.fromEntries(LIST.map((s) => [s.key, 10]));
  const redundancy = Object.fromEntries(
    LIST.map((s) => [s.key, { verdict: 'keep' }])
  );
  const base = {
    list: LIST,
    counts,
    redundancy,
    unfrozen: {},
    freezeOnDisk: FREEZE,
    freeze: FREEZE,
  };

  it('complet : accepté ; premier lancement (pas de freeze.json) : accepté', () => {
    expect(() => assertMetadataComplete(base)).not.toThrow();
    expect(() =>
      assertMetadataComplete({ ...base, freezeOnDisk: null })
    ).not.toThrow();
  });
  it('counts.json restreint à Mercure (cache d’une collecte partielle) : refusé', () => {
    const partial = Object.fromEntries(
      Object.entries(counts).filter(([k]) => k.startsWith('mercury'))
    );
    expect(() => assertMetadataComplete({ ...base, counts: partial })).toThrow(
      /counts\.json ne couvre pas 7 jeu/
    );
  });
  it('redundancy.json restreint, ou sans verdict : refusé', () => {
    const partial = Object.fromEntries(
      Object.entries(redundancy).filter(([k]) => k.startsWith('mars'))
    );
    expect(() =>
      assertMetadataComplete({ ...base, redundancy: partial })
    ).toThrow(/redundancy\.json ne couvre pas/);
  });
  it('unfrozen.json absent : refusé (les jeux sans date compteraient zéro produit)', () => {
    expect(() => assertMetadataComplete({ ...base, unfrozen: null })).toThrow(
      /unfrozen\.json manque/
    );
  });
  it('unfrozen.json citant un jeu inconnu : refusé', () => {
    expect(() =>
      assertMetadataComplete({ ...base, unfrozen: { 'mars|X|Y|Z': {} } })
    ).toThrow(/inconnu de counts/);
  });
  it('freeze.json d’un autre gel : refusé, le cache mélangerait deux gels', () => {
    expect(() =>
      assertMetadataComplete({
        ...base,
        freezeOnDisk: { ...FREEZE, maxcreationtime: '2026-10-15' },
      })
    ).toThrow(/mélangerait deux gels/);
  });
});

describe('acquireLock : une seule collecte par cache', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lock-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('prend, refuse une seconde prise tant que le processus vit, libère', () => {
    const release = acquireLock(dir);
    expect(existsSync(join(dir, 'collect.lock'))).toBe(true);
    expect(() => acquireLock(dir)).toThrow(/déjà en cours/);
    release();
    expect(existsSync(join(dir, 'collect.lock'))).toBe(false);
    acquireLock(dir)();
  });
  it('reprend la serrure d’un processus mort', () => {
    writeFileSync(join(dir, 'collect.lock'), '999999');
    const release = acquireLock(dir, { isAlive: () => false });
    expect(readFileSync(join(dir, 'collect.lock'), 'utf8')).toBe(
      String(process.pid)
    );
    release();
  });
});

describe('pull-ode-footprints.mjs : arguments refusés avant tout réseau', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['scripts/pull-ode-footprints.mjs', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, GALAXY_ODE_CACHE: '' },
    });

  it('un corps inconnu, une collecte sans --body, un cache dans le dépôt : code 2', () => {
    const out = mkdtempSync(join(tmpdir(), 'pull-'));
    try {
      expect(run('--body', 'earth', '--cache-dir', out).status).toBe(2);
      const noBody = run('--cache-dir', out);
      expect(noBody.status).toBe(2);
      expect(noBody.stderr).toMatch(/exige --body/);
      const inRepo = run(
        '--body',
        'mars',
        '--cache-dir',
        join(process.cwd(), '.cache', 'ode-test')
      );
      expect(inRepo.status).toBe(2);
      expect(inRepo.stderr).toMatch(/dans le dépôt/);
      const noDir = run('--body', 'mars');
      expect(noDir.status).toBe(2);
      expect(noDir.stderr).toMatch(/exige --cache-dir/);
      // aucun de ces refus n'a créé de cache
      expect(existsSync(join(out, 'freeze.json'))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
