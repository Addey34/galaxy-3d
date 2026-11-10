import { Buffer } from 'node:buffer';
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
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCoverageArchive } from '../../scripts/ode-coverage.mjs';
import {
  buildReconciliation,
  replayReconciled,
} from '../../scripts/ode-reconcile.mjs';
import {
  ReconciliationError,
  manifestPath,
  readShapefiles,
  sha256,
} from '../../scripts/ode-reconciliation.mjs';

/**
 * TRACES MLA À ENREGISTREMENTS MULTIPLES ET PREUVES DE PROVENANCE (GAL-A003-09E).
 * Données SYNTHÉTIQUES uniquement, aucun accès réseau. Le cas réel : MLA scirdrv1 compte 3 271 enregistrements
 * `_gl` pour 3 270 ODEId, l'ODEId 16005088 portant deux enregistrements de même ProductId (un segment dégénéré de
 * deux points identiques et une ligne de 258 points), répétés à l'identique dans `_c0l` et `_c180l`.
 */
const KEY = 'Mercury|MESSENGER|MLA|scirdrv1';
const FREEZE = { mincreationtime: '1900-01-01', maxcreationtime: '2026-09-29' };
const FIELDS = ['ODEId', 'ProductId', 'DatasetId', 'UTCstart', 'UTCend'];
const WIDTH = 24;
type Pair = [string, string];
type Pt = [number, number];

function dbf(rows: Pair[]): Buffer {
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
  rows.forEach(([id, pid], r) => {
    const base = headerLen + r * recLen;
    out[base] = 0x20;
    const values = [id, pid, 'MESS-SCIRDR', '2011-01-01', '2011-01-02'];
    FIELDS.forEach((_, i) =>
      out.write(
        (values[i] ?? '').padEnd(WIDTH, ' '),
        base + 1 + WIDTH * i,
        'latin1'
      )
    );
  });
  return out;
}
/** Polylignes (type 3), une partie par enregistrement. */
function shpLines(lines: Pt[][]): Buffer {
  const parts: Buffer[] = [Buffer.alloc(100)];
  lines.forEach((pts, i) => {
    const c = Buffer.alloc(48 + 16 * pts.length);
    c.writeInt32LE(3, 0);
    c.writeInt32LE(1, 36);
    c.writeInt32LE(pts.length, 40);
    pts.forEach(([x, y], k) => {
      c.writeDoubleLE(x, 48 + 16 * k);
      c.writeDoubleLE(y, 56 + 16 * k);
    });
    const h = Buffer.alloc(8);
    h.writeInt32BE(i + 1, 0);
    h.writeInt32BE(c.length / 2, 4);
    parts.push(h, c);
  });
  return Buffer.concat(parts);
}
/** Polygones rectangulaires (type 5), un par enregistrement : les variantes `_ga`, `_c0a`, `_c180a` des surfaces. */
function shpPolygons(n: number): Buffer {
  const parts: Buffer[] = [Buffer.alloc(100)];
  for (let i = 0; i < n; i++) {
    const pts: Pt[] = [
      [10 + i, 20],
      [10 + i, 21],
      [11 + i, 21],
      [11 + i, 20],
      [10 + i, 20],
    ];
    const c = Buffer.alloc(48 + 16 * pts.length);
    c.writeInt32LE(5, 0);
    c.writeInt32LE(1, 36);
    c.writeInt32LE(pts.length, 40);
    pts.forEach(([x, y], k) => {
      c.writeDoubleLE(x, 48 + 16 * k);
      c.writeDoubleLE(y, 56 + 16 * k);
    });
    const h = Buffer.alloc(8);
    h.writeInt32BE(i + 1, 0);
    h.writeInt32BE(c.length / 2, 4);
    parts.push(h, c);
  }
  return Buffer.concat(parts);
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
function filler(): Buffer {
  const out = Buffer.alloc(3000);
  let x = 99;
  for (let i = 0; i < out.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x >> 16;
  }
  return out;
}
const line = (x: number): Pt[] => [
  [x, 20],
  [x + 0.5, 21],
  [x + 1, 22],
];
const DEGENERATE: Pt[] = [
  [110.986, 81.899],
  [110.986, 81.899],
];
const pid = (id: string) => `mlascirdr${id}`;
const a: Pair = ['1', pid('1')];
const a2: Pair = ['1', pid('1')];
const b: Pair = ['2', pid('2')];
const c: Pair = ['3', pid('3')];

/** Archive de traces : `rows` par variante, une ligne générique par enregistrement (ou celles de `shapes`). */
function traces(
  rows: Record<string, Pair[]>,
  shapes: Record<string, Pt[][]> = {}
): Buffer {
  const files: Record<string, Buffer> = { 'LISEZMOI.bin': filler() };
  for (const [v, r] of Object.entries(rows)) {
    files[`cov_${v}.dbf`] = dbf(r);
    files[`cov_${v}.shp`] = shpLines(shapes[v] ?? r.map((_, i) => line(i)));
  }
  return gzipSync(tar(files));
}
function surfaces(rows: Record<string, Pair[]>): Buffer {
  const files: Record<string, Buffer> = { 'LISEZMOI.bin': filler() };
  for (const [v, r] of Object.entries(rows)) {
    files[`cov_${v}.dbf`] = dbf(r);
    files[`cov_${v}.shp`] = shpPolygons(r.length);
  }
  return gzipSync(tar(files));
}
const bad = (buffer: Buffer) => readShapefiles(buffer).problems;

describe('traces : enregistrements multiples d’un même ODEId dans _gl', () => {
  it('doublon légitime (même ProductId, variantes au moins aussi fournies) : accepté', () => {
    expect(
      bad(
        traces({
          gl: [a, a2, b, c],
          c0l: [a, a2, b, b, c],
          c180l: [a, a2, b, c, c],
        })
      )
    ).toEqual([]);
  });
  it('découpage au méridien sans doublon dans _gl : accepté (comportement antérieur conservé)', () => {
    expect(
      bad(traces({ gl: [a, b, c], c0l: [a, a, b, b, c], c180l: [a, b, c, c] }))
    ).toEqual([]);
  });
  it('ProductId contradictoires dans _gl, _c0l ou _c180l : refus', () => {
    const x: Pair = ['1', 'mlascirdrX'];
    expect(
      bad(traces({ gl: [a, x, b], c0l: [a, a, b], c180l: [a, a, b] })).length
    ).toBeGreaterThan(0);
    expect(
      bad(traces({ gl: [a, b], c0l: [a, x, b], c180l: [a, b] })).join('\n')
    ).toMatch(/ProductId incohérent pour l'ODEId 1/);
    expect(
      bad(traces({ gl: [a, b], c0l: [a, b], c180l: [a, x, b] })).join('\n')
    ).toMatch(/variante c180l : ProductId incohérent/);
  });
  it('ProductId différent entre variantes pour un même ODEId : refus', () => {
    const x: Pair = ['2', 'mlascirdrX'];
    expect(
      bad(traces({ gl: [a, b, c], c0l: [a, x, c], c180l: [a, b, c] })).join(
        '\n'
      )
    ).toMatch(/variante c0l : ProductId différent pour l'ODEId 2/);
    expect(
      bad(traces({ gl: [a, b, c], c0l: [a, b, c], c180l: [a, x, c] })).length
    ).toBeGreaterThan(0);
  });
  it('multiplicité par ODEId : une variante qui perd une partie d’un identifiant est refusée même si son total suffit', () => {
    // _gl : 3 enregistrements (1 deux fois). _c0l : 3 enregistrements aussi, mais 1 une fois et 2 deux fois.
    const problems = bad(
      traces({ gl: [a, a2, b], c0l: [a, b, b], c180l: [a, a2, b] })
    );
    expect(problems.join('\n')).toMatch(
      /variante c0l : 1 enregistrements pour l'ODEId 1 \(2 en _gl\)/
    );
  });
  it('une variante qui perd un identifiant entier est aussi refusée', () => {
    expect(
      bad(traces({ gl: [a, a2, b], c0l: [b, b], c180l: [a, a2, b] })).length
    ).toBeGreaterThan(0);
  });
  it('surfaces : comportement inchangé (conflit refusé, cas sain accepté)', () => {
    expect(
      bad(surfaces({ ga: [a, b], c0a: [a, a, b], c180a: [a, b, b] }))
    ).toEqual([]);
    expect(
      bad(
        surfaces({
          ga: [a, ['1', 'mlascirdrX'], b],
          c0a: [a, b],
          c180a: [a, b],
        })
      ).join('\n')
    ).toMatch(/ProductId incohérent pour l'ODEId 1/);
  });
});

// ---------- cache synthétique d'un jeu de traces à doublon ----------
function metadata(withGeometry: (id: string) => boolean): Buffer {
  const Product = ['1', '2', '3', '9'].map((id) => ({
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
  dir: string;
  metaFile: string;
  covFile: string;
}
/** `historic` : métadonnées au format historique (`.provenance.json`, `requete`) ; sinon capture isolée (`.raw`, `query`). */
function fixture(cache: string, { historic = false } = {}): Fixture {
  const dir = join(cache, 'diagnostics');
  mkdirSync(dir, { recursive: true });
  const meta = metadata((id) => id !== '9');
  // ODEId 2 : un segment dégénéré puis une ligne de 3 points, dans les trois variantes (comme 16005088).
  const rows: Pair[] = [a, b, ['2', pid('2')], c];
  const shapes = [line(1), DEGENERATE, line(5), line(3)];
  const cov = gzipSync(
    tar({
      'LISEZMOI.bin': filler(),
      'cov_gl.dbf': dbf(rows),
      'cov_gl.shp': shpLines(shapes),
      'cov_c0l.dbf': dbf([...rows, c]),
      'cov_c0l.shp': shpLines([...shapes, line(8)]),
      'cov_c180l.dbf': dbf(rows),
      'cov_c180l.shp': shpLines(shapes),
    })
  );
  const request = {
    query: 'product',
    results: 'm',
    output: 'JSON',
    target: 'mercury',
    IHID: 'MESSENGER',
    IID: 'MLA',
    PT: 'scirdrv1',
    limit: '5000',
    offset: '0',
    ...FREEZE,
  };
  const metaFile = historic ? 'meta@0.json' : 'meta@0.raw';
  const covFile = 'cov@0.raw';
  writeFileSync(join(dir, metaFile), meta);
  writeFileSync(
    join(dir, `${metaFile}.sha256`),
    `${sha256(meta)}  ${metaFile}\n`
  );
  writeFileSync(
    join(dir, historic ? `${metaFile}.provenance.json` : `${metaFile}.json`),
    JSON.stringify({
      ...(historic
        ? { requete: request }
        : { dataset: KEY, offset: 0, query: request }),
      receivedBytes: meta.length,
      sha256: sha256(meta),
      retrievedAt: '2026-11-10T12:46:11.340Z',
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
      sha256: sha256(cov),
      retrievedAt: '2026-11-10T12:29:57.688Z',
    })
  );
  writeFileSync(join(cache, 'counts.json'), JSON.stringify({ [KEY]: 4 }));
  writeFileSync(join(cache, 'freeze.json'), JSON.stringify(FREEZE));
  return { cache, dir, metaFile, covFile };
}
let cache: string;
const made: string[] = [];
const newCache = () => {
  cache = mkdtempSync(join(tmpdir(), 'odetraces-'));
  made.push(cache);
  return cache;
};
beforeEach(() => {
  newCache();
});
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

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

describe('jeu de traces à doublon : réconciliation, segment dégénéré, page', () => {
  it('manifeste construit : 4 catalogués = 3 empreintes + 1 exclu, doublon accepté', () => {
    const { manifest } = build(fixture(cache));
    expect(manifest.counts).toEqual({
      catalogued: 4,
      footprints: 3,
      excluded: 1,
    });
    expect(manifest.sources['coverage']?.variants?.['gl']).toEqual({
      records: 4,
      distinct: 3,
    });
    expect(manifest.excluded.map((e) => e.odeId)).toEqual(['9']);
  });
  it('le segment dégénéré de l’ODEId doublon est CONSERVÉ avec la ligne qui l’accompagne', () => {
    const f = fixture(cache);
    const { products } = parseCoverageArchive(
      readFileSync(join(f.dir, f.covFile)),
      KEY,
      0
    );
    const p = products.find((x) => x.id === '2');
    expect(p?.shapes['l']).toEqual([DEGENERATE, line(5)]);
  });
  it('rejeu : la page écrite par le chemin normal contient les 3 produits et les deux lignes du doublon', () => {
    build(fixture(cache));
    expect(
      replayReconciled({ cacheDir: cache, key: KEY, dryRun: true }).status
    ).toBe('dry-run');
    expect(replayReconciled({ cacheDir: cache, key: KEY }).status).toBe(
      'written'
    );
    const page = join(
      cache,
      'pages',
      'Mercury_MESSENGER_MLA_scirdrv1',
      '0.ndjson.gz'
    );
    const products = gunzipSync(readFileSync(page))
      .toString('utf8')
      .split(String.fromCharCode(10))
      .map((l) => JSON.parse(l) as { id: string; shapes: { l: Pt[][] } });
    expect(products.map((p) => p.id).sort()).toEqual(['1', '2', '3']);
    expect(products.find((p) => p.id === '2')?.shapes.l).toEqual([
      DEGENERATE,
      line(5),
    ]);
  });
  it('doublon à ProductId contradictoires : aucun manifeste, aucune page', () => {
    const f = fixture(cache);
    const cov = traces({
      gl: [a, b, ['2', 'mlascirdrX'], c],
      c0l: [a, b, ['2', 'mlascirdrX'], c],
      c180l: [a, b, ['2', 'mlascirdrX'], c],
    });
    writeFileSync(join(f.dir, f.covFile), cov);
    writeFileSync(
      join(f.dir, `${f.covFile}.sha256`),
      `${sha256(cov)}  ${f.covFile}\n`
    );
    const pj = join(f.dir, `${f.covFile}.json`);
    const prov = JSON.parse(readFileSync(pj, 'utf8')) as Record<
      string,
      unknown
    >;
    writeFileSync(
      pj,
      JSON.stringify({
        ...prov,
        sha256: sha256(cov),
        receivedBytes: cov.length,
      })
    );
    refused(() => build(f), /ProductId incohérent/);
    expect(existsSync(manifestPath(cache, KEY))).toBe(false);
  });
});
