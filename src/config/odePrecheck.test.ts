import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { precheck } from '../../scripts/ode-precheck.mjs';

/**
 * Le précontrôle d'une collecte ODE ne fait AUCUNE requête : il lit le cache et le disque
 * (GAL-A003-03). Les jeux ci-dessous ont la forme de la liste `iipt` de l'ODE.
 */

const set = (db: string, IHID: string, IID: string, PT: string) => ({
  ODEMetaDB: db,
  IHID,
  IID,
  PT,
  ValidFootprints: 'T',
  IHName: IHID,
  IName: IID,
  MinObservationTime: '2000-01-01',
  MaxObservationTime: '2001-01-01',
});
const IIPT = {
  ODEResults: {
    IIPTSets: {
      IIPTSet: [
        set('Mercury', 'MESSENGER', 'MDIS', 'EDR'),
        set('Mercury', 'MESSENGER', 'MDIS', 'DEM'),
        set('Venus', 'MESSENGER', 'MASCS', 'UVV'),
        set('Mars', 'MRO', 'HIRISE', 'RDR'),
      ],
    },
  },
};
const COUNTS = {
  'Mercury|MESSENGER|MDIS|EDR': 12000,
  'Mercury|MESSENGER|MDIS|DEM': 62,
  'Venus|MESSENGER|MASCS|UVV': 500,
  'Mars|MRO|HIRISE|RDR': 20000,
};
const RED = Object.fromEntries(
  Object.keys(COUNTS).map((k) => [k, { verdict: 'keep' }])
);
const UNFROZEN = { 'Mercury|MESSENGER|MDIS|DEM': { frozen: 0, all: 62 } };
const GIB = 2 ** 30;
const statfs = (free: number) => () => ({ bavail: free, bsize: 1 });

let tmp: string;
let cache: string;
let backup: string;
const put = (name: string, data: unknown): void =>
  writeFileSync(join(cache, name), JSON.stringify(data));

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pre-'));
  cache = join(tmp, 'cache');
  backup = join(tmp, 'sauvegarde');
  mkdirSync(cache);
  put('iipt.json', IIPT);
  put('counts.json', COUNTS);
  put('redundancy.json', RED);
  put('unfrozen.json', UNFROZEN);
  put('freeze.json', {
    mincreationtime: '1900-01-01',
    maxcreationtime: '2026-09-29',
  });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const run = (over: Record<string, unknown> = {}) =>
  precheck({
    body: 'mercury',
    cacheDir: cache,
    backupDir: backup,
    deliveredIndex: { frozenAt: '2026-09-29' },
    statfs: statfs(100 * GIB),
    root: join(tmp, 'repo'),
    ...over,
  });
const failed = (r: ReturnType<typeof run>) =>
  r.checks.filter((c) => !c.ok).map((c) => c.name);

describe('précontrôle de collecte', () => {
  it('Mercure : plan limité à la cible, sans le jeu de Vénus de la même mission', () => {
    const r = run();
    expect(r.plan).toMatchObject({ datasets: 2, products: 12062, pages: 4 });
    expect(r.plan?.exceptions).toEqual([
      {
        key: 'Mercury|MESSENGER|MDIS|DEM',
        frozen: 0,
        all: 62,
        kind: 'sans date de création',
      },
    ]);
  });
  it('tout est bon : prêt, sauf le volume identique (sauvegarde sur le même disque)', () => {
    // même racine de disque pour cache et sauvegarde dans ce test : seul ce contrôle échoue
    expect(failed(run())).toEqual(['sauvegarde sur un autre volume']);
  });
  it('gel du script différent de l’index livré : échec', () => {
    expect(
      failed(run({ deliveredIndex: { frozenAt: '2026-10-15' } }))
    ).toContain('gel du script = index livré');
  });
  it('freeze.json du cache d’un autre gel : échec (métadonnées et gel)', () => {
    put('freeze.json', {
      mincreationtime: '1900-01-01',
      maxcreationtime: '2026-10-15',
    });
    const f = failed(run());
    expect(f).toContain('freeze.json du cache');
    expect(f).toContain('métadonnées complètes');
  });
  it('counts.json partiel, unfrozen.json absent : échec avant tout', () => {
    put('counts.json', { 'Mercury|MESSENGER|MDIS|EDR': 12000 });
    expect(failed(run())).toContain('métadonnées complètes');
    put('counts.json', COUNTS);
    rmSync(join(cache, 'unfrozen.json'));
    expect(failed(run())).toContain('métadonnées complètes');
  });
  it('métadonnées absentes : échec nommé', () => {
    rmSync(join(cache, 'iipt.json'));
    const r = run();
    expect(failed(r)).toContain('métadonnées présentes');
    expect(r.plan).toBeNull();
  });
  it('disque insuffisant pour le cache ou la sauvegarde : échec', () => {
    expect(failed(run({ statfs: statfs(1000) }))).toEqual(
      expect.arrayContaining(['espace du cache', 'espace de la sauvegarde'])
    );
  });
  it('cache dans le dépôt, sauvegarde dans le cache ou dans le dépôt, sauvegarde absente', () => {
    expect(failed(run({ root: tmp }))).toContain('chemin du cache');
    expect(failed(run({ backupDir: join(cache, 'sauv') }))).toContain(
      'sauvegarde distincte du cache'
    );
    expect(failed(run({ backupDir: undefined }))).toContain('sauvegarde');
    expect(failed(run({ root: tmp }))).toContain('sauvegarde hors du dépôt');
  });
  it('l’estimation suit les octets par produit', () => {
    expect(run({ bytesPerProduct: 1000 }).estimate).toBe(
      Math.ceil(12062 * 1000 * 1.25)
    );
  });
});
