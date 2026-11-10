import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeRecords,
  parseCoverageArchive,
  type DbfRow,
} from '../../scripts/ode-coverage.mjs';
import {
  LocalStorageError,
  collectPages,
  validatePageBuffer,
  writePageAtomic,
  type PageTask,
} from '../../scripts/ode-pages.mjs';
import {
  describeGap,
  quarantineRaw,
  sha256,
  writeAnalysis,
} from '../../scripts/ode-diagnostic.mjs';

/**
 * DIAGNOSTIC DE L'ÉCART ODE (GAL-A003-05C) : 3 278 attendus, 3 274 distincts. Archives
 * SYNTHÉTIQUES uniquement : aucun de ces tests ne touche le réseau.
 */

// ---------- constructeurs d'archives coveragetargz synthétiques ----------
const FIELDS = [
  'ODEId',
  'ProductId',
  'DatasetId',
  'UTCstart',
  'UTCend',
  'LabelURL',
  'Target',
];
const WIDTH = 24;

function dbf(rows: DbfRow[]): Buffer {
  const headerLen = 32 + 32 * FIELDS.length + 1;
  const recLen = 1 + WIDTH * FIELDS.length;
  const out = Buffer.alloc(headerLen + rows.length * recLen);
  out[0] = 3;
  out.writeUInt32LE(rows.length, 4);
  out.writeUInt16LE(headerLen, 8);
  out.writeUInt16LE(recLen, 10);
  FIELDS.forEach((name, i) => {
    out.write(name, 32 + 32 * i, 'latin1');
    out[32 + 32 * i + 16] = WIDTH;
  });
  out[32 + 32 * FIELDS.length] = 0x0d;
  rows.forEach((row, r) => {
    const base = headerLen + r * recLen;
    out[base] = 0x20;
    FIELDS.forEach((name, i) => {
      const text = (row[name] ?? '').padEnd(WIDTH, ' ');
      out.write(text, base + 1 + WIDTH * i, 'latin1');
    });
  });
  return out;
}

function shp(count: number): Buffer {
  const out = Buffer.alloc(100 + count * 28);
  for (let i = 0; i < count; i++) {
    const o = 100 + i * 28;
    out.writeInt32BE(i + 1, o);
    out.writeInt32BE(10, o + 4); // 20 octets de contenu = 10 mots
    out.writeInt32LE(1, o + 8); // point
    out.writeDoubleLE(i % 360, o + 12);
    out.writeDoubleLE((i % 180) - 90, o + 20);
  }
  return out;
}

function tar(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, data] of Object.entries(files)) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 'latin1');
    header.write(
      data.length.toString(8).padStart(11, '0') + ' ',
      124,
      'latin1'
    );
    parts.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

type Kind = 'a' | 'l' | 'p';
function archive(perKind: Partial<Record<Kind, DbfRow[]>>): Buffer {
  // Une réponse de moins de 1 024 octets est lue comme une page vide : un remplissage
  // incompressible (déterministe) garde les petites archives de test au-dessus du seuil.
  const filler = Buffer.alloc(3000);
  let x = 12345;
  for (let i = 0; i < filler.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    filler[i] = x >> 16;
  }
  const files: Record<string, Buffer> = { 'LISEZMOI.bin': filler };
  for (const [kind, rows] of Object.entries(perKind) as [Kind, DbfRow[]][]) {
    files[`cov_g${kind}.dbf`] = dbf(rows);
    files[`cov_g${kind}.shp`] = shp(rows.length);
  }
  return gzipSync(tar(files));
}

const row = (id: string, pid = `P${id}`, ds = 'MESS-RADR'): DbfRow => ({
  ODEId: id,
  ProductId: pid,
  DatasetId: ds,
  UTCstart: '2011-01-01',
  UTCend: '2011-01-02',
  LabelURL: 'x',
  Target: 'MERCURY',
});
const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => String(1000 + from + i));
/** 3 278 enregistrements pour 3 274 identifiants : 4 identifiants portés deux fois. */
const gappedRows = () => [
  ...range(0, 3274).map((id) => row(id)),
  ...range(0, 4).map((id) => row(id)),
];

// ---------- parsing et analyse ----------
describe('parseCoverageArchive et analyse avant regroupement', () => {
  it('3 278 formes / 3 274 identifiants : 3 274 produits, l’écart est mesuré et nommé', () => {
    const { products, analysis } = parseCoverageArchive(
      archive({ a: gappedRows() }),
      'k',
      0
    );
    expect(products).toHaveLength(3274);
    expect(analysis).toMatchObject({
      totalRecords: 3278,
      recordsByKind: { a: 3278 },
      distinctByKind: { a: 3274 },
      unionDistinct: 3274,
      productsAfterGrouping: 3274,
      repeatedTotal: 4,
      repeatedRecordsInExcess: 4,
      emptyIds: { count: 0 },
      invalidIds: { count: 0 },
      inconsistentTotal: 0,
    });
    expect(analysis?.repeated.map((r) => r.id)).toEqual([
      '1000',
      '1001',
      '1002',
      '1003',
    ]);
    expect(analysis?.repeated[0]).toEqual({
      id: '1000',
      occurrences: 2,
      byKind: { a: 2 },
    });
    expect(describeGap(analysis)).toMatch(
      /3278 enregistrement\(s\).*ga=3278.*3274 ODEId distinct.*4 identifiant\(s\) répété/
    );
  });

  it('3 274 formes / 3 274 identifiants : aucun écart, aucune ligne d’alerte', () => {
    const rows = range(0, 3274).map((id) => row(id));
    const { products, analysis } = parseCoverageArchive(
      archive({ a: rows }),
      'k',
      0
    );
    expect(products).toHaveLength(3274);
    expect(analysis?.repeatedTotal).toBe(0);
    expect(describeGap(analysis)).toBeNull();
  });

  it('un produit à plusieurs géométries légitimes (ga + gp) : 2 enregistrements, 1 produit', () => {
    const { products, analysis } = parseCoverageArchive(
      archive({ a: [row('7000'), row('7001')], p: [row('7000')] }),
      'k',
      0
    );
    expect(products).toHaveLength(2);
    expect(products.find((p) => p.id === '7000')?.shapes).toHaveProperty('a');
    expect(products.find((p) => p.id === '7000')?.shapes).toHaveProperty('p');
    expect(analysis).toMatchObject({
      totalRecords: 3,
      recordsByKind: { a: 2, p: 1 },
      distinctByKind: { a: 2, p: 1 },
      unionDistinct: 2,
      repeatedTotal: 1,
    });
    expect(analysis?.repeated[0]).toEqual({
      id: '7000',
      occurrences: 2,
      byKind: { a: 1, p: 1 },
    });
  });

  it('les trois types sont comptés séparément, puis dans leur union', () => {
    const { analysis } = parseCoverageArchive(
      archive({
        a: [row('1'), row('2')],
        l: [row('2'), row('3')],
        p: [row('3'), row('4'), row('4')],
      }),
      'k',
      0
    );
    expect(analysis?.recordsByKind).toEqual({ a: 2, l: 2, p: 3 });
    expect(analysis?.distinctByKind).toEqual({ a: 2, l: 2, p: 2 });
    expect(analysis?.unionDistinct).toBe(4);
    expect(analysis?.totalRecords).toBe(7);
  });

  it('identifiants vides ou invalides : comptés, jamais corrigés', () => {
    const { analysis } = parseCoverageArchive(
      archive({ a: [row(''), row(''), row('12x'), row('42')] }),
      'k',
      0
    );
    expect(analysis?.emptyIds).toEqual({ count: 2, byKind: { a: 2 } });
    expect(analysis?.invalidIds).toEqual({
      count: 1,
      sample: [{ id: '12x', kind: 'a' }],
    });
  });

  it('ODEId / ProductId / DatasetId incohérents : listés', () => {
    const { analysis } = parseCoverageArchive(
      archive({
        a: [
          row('5', 'PA'),
          row('5', 'PB'),
          row('6', 'PC', 'D1'),
          row('6', 'PC', 'D2'),
        ],
      }),
      'k',
      0
    );
    expect(analysis?.inconsistentTotal).toBe(2);
    expect(analysis?.inconsistent).toEqual([
      { id: '5', productIds: ['PA', 'PB'], datasetIds: ['MESS-RADR'] },
      { id: '6', productIds: ['PC'], datasetIds: ['D1', 'D2'] },
    ]);
    expect(analysis?.distinctProductIds).toBe(3);
  });

  it('une réponse sous 1 024 octets reste une page vide, sans analyse', () => {
    expect(parseCoverageArchive(Buffer.alloc(10), 'k', 0)).toEqual({
      products: [],
      analysis: null,
    });
  });

  it('analyzeRecords : la liste des répétés est plafonnée mais le total reste exact', () => {
    const rows: DbfRow[] = [];
    for (let i = 0; i < 500; i++) rows.push(row(String(i)), row(String(i)));
    const a = analyzeRecords({ a: rows });
    expect(a.repeatedTotal).toBe(500);
    expect(a.repeated).toHaveLength(200);
  });
});

// ---------- aucune publication d'une réponse incomplète ----------
describe('une réponse incomplète n’est jamais publiée', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'odediag-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('3 278 attendus, 3 274 distincts : refusé par la politique inchangée, aucun fichier', () => {
    const { products } = parseCoverageArchive(
      archive({ a: gappedRows() }),
      'k',
      0
    );
    expect(() =>
      writePageAtomic(join(dir, '0.ndjson.gz'), products, { expected: 3278 })
    ).toThrow(/3274 produit\(s\) distinct\(s\) pour 3278 attendu/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('3 274 attendus, 3 274 distincts : publiée (la politique n’est pas assouplie, elle est exacte)', () => {
    const { products } = parseCoverageArchive(
      archive({ a: range(0, 3274).map((id) => row(id)) }),
      'k',
      0
    );
    writePageAtomic(join(dir, '0.ndjson.gz'), products, { expected: 3274 });
    expect(
      validatePageBuffer(readFileSync(join(dir, '0.ndjson.gz')), {
        expected: 3274,
      })
    ).toBe(3274);
  });
});

// ---------- quarantaine ----------
describe('quarantaine du brut', () => {
  let cache: string;
  beforeEach(() => {
    cache = mkdtempSync(join(tmpdir(), 'odeq-'));
  });
  afterEach(() => rmSync(cache, { recursive: true, force: true }));
  const raw = archive({ a: gappedRows() });
  const common = () => ({
    cacheDir: cache,
    raw,
    key: 'Mercury|MESSENGER|MLA|radr',
    offset: 0,
    limit: 5000,
    freeze: { mincreationtime: '1900-01-01', maxcreationtime: '2026-09-29' },
    http: { status: 200, contentType: 'application/x-gzip', url: 'u' },
    now: new Date('2026-11-10T03:19:00.000Z'),
  });

  it('écrit le brut identique, sa somme et sa provenance, hors de pages/', () => {
    const kept = quarantineRaw(common());
    expect(kept.dir).toBe(join(cache, 'diagnostics'));
    const files = readdirSync(kept.dir).sort();
    expect(files).toEqual([
      `${kept.base}.raw`,
      `${kept.base}.raw.json`,
      `${kept.base}.raw.sha256`,
    ]);
    expect(kept.base).toBe(
      'Mercury_MESSENGER_MLA_radr@0+5000-20261110T031900Z'
    );
    const back = readFileSync(kept.rawFile);
    expect(back.equals(raw)).toBe(true);
    expect(sha256(back)).toBe(kept.sha256);
    expect(readFileSync(`${kept.rawFile}.sha256`, 'utf8')).toBe(
      `${kept.sha256}  ${kept.base}.raw\n`
    );
    const prov = JSON.parse(readFileSync(`${kept.rawFile}.json`, 'utf8'));
    expect(prov).toMatchObject({
      kind: 'quarantaine-brute-non-validee',
      dataset: 'Mercury|MESSENGER|MLA|radr',
      offset: 0,
      limit: 5000,
      freeze: { maxcreationtime: '2026-09-29' },
      http: { status: 200 },
      receivedBytes: raw.length,
      sha256: kept.sha256,
      retrievedAt: '2026-11-10T03:19:00.000Z',
    });
    expect(existsSync(join(cache, 'pages'))).toBe(false);
    // la quarantaine contient le brut AVANT regroupement : 3 278 enregistrements
    expect(parseCoverageArchive(back, 'k', 0).analysis?.totalRecords).toBe(
      3278
    );
  });

  it('ne laisse aucun temporaire et n’écrase jamais une quarantaine précédente', () => {
    const first = quarantineRaw(common());
    const second = quarantineRaw({
      ...common(),
      now: new Date('2026-11-10T04:00:00.000Z'),
    });
    expect(second.base).not.toBe(first.base);
    expect(readdirSync(first.dir).filter((f) => f.endsWith('.tmp'))).toEqual(
      []
    );
    expect(readdirSync(first.dir)).toHaveLength(6);
  });

  it('écrit l’analyse à côté du brut', () => {
    const kept = quarantineRaw(common());
    const analysis = parseCoverageArchive(raw, 'k', 0).analysis!;
    const file = writeAnalysis({ dir: kept.dir, base: kept.base, analysis });
    expect(JSON.parse(readFileSync(file, 'utf8')).totalRecords).toBe(3278);
  });

  it('un échec d’écriture de la quarantaine est une erreur de stockage local', () => {
    expect(() =>
      quarantineRaw({
        ...common(),
        write: () => {
          throw Object.assign(new Error('plein'), { code: 'ENOSPC' });
        },
      })
    ).toThrow(LocalStorageError);
    expect(() =>
      quarantineRaw({
        ...common(),
        write: () => {
          throw new Error('autre');
        },
      })
    ).toThrow(LocalStorageError);
  });

  it('une relecture différente est refusée', () => {
    expect(() => quarantineRaw({ ...common(), write: () => {} })).toThrow(
      /stockage local/
    );
  });

  it('l’échec de quarantaine arrête la collecte proprement : rien publié, rien dans unavailable', async () => {
    const unavailable: Record<string, unknown> = {};
    const tasks: PageTask[] = [
      { key: 'A', offset: 0, expected: 3278, file: join(cache, '0.ndjson.gz') },
      {
        key: 'A',
        offset: 5000,
        expected: 3278,
        file: join(cache, '5000.ndjson.gz'),
      },
    ];
    const r = await collectPages({
      tasks,
      pull: async () => {
        quarantineRaw({
          ...common(),
          write: () => {
            throw Object.assign(new Error('disque'), { code: 'EIO' });
          },
        });
        return [];
      },
      unavailable,
      markUnavailable: () => {
        throw new Error('ne doit pas être appelé');
      },
      concurrency: 1,
    });
    expect(r.fatal).toBeInstanceOf(LocalStorageError);
    expect(r.remaining).toBe(1);
    expect(unavailable).toEqual({});
    expect(readdirSync(cache)).toEqual([]);
  });
});

// ---------- bout en bout : le script, avec un fetch simulé (aucune requête réelle) ----------
describe('script --diagnostic de bout en bout (fetch simulé)', () => {
  let work: string;
  let cache: string;
  const KEY = 'Mercury|MESSENGER|MLA|radr';
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'odee2e-'));
    cache = join(work, 'cache');
    mkdirSync(cache);
    const entry = {
      ODEMetaDB: 'Mercury',
      IHID: 'MESSENGER',
      IID: 'MLA',
      PT: 'radr',
      DataSetId: 'x',
      ValidFootprints: 'T',
    };
    const w = (f: string, v: unknown) =>
      writeFileSync(join(cache, f), JSON.stringify(v));
    w('iipt.json', { ODEResults: { IIPTSets: { IIPTSet: [entry] } } });
    w('counts.json', { [KEY]: 3278 });
    w('redundancy.json', { [KEY]: { verdict: 'kept' } });
    w('unfrozen.json', {});
    w('freeze.json', {
      mincreationtime: '1900-01-01',
      maxcreationtime: '2026-09-29',
    });
    writeFileSync(
      join(work, 'mock.cjs'),
      `const fs = require('node:fs');
       globalThis.fetch = async (u) => {
         fs.appendFileSync(${JSON.stringify(join(work, 'requests.log'))}, String(u) + '\\n');
         return new Response(fs.readFileSync(process.env.MOCK_ARCHIVE), { status: 200, headers: { 'content-type': 'application/x-gzip' } });
       };`
    );
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const run = (archiveBytes: Buffer, ...extra: string[]) => {
    writeFileSync(join(work, 'archive.bin'), archiveBytes);
    return spawnSync(
      process.execPath,
      [
        '--require',
        join(work, 'mock.cjs'),
        join(process.cwd(), 'scripts', 'pull-ode-footprints.mjs'),
        '--cache-dir',
        cache,
        '--body',
        'mercury',
        '--dataset',
        KEY,
        '--max-pages',
        '1',
        '--concurrency',
        '1',
        ...extra,
      ],
      {
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, MOCK_ARCHIVE: join(work, 'archive.bin') },
      }
    );
  };
  const requests = () =>
    existsSync(join(work, 'requests.log'))
      ? readFileSync(join(work, 'requests.log'), 'utf8').trim().split('\n')
          .length
      : 0;
  const pageDir = () => join(cache, 'pages', 'Mercury_MESSENGER_MLA_radr');
  const metadata = () =>
    ['iipt', 'counts', 'redundancy', 'unfrozen', 'freeze'].map((f) =>
      readFileSync(join(cache, `${f}.json`), 'utf8')
    );

  it('réponse à 3 278 formes / 3 274 identifiants : brut conservé, aucune page, écart déclaré, métadonnées intactes', () => {
    const bytes = archive({ a: gappedRows() });
    const before = metadata();
    const r = run(bytes, '--diagnostic');
    expect(r.status).toBe(1);
    expect(requests()).toBe(1);
    expect(r.stdout).toMatch(/ECART enregistrements\/produits : 3278/);
    // quarantaine : octets identiques au brut reçu, somme et provenance
    const diag = join(cache, 'diagnostics');
    const raws = readdirSync(diag).filter((f) => f.endsWith('.raw'));
    expect(raws).toHaveLength(1);
    const kept = readFileSync(join(diag, raws[0]));
    expect(kept.equals(bytes)).toBe(true);
    expect(readFileSync(join(diag, `${raws[0]}.sha256`), 'utf8')).toContain(
      sha256(bytes)
    );
    const prov = JSON.parse(
      readFileSync(join(diag, `${raws[0]}.json`), 'utf8')
    );
    expect(prov).toMatchObject({
      dataset: KEY,
      offset: 0,
      limit: 5000,
      http: { status: 200 },
      receivedBytes: bytes.length,
      freeze: { maxcreationtime: '2026-09-29' },
    });
    const analysis = JSON.parse(
      readFileSync(
        join(diag, `${raws[0].replace(/\.raw$/, '')}.analysis.json`),
        'utf8'
      )
    );
    expect(analysis).toMatchObject({
      totalRecords: 3278,
      unionDistinct: 3274,
      repeatedTotal: 4,
    });
    // jamais une page validée, jamais « indisponible », incomplétude conservée
    expect(readdirSync(pageDir())).toEqual([]);
    expect(existsSync(join(cache, 'unavailable.json'))).toBe(false);
    const incomplete = JSON.parse(
      readFileSync(join(cache, 'incomplete.json'), 'utf8')
    );
    expect(incomplete[`${KEY}@0`]).toMatchObject({ expected: 3278, got: 3274 });
    expect(metadata()).toEqual(before);
  });

  it('sans --diagnostic : aucune quarantaine (même réponse, même refus)', () => {
    const r = run(archive({ a: gappedRows() }));
    expect(r.status).toBe(1);
    expect(existsSync(join(cache, 'diagnostics'))).toBe(false);
    expect(readdirSync(pageDir())).toEqual([]);
    expect(existsSync(join(cache, 'incomplete.json'))).toBe(true);
  });

  it('réponse complète (3 278 / 3 278) : page publiée, la quarantaine ne remplace pas la politique', () => {
    const rows = range(0, 3278).map((id) => row(id));
    const r = run(archive({ a: rows }), '--diagnostic');
    expect(r.status).toBe(0);
    expect(readdirSync(pageDir())).toEqual(['0.ndjson.gz']);
    expect(existsSync(join(cache, 'incomplete.json'))).toBe(false);
    expect(readdirSync(join(cache, 'diagnostics')).length).toBe(4);
    expect(r.stdout).not.toMatch(/ECART/);
  });

  it('échec d’écriture de la quarantaine : arrêt propre (code 3), rien de publié ni dans unavailable', () => {
    writeFileSync(join(cache, 'diagnostics'), 'un fichier bloque le dossier');
    const r = run(archive({ a: gappedRows() }), '--diagnostic');
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/stockage LOCAL/);
    expect(requests()).toBe(1); // pas de repli en sous-pages après une panne locale
    expect(readdirSync(pageDir())).toEqual([]);
    expect(existsSync(join(cache, 'unavailable.json'))).toBe(false);
    expect(existsSync(join(cache, 'incomplete.json'))).toBe(false);
  });

  it('--diagnostic exige --dataset (refus avant toute requête)', () => {
    const r = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'pull-ode-footprints.mjs'),
        '--cache-dir',
        cache,
        '--body',
        'mercury',
        '--diagnostic',
        '--plan',
      ],
      { encoding: 'utf8', timeout: 30000 }
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--diagnostic exige --dataset/);
  });
});

describe('garanties inchangées', () => {
  const source = readFileSync(
    join(process.cwd(), 'scripts', 'pull-ode-footprints.mjs'),
    'utf8'
  );
  it('le regroupement, la politique de complétude et le gel ne sont pas touchés', () => {
    expect(source).toContain('Math.min(PAGE, n[s.key] - off)');
    expect(source).toContain('freezeAction(CACHE)');
    expect(source).toContain('parseCoverageArchive(buf, s.key, offset)');
    expect(source).not.toMatch(/expected\s*[-+]\s*\d|tolerance|tolérance/i);
  });
  it('la quarantaine ne passe jamais par pages/', () => {
    const diag = readFileSync(
      join(process.cwd(), 'scripts', 'ode-diagnostic.mjs'),
      'utf8'
    );
    expect(diag).toContain("DIAGNOSTICS_DIR = 'diagnostics'");
    expect(diag).not.toMatch(/'pages'/);
  });
});
