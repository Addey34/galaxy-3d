import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
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
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IncompletePageError,
  collectPages,
  inspectExistingPages,
  validatePageBuffer,
  writeFileExclusive,
  writePageAtomic,
  type PageTask,
} from '../../scripts/ode-pages.mjs';
import { scanDataset } from '../../scripts/place-observations-publish.mjs';
import {
  ReconciliationError,
  buildManifest,
  hasGeometry,
  loadReconciliation,
  manifestPath,
  pageExpectation,
  sha256,
  validateManifest,
} from '../../scripts/ode-reconciliation.mjs';
import {
  buildReconciliation,
  replayReconciled,
} from '../../scripts/ode-reconcile.mjs';

/**
 * RÉCONCILIATION DES PRODUITS SANS EMPREINTE (GAL-A003-05F). Données SYNTHÉTIQUES uniquement,
 * aucun accès réseau. Le pilote réel : 3 278 catalogués = 3 274 géolocalisables + 4 sans géométrie.
 */
const KEY = 'Mercury|MESSENGER|MLA|radr';
const FREEZE = { mincreationtime: '1900-01-01', maxcreationtime: '2026-09-29' };
const N_FOOT = 3274;
const EXCLUDED = ['16005212', '16005215', '16006244', '16011677'];
const idOf = (i: number) => String(16000000 + i);
const FOOT_IDS = Array.from({ length: N_FOOT }, (_, i) => idOf(i));
const ALL_IDS = [...FOOT_IDS, ...EXCLUDED];

// ---------- constructeurs ----------
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
type Row = Record<string, string>;
function dbf(rows: Row[]): Buffer {
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
    FIELDS.forEach((name, i) =>
      out.write(
        (row[name] ?? '').padEnd(WIDTH, ' '),
        base + 1 + WIDTH * i,
        'latin1'
      )
    );
  });
  return out;
}
function shp(count: number): Buffer {
  const out = Buffer.alloc(100 + count * 28);
  for (let i = 0; i < count; i++) {
    const o = 100 + i * 28;
    out.writeInt32BE(i + 1, o);
    out.writeInt32BE(10, o + 4);
    out.writeInt32LE(1, o + 8);
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
const pid = (id: string) => `mlaradr${id}`;
const row = (id: string, productId = pid(id)): Row => ({
  ODEId: id,
  ProductId: productId,
  DatasetId: 'MESS-RADR',
  UTCstart: '2011-01-01',
  UTCend: '2011-01-02',
  LabelURL: 'x',
  Target: 'MERCURY',
});
function coverage(
  ids: string[],
  variants = ['gl', 'c0l', 'c180l'],
  productId = pid
): Buffer {
  const files: Record<string, Buffer> = {};
  let x = 99;
  const filler = Buffer.alloc(3000);
  for (let i = 0; i < filler.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    filler[i] = x >> 16;
  }
  files['LISEZMOI.bin'] = filler;
  for (const v of variants) {
    const rows = ids.map((id) => row(id, productId(id)));
    files[`cov_${v}.dbf`] = dbf(rows);
    files[`cov_${v}.shp`] = shp(rows.length);
  }
  return gzipSync(tar(files));
}
function metadata(
  ids: string[],
  withGeometry: (id: string) => boolean
): Buffer {
  const Product = ids.map((id) => ({
    ProductURL: `https://ode.rsl.wustl.edu/mercury/pagehelp/product.aspx?product_id=${pid(id)}&product_idGeo=${id}`,
    ...(withGeometry(id)
      ? { Footprint_GL_geometry: 'LINESTRING (1 2, 3 4)' }
      : {}),
  }));
  return Buffer.from(
    JSON.stringify({ ODEResults: { Status: 'Success', Products: { Product } } })
  );
}

interface Fixture {
  cache: string;
  metaFile: string;
  covFile: string;
}
function fixture(
  cache: string,
  opts: {
    metaIds?: string[];
    geometry?: (id: string) => boolean;
    covIds?: string[];
    productId?: (id: string) => string;
    metaReq?: Record<string, string>;
    covProv?: Record<string, unknown>;
    metaSha?: string;
    covSha?: string;
    count?: number;
  } = {}
): Fixture {
  const metaIds = opts.metaIds ?? ALL_IDS;
  const meta = metadata(
    metaIds,
    opts.geometry ?? ((id) => !EXCLUDED.includes(id))
  );
  const cov = coverage(opts.covIds ?? FOOT_IDS, undefined, opts.productId);
  const dir = join(cache, 'diagnostics');
  mkdirSync(dir, { recursive: true });
  const metaFile = 'meta@0.json';
  const covFile = 'cov@0.raw';
  writeFileSync(join(dir, metaFile), meta);
  writeFileSync(
    join(dir, `${metaFile}.sha256`),
    `${sha256(meta)}  ${metaFile}\n`
  );
  writeFileSync(
    join(dir, `${metaFile}.provenance.json`),
    JSON.stringify({
      requete: {
        query: 'product',
        results: 'm',
        output: 'JSON',
        target: 'mercury',
        IHID: 'MESSENGER',
        IID: 'MLA',
        PT: 'radr',
        limit: '5000',
        offset: '0',
        ...FREEZE,
        ...opts.metaReq,
      },
      receivedBytes: meta.length,
      sha256: opts.metaSha ?? sha256(meta),
      retrievedAt: '2026-11-10T04:17:36.138Z',
    })
  );
  writeFileSync(join(dir, covFile), cov);
  writeFileSync(join(dir, `${covFile}.sha256`), `${sha256(cov)}  ${covFile}\n`);
  writeFileSync(
    join(dir, `${covFile}.json`),
    JSON.stringify({
      dataset: KEY,
      offset: 0,
      limit: 5000,
      freeze: FREEZE,
      receivedBytes: cov.length,
      sha256: opts.covSha ?? sha256(cov),
      retrievedAt: '2026-11-10T04:11:47.675Z',
      ...opts.covProv,
    })
  );
  writeFileSync(
    join(cache, 'counts.json'),
    JSON.stringify({ [KEY]: opts.count ?? metaIds.length })
  );
  writeFileSync(join(cache, 'freeze.json'), JSON.stringify(FREEZE));
  return { cache, metaFile, covFile };
}

let cache: string;
beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'oderec-'));
});
afterEach(() => rmSync(cache, { recursive: true, force: true }));

const build = (f: Fixture) =>
  buildReconciliation({
    cacheDir: f.cache,
    key: KEY,
    metadataFile: f.metaFile,
    coverageFile: f.covFile,
    now: new Date('2026-11-10T12:00:00Z'),
  });
const refused = (fn: () => unknown, pattern: RegExp) => {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ReconciliationError);
  expect((error as Error).message).toMatch(pattern);
};

// ---------- 1. manifeste ----------
describe('manifeste : preuve et ensembles', () => {
  it('bonne preuve : 3 278 = 3 274 + 4, exclusions exactes, SHA-256 et références', () => {
    const f = fixture(cache);
    const { manifest, file } = build(f);
    expect(manifest.counts).toEqual({
      catalogued: 3278,
      footprints: 3274,
      excluded: 4,
    });
    expect(manifest.excluded.map((e: { odeId: string }) => e.odeId)).toEqual(
      EXCLUDED
    );
    expect(manifest.excluded[0]).toMatchObject({
      reason: 'absence-de-geometrie',
      metadataGeometry: 'absente',
      inShapefiles: { gl: false, c0l: false, c180l: false },
    });
    expect(manifest.freeze).toEqual(FREEZE);
    expect(manifest.sources.metadata.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sources.coverage.file).toBe('cov@0.raw');
    expect(manifest.sources.coverage.variants.gl).toEqual({
      records: 3274,
      distinct: 3274,
    });
    expect(manifest.footprintIds).toHaveLength(3274);
    expect(existsSync(file)).toBe(true);
  });

  it('un manifeste existant n’est jamais écrasé', () => {
    const f = fixture(cache);
    build(f);
    refused(() => build(f), /existe déjà/);
  });

  it.each([
    [
      'SHA-256 de la provenance incorrect',
      { metaSha: 'f'.repeat(64) },
      /SHA-256/,
    ],
    [
      'SHA-256 du brut de couverture incorrect',
      { covSha: 'e'.repeat(64) },
      /SHA-256/,
    ],
    [
      'mauvais gel des métadonnées',
      { metaReq: { maxcreationtime: '2026-10-01' } },
      /gel/,
    ],
    [
      'mauvais jeu de la capture',
      { covProv: { dataset: 'Mercury|MESSENGER|MLA|edr' } },
      /jeu/,
    ],
    ['mauvais offset de la capture', { covProv: { offset: 5000 } }, /offset/],
    [
      'mauvais gel de la capture',
      { covProv: { freeze: { ...FREEZE, maxcreationtime: '2026-10-01' } } },
      /gel/,
    ],
    ['mauvaise cible des métadonnées', { metaReq: { IID: 'MDIS' } }, /IID/],
    ['catalogue différent de counts.json', { count: 3277 }, /counts\.json/],
  ])('refus : %s', (_nom, opts, pattern) => {
    const f = fixture(cache, opts as never);
    refused(() => build(f), pattern as RegExp);
    expect(existsSync(manifestPath(cache, KEY))).toBe(false);
  });

  it('exclusion injustifiée : un produit avec géométrie absent du shapefile', () => {
    const f = fixture(cache, { geometry: () => true });
    refused(() => build(f), /exclusion injustifiée/);
  });

  it('géométrie finalement présente pour un exclu : refus', () => {
    const f = fixture(cache, { geometry: (id) => id !== EXCLUDED[0] });
    refused(() => build(f), /16005215|exclusion injustifiée/);
  });

  it('identifiant du shapefile absent du catalogue : refus', () => {
    const f = fixture(cache, { covIds: [...FOOT_IDS, '99999999'] });
    refused(() => build(f), /absent du catalogue/);
  });

  it('ProductId incohérent entre shapefile et métadonnées : refus', () => {
    const f = fixture(cache, { productId: (id) => `autre${id}` });
    refused(() => build(f), /ProductId/);
  });

  it('doublon dans les métadonnées : refus', () => {
    const f = fixture(cache, {
      metaIds: [...ALL_IDS, FOOT_IDS[0]],
      count: 3279,
    });
    refused(() => build(f), /en double/);
  });

  it('produit sans géométrie présent dans le shapefile : refus', () => {
    const f = fixture(cache, { geometry: (id) => id !== FOOT_IDS[3] });
    refused(() => build(f), /sans géométrie dans les métadonnées/);
  });

  it('jeu de plus d’une page : réconciliation refusée (pagination non validée)', () => {
    const big = Array.from({ length: 5001 }, (_, i) => idOf(i));
    const f = fixture(cache, {
      metaIds: big,
      geometry: () => true,
      covIds: big,
    });
    refused(() => build(f), /plus d|une page|multipage|\(> 5000\)/);
  });

  it('hasGeometry : vide, absent et EMPTY ne sont pas une géométrie', () => {
    expect(hasGeometry({})).toBe(false);
    expect(hasGeometry({ Footprint_GL_geometry: '' })).toBe(false);
    expect(
      hasGeometry({ Footprint_GL_geometry: 'GEOMETRYCOLLECTION EMPTY' })
    ).toBe(false);
    expect(
      hasGeometry({ Footprint_GL_geometry: 'LINESTRING (1 2, 3 4)' })
    ).toBe(true);
  });
});

// ---------- 2. validation du manifeste ----------
describe('validateManifest et chargement', () => {
  const ctx = {
    key: KEY,
    freeze: FREEZE,
    catalogueCount: 3278,
    pageSize: 5000,
  };
  const make = () => {
    const f = fixture(cache);
    return build(f).manifest;
  };
  it('manifeste valide : aucun problème', () => {
    expect(validateManifest(make(), ctx)).toEqual([]);
  });
  it.each([
    [
      'exclusion supprimée',
      (m: any) => m.excluded.pop(),
      /exclus|catalogués|annoncées/,
    ],
    [
      'empreinte ajoutée',
      (m: any) => m.footprintIds.push('1'),
      /empreintes|catalogués/,
    ],
    [
      'identifiant à la fois exclu et empreinte',
      (m: any) => {
        m.footprintIds[0] = m.excluded[0].odeId;
      },
      /exclu et empreinte|double/,
    ],
    [
      'motif non admis',
      (m: any) => {
        m.excluded[0].reason = 'au-hasard';
      },
      /motif/,
    ],
    [
      'géométrie non démontrée absente',
      (m: any) => {
        m.excluded[0].metadataGeometry = 'inconnue';
      },
      /géométrie/,
    ],
    [
      'absence du shapefile non démontrée',
      (m: any) => {
        m.excluded[0].inShapefiles.gl = true;
      },
      /shapefiles/,
    ],
    [
      'gel falsifié',
      (m: any) => {
        m.freeze.maxcreationtime = '2027-01-01';
      },
      /gel/,
    ],
    [
      'SHA-256 retiré',
      (m: any) => {
        m.sources.coverage.sha256 = '';
      },
      /SHA-256/,
    ],
  ])('refus : %s', (_nom, mutate, pattern) => {
    const m = make();
    (mutate as (m: unknown) => void)(m);
    expect(validateManifest(m, ctx).join(' ')).toMatch(pattern as RegExp);
  });

  it('sans manifeste : null (comportement normal inchangé)', () => {
    expect(
      loadReconciliation({
        cacheDir: cache,
        key: KEY,
        freeze: FREEZE,
        catalogueCount: 3278,
        pageSize: 5000,
      })
    ).toBeNull();
  });

  it('avec manifeste : comptes et ensembles', () => {
    build(fixture(cache));
    const r = loadReconciliation({
      cacheDir: cache,
      key: KEY,
      freeze: FREEZE,
      catalogueCount: 3278,
      pageSize: 5000,
    })!;
    expect([r.catalogued, r.footprints, r.excludedIds.size]).toEqual([
      3278, 3274, 4,
    ]);
  });

  it('une source modifiée après coup (SHA-256) fait refuser le chargement', () => {
    build(fixture(cache));
    const file = join(cache, 'diagnostics', 'cov@0.raw');
    writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from('x')]));
    refused(
      () =>
        loadReconciliation({
          cacheDir: cache,
          key: KEY,
          freeze: FREEZE,
          catalogueCount: 3278,
          pageSize: 5000,
        }),
      /SHA-256|octets/
    );
  });

  it('un octet modifié À TAILLE IDENTIQUE : seul le SHA-256 le voit', () => {
    build(fixture(cache));
    const file = join(cache, 'diagnostics', 'meta@0.json');
    const bytes = Buffer.from(readFileSync(file));
    bytes[bytes.length - 3] ^= 1;
    writeFileSync(file, bytes);
    refused(
      () =>
        loadReconciliation({
          cacheDir: cache,
          key: KEY,
          freeze: FREEZE,
          catalogueCount: 3278,
          pageSize: 5000,
        }),
      /SHA-256 différent/
    );
  });

  it('counts.json qui change : le manifeste ne s’applique plus', () => {
    build(fixture(cache));
    refused(
      () =>
        loadReconciliation({
          cacheDir: cache,
          key: KEY,
          freeze: FREEZE,
          catalogueCount: 3279,
          pageSize: 5000,
        }),
      /catalogue/
    );
  });
});

// ---------- 3. attendu d'une page ----------
describe('pageExpectation : l’égalité reste stricte', () => {
  it('sans réconciliation : le catalogue (min(page, reste))', () => {
    expect(
      pageExpectation({
        count: 3278,
        offset: 0,
        pageSize: 5000,
        reconciliation: null,
      })
    ).toEqual({
      expected: 3278,
      excludedIds: undefined,
    });
    expect(
      pageExpectation({
        count: 12000,
        offset: 10000,
        pageSize: 5000,
        reconciliation: null,
      }).expected
    ).toBe(2000);
  });
  it('avec réconciliation : les empreintes prouvées et les exclus', () => {
    build(fixture(cache));
    const r = loadReconciliation({
      cacheDir: cache,
      key: KEY,
      freeze: FREEZE,
      catalogueCount: 3278,
      pageSize: 5000,
    });
    const e = pageExpectation({
      count: 3278,
      offset: 0,
      pageSize: 5000,
      reconciliation: r,
    });
    expect(e.expected).toBe(3274);
    expect(e.excludedIds?.size).toBe(4);
  });
  it('appliquée à un offset non nul ou à un jeu multipage : refus', () => {
    build(fixture(cache));
    const r = loadReconciliation({
      cacheDir: cache,
      key: KEY,
      freeze: FREEZE,
      catalogueCount: 3278,
      pageSize: 5000,
    });
    expect(() =>
      pageExpectation({
        count: 3278,
        offset: 5000,
        pageSize: 5000,
        reconciliation: r,
      })
    ).toThrow(ReconciliationError);
    expect(() =>
      pageExpectation({
        count: 9000,
        offset: 0,
        pageSize: 5000,
        reconciliation: r,
      })
    ).toThrow(ReconciliationError);
  });
});

// ---------- 4. validation de page ----------
const ndjson = (ids: string[]) =>
  gzipSync(
    Buffer.from(
      ids
        .map((id) => JSON.stringify({ id, shapes: { l: [[[0, 0]]] } }))
        .join('\n') + '\n'
    )
  );

describe('validation de page avec exclusions', () => {
  const excluded = new Set(EXCLUDED);
  it('3 274 empreintes attendues : accepté, égalité stricte', () => {
    expect(
      validatePageBuffer(ndjson(FOOT_IDS), {
        expected: 3274,
        excludedIds: excluded,
      })
    ).toBe(3274);
  });
  it('3 273 ou 3 275 : refus (aucune tolérance)', () => {
    expect(() =>
      validatePageBuffer(ndjson(FOOT_IDS.slice(1)), {
        expected: 3274,
        excludedIds: excluded,
      })
    ).toThrow(IncompletePageError);
    expect(() =>
      validatePageBuffer(ndjson([...FOOT_IDS, '99999999']), {
        expected: 3274,
        excludedIds: excluded,
      })
    ).toThrow(IncompletePageError);
  });
  it('3 278 produits dont les 4 exclus : refus nommant l’exclusion injustifiée', () => {
    expect(() =>
      validatePageBuffer(ndjson(ALL_IDS), {
        expected: 3274,
        excludedIds: excluded,
      })
    ).toThrow(/exclusion injustifiée/);
  });
  it('sans réconciliation, 3 274 pour 3 278 attendus reste REFUSÉ (règle stricte inchangée)', () => {
    expect(() =>
      validatePageBuffer(ndjson(FOOT_IDS), { expected: 3278 })
    ).toThrow(IncompletePageError);
  });
  it('écriture atomique : la page invalide n’est jamais posée', () => {
    const file = join(cache, '0.ndjson.gz');
    const products = ALL_IDS.map((id) => ({ id, shapes: { l: [[[0, 0]]] } }));
    expect(() =>
      writePageAtomic(file, products, { expected: 3274, excludedIds: excluded })
    ).toThrow(IncompletePageError);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(cache)).toEqual([]);
  });
  it('reprise : une page de 3 278 déjà présente est invalide quand le manifeste exclut 4 produits', () => {
    const dir = join(cache, 'p');
    mkdirSync(dir);
    writeFileSync(join(dir, '0.ndjson.gz'), ndjson(ALL_IDS));
    const r = inspectExistingPages(
      dir,
      [0],
      () => 3274,
      () => excluded
    );
    expect(r.valid.size).toBe(0);
    expect(r.invalid[0].reason).toMatch(/exclusion injustifiée/);
  });
  it('collectPages transmet l’attendu et les exclus à l’écriture', async () => {
    const seen: unknown[] = [];
    const task: PageTask = {
      key: KEY,
      offset: 0,
      file: join(cache, '0.ndjson.gz'),
      expected: 3274,
      excludedIds: excluded,
    };
    await collectPages({
      tasks: [task],
      pull: async () => FOOT_IDS.map((id) => ({ id })),
      write: (_f: string, _p: readonly unknown[], o?: object) => {
        seen.push(o);
      },
      unavailable: {},
      markUnavailable: () => undefined,
      markIncomplete: () => undefined,
      concurrency: 1,
    } as never);
    expect(seen).toEqual([{ expected: 3274, excludedIds: excluded }]);
  });
});

// ---------- 5. scanDataset : le générateur ----------
describe('scanDataset : les produits sans géométrie ne sont pas des observations', () => {
  const rec = { excludedIds: new Set(EXCLUDED) };
  const dirWith = (ids: string[]) => {
    const dir = join(cache, 'pages');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '0.ndjson.gz'), ndjson(ids));
    return dir;
  };
  it('3 274 empreintes pour 3 278 catalogués : aucun problème, comptes tracés', () => {
    const seen: string[] = [];
    const r = scanDataset(
      dirWith(FOOT_IDS),
      3278,
      5000,
      (p: { id: string }) => seen.push(p.id),
      rec
    );
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ distinct: 3274, catalogued: 3278, excluded: 4 });
    expect(seen).toHaveLength(3274);
    for (const id of EXCLUDED) expect(seen).not.toContain(id);
  });
  it('un exclu présent dans les pages : problème, et jamais transmis comme observation', () => {
    const seen: string[] = [];
    const r = scanDataset(
      dirWith([...FOOT_IDS.slice(1), EXCLUDED[0]]),
      3278,
      5000,
      (p: { id: string }) => seen.push(p.id),
      rec
    );
    expect(r.forbidden).toEqual([EXCLUDED[0]]);
    expect(r.problems.join(' ')).toMatch(/exclusion injustifiée/);
    expect(seen).not.toContain(EXCLUDED[0]);
  });
  it('une empreinte en moins : problème, égalité stricte', () => {
    const r = scanDataset(
      dirWith(FOOT_IDS.slice(1)),
      3278,
      5000,
      undefined,
      rec
    );
    expect(r.problems.join(' ')).toMatch(
      /3273 produits distincts pour 3274 attendus/
    );
  });
  it('sans réconciliation : 3 274 pour 3 278 reste un problème (comportement inchangé)', () => {
    const r = scanDataset(dirWith(FOOT_IDS), 3278, 5000);
    expect(r.problems.join(' ')).toMatch(
      /3274 produits distincts pour 3278 déclarés/
    );
  });
});

// ---------- 6. rejeu hors réseau ----------
describe('rejeu de la capture conservée', () => {
  it('dry-run : tout est vérifié, rien n’est écrit', () => {
    build(fixture(cache));
    const before = readdirSync(cache).sort();
    const r = replayReconciled({ cacheDir: cache, key: KEY, dryRun: true });
    expect(r).toMatchObject({
      status: 'dry-run',
      catalogued: 3278,
      withFootprint: 3274,
    });
    expect(readdirSync(cache).sort()).toEqual(before);
  });
  it('écriture par le chemin normal : page validée de 3 274 produits, sans les 4 exclus', () => {
    build(fixture(cache));
    const r = replayReconciled({ cacheDir: cache, key: KEY });
    expect(r.status).toBe('written');
    const lines = gunzipSync(readFileSync(r.page))
      .toString()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3274);
    expect(new Set(lines.map((l: { id: string }) => l.id)).size).toBe(3274);
    for (const id of EXCLUDED)
      expect(lines.some((l: { id: string }) => l.id === id)).toBe(false);
    expect(
      readdirSync(join(cache, 'pages', 'Mercury_MESSENGER_MLA_radr'))
    ).toEqual(['0.ndjson.gz']);
    // ce n'est pas la quarantaine copiée telle quelle
    expect(
      readFileSync(r.page).equals(
        readFileSync(join(cache, 'diagnostics', 'cov@0.raw'))
      )
    ).toBe(false);
    expect(replayReconciled({ cacheDir: cache, key: KEY }).status).toBe(
      'already-valid'
    );
  });
  it('sans manifeste : rejeu refusé', () => {
    fixture(cache);
    refused(
      () => replayReconciled({ cacheDir: cache, key: KEY }),
      /aucun manifeste/
    );
  });
  it('capture modifiée depuis le manifeste : refus avant toute écriture', () => {
    build(fixture(cache));
    const file = join(cache, 'diagnostics', 'cov@0.raw');
    writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from('x')]));
    refused(
      () => replayReconciled({ cacheDir: cache, key: KEY }),
      /SHA-256|octets/
    );
    expect(existsSync(join(cache, 'pages'))).toBe(false);
  });
  it('métadonnées conservées où un exclu a finalement une géométrie : refus', () => {
    const f = fixture(cache);
    build(f);
    // le manifeste reste valide, mais les métadonnées conservées sont remplacées ET leur somme mise à jour
    const manifestFile = manifestPath(cache, KEY);
    const m = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const meta = metadata(ALL_IDS, () => true);
    writeFileSync(join(cache, 'diagnostics', f.metaFile), meta);
    m.sources.metadata.sha256 = sha256(meta);
    m.sources.metadata.receivedBytes = meta.length;
    writeFileSync(manifestFile, JSON.stringify(m));
    refused(
      () => replayReconciled({ cacheDir: cache, key: KEY }),
      /géométrie finalement présente/
    );
  });
  it('capture qui ne porte pas les 3 274 identifiants attendus : refus', () => {
    const f = fixture(cache);
    build(f);
    const manifestFile = manifestPath(cache, KEY);
    const m = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const cov = coverage([...FOOT_IDS.slice(1), EXCLUDED[0]]);
    writeFileSync(join(cache, 'diagnostics', f.covFile), cov);
    m.sources.coverage.sha256 = sha256(cov);
    m.sources.coverage.receivedBytes = cov.length;
    writeFileSync(manifestFile, JSON.stringify(m));
    refused(
      () => replayReconciled({ cacheDir: cache, key: KEY }),
      /présent dans la capture|absent|inattendu/
    );
  });
});

// ---------- 7. la chaîne est câblée ----------
describe('câblage de la chaîne (sources)', () => {
  const read = (f: string) =>
    readFileSync(join(process.cwd(), 'scripts', f), 'utf8');
  it('le collecteur, le générateur et la validation de page lisent la réconciliation', () => {
    expect(read('pull-ode-footprints.mjs')).toMatch(/loadReconciliation/);
    expect(read('pull-ode-footprints.mjs')).toMatch(/excludedIds: expectation/);
    expect(read('generate-place-observations.mjs')).toMatch(
      /loadReconciliation/
    );
    expect(read('generate-place-observations.mjs')).toMatch(
      /[\r\n]\s+reconciliation[\r\n]\s*\);/
    );
    expect(read('ode-pages.mjs')).toMatch(/exclusion injustifiée/);
    expect(read('place-observations-publish.mjs')).toMatch(
      /exclusion injustifiée/
    );
  });
  it('le module de réconciliation ne fait aucune requête réseau', () => {
    for (const f of ['ode-reconciliation.mjs', 'ode-reconcile.mjs'])
      expect(read(f)).not.toMatch(
        /fetch\(|node:https?|node:net|XMLHttpRequest/
      );
  });
  it('la commande rejoue en dry-run sans réseau (processus réel)', () => {
    build(fixture(cache));
    const run = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'ode-reconcile.mjs'),
        'replay',
        '--cache-dir',
        cache,
        '--dataset',
        KEY,
        '--dry-run',
      ],
      { encoding: 'utf8' }
    );
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      status: 'dry-run',
      withFootprint: 3274,
    });
    const bad = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'ode-reconcile.mjs'),
        'replay',
        '--cache-dir',
        cache,
        '--dataset',
        'X|Y|Z|W',
      ],
      { encoding: 'utf8' }
    );
    expect(bad.status).not.toBe(0);
  });
  it('buildManifest est exporté et pur (smoke)', () => {
    expect(typeof buildManifest).toBe('function');
  });
});

// ---------- 8. corrections CTO : ensemble exact, dry-run sans mutation, publication exclusive ----------
const SWAPPED = ['99999999', ...FOOT_IDS.slice(1)]; // même total (3 274), un identifiant étranger
const loadRec = () =>
  loadReconciliation({
    cacheDir: cache,
    key: KEY,
    freeze: FREEZE,
    catalogueCount: 3278,
    pageSize: 5000,
  })!;

describe('ensemble EXACT des empreintes (même total, identifiant étranger)', () => {
  const allowed = new Set(FOOT_IDS);
  const excluded = new Set(EXCLUDED);
  it('validatePageBuffer : refus nommant l’identifiant non attendu', () => {
    expect(
      validatePageBuffer(ndjson(FOOT_IDS), {
        expected: 3274,
        excludedIds: excluded,
        allowedIds: allowed,
      })
    ).toBe(3274);
    expect(() =>
      validatePageBuffer(ndjson(SWAPPED), {
        expected: 3274,
        excludedIds: excluded,
        allowedIds: allowed,
      })
    ).toThrow(/identifiant non attendu : 99999999/);
  });
  it('sans ensemble prouvé (jeu non réconcilié) : comportement inchangé', () => {
    expect(validatePageBuffer(ndjson(SWAPPED), { expected: 3274 })).toBe(3274);
  });
  it('writePageAtomic : la page à identifiant étranger n’est jamais posée', () => {
    const file = join(cache, '0.ndjson.gz');
    const products = SWAPPED.map((id) => ({ id, shapes: { l: [[[0, 0]]] } }));
    expect(() =>
      writePageAtomic(file, products, {
        expected: 3274,
        excludedIds: excluded,
        allowedIds: allowed,
      })
    ).toThrow(IncompletePageError);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(cache)).toEqual([]);
  });
  it('inspectExistingPages : une ancienne page à identifiant étranger est invalide', () => {
    const dir = join(cache, 'p');
    mkdirSync(dir);
    writeFileSync(join(dir, '0.ndjson.gz'), ndjson(SWAPPED));
    const r = inspectExistingPages(
      dir,
      [0],
      () => 3274,
      () => excluded,
      () => allowed
    );
    expect(r.valid.size).toBe(0);
    expect(r.invalid[0].reason).toMatch(/non attendu/);
  });
  it('scanDataset : identifiant étranger signalé, jamais transmis comme observation', () => {
    const dir = join(cache, 'pages');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '0.ndjson.gz'), ndjson(SWAPPED));
    const seen: string[] = [];
    const r = scanDataset(
      dir,
      3278,
      5000,
      (p: { id: string }) => seen.push(p.id),
      { excludedIds: excluded, footprintIds: allowed }
    );
    expect(r.unexpected).toEqual(['99999999']);
    expect(r.problems.join(' ')).toMatch(/non attendu/);
    expect(seen).not.toContain('99999999');
  });
  it('rejeu : une ancienne page incorrecte n’est PAS « already-valid »', () => {
    build(fixture(cache));
    const dir = join(cache, 'pages', 'Mercury_MESSENGER_MLA_radr');
    mkdirSync(dir, { recursive: true });
    const stale = ndjson(SWAPPED);
    writeFileSync(join(dir, '0.ndjson.gz'), stale);
    expect(
      replayReconciled({ cacheDir: cache, key: KEY, dryRun: true }).status
    ).toBe('dry-run');
    expect(readFileSync(join(dir, '0.ndjson.gz')).equals(stale)).toBe(true);
    expect(replayReconciled({ cacheDir: cache, key: KEY }).status).toBe(
      'written'
    );
    expect(replayReconciled({ cacheDir: cache, key: KEY }).status).toBe(
      'already-valid'
    );
  });
  it('pageExpectation transmet l’ensemble prouvé', () => {
    build(fixture(cache));
    const e = pageExpectation({
      count: 3278,
      offset: 0,
      pageSize: 5000,
      reconciliation: loadRec(),
    });
    expect(e.allowedIds?.size).toBe(3274);
    expect(
      pageExpectation({
        count: 3278,
        offset: 0,
        pageSize: 5000,
        reconciliation: null,
      }).allowedIds
    ).toBeUndefined();
  });
});

describe('dry-run strictement sans mutation', () => {
  const snapshot = (dir: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (d: string) => {
      for (const name of readdirSync(d, { withFileTypes: true })) {
        const path = join(d, name.name);
        if (name.isDirectory()) walk(path);
        else out[path.slice(dir.length)] = sha256(readFileSync(path));
      }
    };
    walk(dir);
    return out;
  };
  it('un temporaire .tmp et une page invalide sont conservés octet pour octet', () => {
    build(fixture(cache));
    const dir = join(cache, 'pages', 'Mercury_MESSENGER_MLA_radr');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '0.ndjson.gz.tmp'),
      'reste d’une écriture interrompue'
    );
    writeFileSync(join(dir, '0.ndjson.gz'), ndjson(SWAPPED));
    const before = snapshot(cache);
    const r = replayReconciled({ cacheDir: cache, key: KEY, dryRun: true });
    expect(r.status).toBe('dry-run');
    expect(snapshot(cache)).toEqual(before);
    expect(existsSync(join(dir, '0.ndjson.gz.tmp'))).toBe(true);
  });
  it('inspectExistingPages { cleanTmp: false } signale sans supprimer ; par défaut il nettoie', () => {
    const dir = join(cache, 'p');
    mkdirSync(dir);
    writeFileSync(join(dir, '0.ndjson.gz.tmp'), 'x');
    const kept = inspectExistingPages(
      dir,
      [0],
      undefined,
      undefined,
      undefined,
      { cleanTmp: false }
    );
    expect(kept.staleTmp).toEqual(['0.ndjson.gz.tmp']);
    expect(existsSync(join(dir, '0.ndjson.gz.tmp'))).toBe(true);
    inspectExistingPages(dir, [0]);
    expect(existsSync(join(dir, '0.ndjson.gz.tmp'))).toBe(false);
  });
  it('le rejeu réel (hors dry-run) nettoie le temporaire : la différence est bien le drapeau', () => {
    build(fixture(cache));
    const dir = join(cache, 'pages', 'Mercury_MESSENGER_MLA_radr');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '0.ndjson.gz.tmp'), 'x');
    replayReconciled({ cacheDir: cache, key: KEY });
    expect(existsSync(join(dir, '0.ndjson.gz.tmp'))).toBe(false);
  });
});

describe('manifeste : publication atomique exclusive', () => {
  it('writeFileExclusive : la seconde publication échoue en EEXIST, contenu intact, aucun temporaire', () => {
    const file = join(cache, 'm.json');
    writeFileExclusive(file, 'premier');
    expect(() => writeFileExclusive(file, 'second')).toThrow(
      expect.objectContaining({ code: 'EEXIST' })
    );
    expect(readFileSync(file, 'utf8')).toBe('premier');
    expect(readdirSync(cache)).toEqual(['m.json']);
  });
  it('repli sans liens physiques (EPERM) : même garantie', () => {
    const file = join(cache, 'm.json');
    const fs = {
      linkSync: () => {
        throw Object.assign(new Error('pas de lien'), { code: 'EPERM' });
      },
    };
    writeFileExclusive(file, 'premier', { fs });
    expect(readFileSync(file, 'utf8')).toBe('premier');
    expect(() => writeFileExclusive(file, 'second', { fs })).toThrow(
      expect.objectContaining({ code: 'EEXIST' })
    );
    expect(readFileSync(file, 'utf8')).toBe('premier');
    expect(readdirSync(cache)).toEqual(['m.json']);
  });
  it('une autre erreur de lien n’est pas masquée par le repli', () => {
    const fs = {
      linkSync: () => {
        throw Object.assign(new Error('disque plein'), { code: 'ENOSPC' });
      },
    };
    expect(() =>
      writeFileExclusive(join(cache, 'm.json'), 'x', { fs })
    ).toThrow(expect.objectContaining({ code: 'ENOSPC' }));
    expect(readdirSync(cache)).toEqual([]);
  });
  it('un manifeste existant (même sentinelle illisible) n’est jamais remplacé', () => {
    const f = fixture(cache);
    const file = manifestPath(cache, KEY);
    mkdirSync(join(cache, 'reconciliation'), { recursive: true });
    writeFileSync(file, 'SENTINELLE');
    refused(() => build(f), /existe déjà/);
    expect(readFileSync(file, 'utf8')).toBe('SENTINELLE');
  });
  it('trois processus concurrents : un seul gagne, le manifeste est valide et non corrompu', async () => {
    const f = fixture(cache);
    const { spawn } = await import('node:child_process');
    const script = join(process.cwd(), 'scripts', 'ode-reconcile.mjs');
    const run = () =>
      new Promise<{ code: number | null; err: string }>((resolve) => {
        const child = spawn(process.execPath, [
          script,
          'build',
          '--cache-dir',
          cache,
          '--dataset',
          KEY,
          '--metadata',
          f.metaFile,
          '--coverage',
          f.covFile,
        ]);
        let err = '';
        child.stderr.on('data', (d) => (err += d));
        child.on('close', (code) => resolve({ code, err }));
      });
    const results = await Promise.all([run(), run(), run()]);
    expect(results.filter((r) => r.code === 0)).toHaveLength(1);
    for (const r of results.filter((r) => r.code !== 0)) {
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/existe déjà/);
    }
    const r = loadRec();
    expect([r.catalogued, r.footprints]).toEqual([3278, 3274]);
    expect(readdirSync(join(cache, 'reconciliation'))).toEqual([
      'Mercury_MESSENGER_MLA_radr.json',
    ]);
  });
});
