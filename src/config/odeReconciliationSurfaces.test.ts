import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  ImportError,
  importCapture,
} from '../../scripts/ode-import-capture.mjs';
import {
  buildReconciliation,
  replayReconciled,
} from '../../scripts/ode-reconcile.mjs';
import {
  ReconciliationError,
  loadReconciliation,
  validateManifest,
} from '../../scripts/ode-reconciliation.mjs';

/**
 * RÉCONCILIATION DES SURFACES `_ga` (GAL-A003-06K/06L). Données SYNTHÉTIQUES, caches jetables, aucun
 * réseau. Le cas réel : Mercury|MESSENGER|MASCS|MEAP2, 87 catalogués = 86 empreintes + 1 exclu
 * (16012292), 92 enregistrements pour 86 identifiants dans chacune des trois variantes.
 */
const KEY = 'Mercury|MESSENGER|MASCS|MEAP2';
const FREEZE = { mincreationtime: '1900-01-01', maxcreationtime: '2026-09-29' };
const PAGE = 5000;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const pidOf = (id: string) => `uvvs_${id}`;

// ---------- constructeurs d'archives ----------
function tarOf(entries: Record<string, Buffer>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 'latin1');
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'latin1');
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
interface Rec {
  id: string;
  pid?: string;
}
function dbf(rows: Rec[]): Buffer {
  const fields: [string, number][] = [
    ['ODEId', 12],
    ['ProductId', 30],
    ['DatasetId', 20],
    ['UTCstart', 12],
    ['UTCend', 12],
    ['LabelURL', 40],
    ['Target', 10],
  ];
  const rl = 1 + fields.reduce((a, f) => a + f[1], 0);
  const hl = 32 + 32 * fields.length + 1;
  const b = Buffer.alloc(hl + rl * rows.length);
  b.writeUInt32LE(rows.length, 4);
  b.writeUInt16LE(hl, 8);
  b.writeUInt16LE(rl, 10);
  fields.forEach(([n, len], i) => {
    b.write(n, 32 + 32 * i, 'latin1');
    b[32 + 32 * i + 16] = len;
  });
  b[32 + 32 * fields.length] = 0x0d;
  rows.forEach((r, i) => {
    let p = hl + rl * i;
    b[p] = 0x20;
    p++;
    const vals = [
      r.id,
      r.pid ?? pidOf(r.id),
      'DS',
      '2004-08-13Z',
      '2015-04-30Z',
      `https://x/${r.id}.xml`,
      'MERCURY',
    ];
    fields.forEach(([, len], k) => {
      b.write(String(vals[k]).padEnd(len).slice(0, len), p, 'latin1');
      p += len;
    });
  });
  return b;
}
/** Un polygone rectangulaire (type 5) par enregistrement. */
function shpPolygons(n: number): Buffer {
  const recs: Buffer[] = [Buffer.alloc(100)];
  for (let i = 0; i < n; i++) {
    const pts = [
      [10 + i, 20],
      [10 + i, 21],
      [11 + i, 21],
      [11 + i, 20],
      [10 + i, 20],
    ];
    const c = Buffer.alloc(44 + 4 + 16 * pts.length);
    c.writeInt32LE(5, 0);
    c.writeInt32LE(1, 36);
    c.writeInt32LE(pts.length, 40);
    c.writeInt32LE(0, 44);
    pts.forEach(([x, y], k) => {
      c.writeDoubleLE(x, 48 + 16 * k);
      c.writeDoubleLE(y, 56 + 16 * k);
    });
    const h = Buffer.alloc(8);
    h.writeInt32BE(i + 1, 0);
    h.writeInt32BE(c.length / 2, 4);
    recs.push(h, c);
  }
  return Buffer.concat(recs);
}
type Variants = Record<string, Rec[]>;
function archive(rows: Variants, skipShp: string[] = []): Buffer {
  const entries: Record<string, Buffer> = {};
  for (const [v, list] of Object.entries(rows)) {
    entries[`m_${v}.dbf`] = dbf(list);
    if (!skipShp.includes(v)) entries[`m_${v}.shp`] = shpPolygons(list.length);
  }
  // L'archive de moins de 1024 octets est lue comme une page vide : remplissage incompressible.
  entries['m_pad.prj'] = randomBytes(1500);
  return gzipSync(tarOf(entries));
}
const recs = (ids: string[]): Rec[] => ids.map((id) => ({ id }));
const IDS = ['1', '2', '3', '4', '5'];
/** Surfaces : 6 enregistrements pour 5 identifiants dans chaque variante (anneau découpé). */
const surfaces = (ids = IDS, over: Variants = {}): Variants => ({
  ga: recs([...ids, ids[0]]),
  c0a: recs([...ids, ids[1]]),
  c180a: recs([...ids, ids[2]]),
  ...over,
});
const traces = (ids = IDS): Variants => ({
  gl: recs(ids),
  c0l: recs(ids),
  c180l: recs(ids),
});

interface MetaProduct {
  id: string;
  fields?: Record<string, string>;
}
function metadata(products: MetaProduct[]): Buffer {
  const Product = products.map(({ id, fields }) => ({
    ProductURL: `http://ode/x.aspx?product_id=${pidOf(id)}&product_idGeo=${id}`,
    ...(fields ?? {}),
  }));
  return Buffer.from(
    JSON.stringify({
      ODEResults: { Status: 'Success', Products: { Product } },
    })
  );
}
const GEO = { Footprint_geometry: 'POLYGON ((1 2, 3 4, 5 6, 1 2))' };
const GEO_GL = { Footprint_GL_geometry: 'LINESTRING (1 2, 3 4)' };

interface Fixture {
  cache: string;
  dir: string;
}
interface Options {
  excluded?: string[];
  archive?: Buffer;
  meta?: Buffer;
  count?: number;
  covOver?: Record<string, unknown>;
  metaOver?: Record<string, unknown>;
  kind?: 'a' | 'l';
}
/** Cache jetable avec les deux captures au format des SONDES (champ `query`, fichier `.raw`). */
function fixture(o: Options = {}): Fixture {
  const excluded = o.excluded ?? ['9'];
  const geo = o.kind === 'l' ? GEO_GL : GEO;
  const cache = mkdtempSync(join(tmpdir(), 'rec-surf-'));
  const dir = join(cache, 'diagnostics');
  mkdirSync(dir, { recursive: true });
  const cat =
    o.meta ??
    metadata([
      ...IDS.map((id) => ({ id, fields: geo })),
      ...excluded.map((id) => ({ id })),
    ]);
  const cov = o.archive ?? archive(o.kind === 'l' ? traces() : surfaces());
  const q = {
    query: 'product',
    results: 'm',
    output: 'JSON',
    target: 'mercury',
    IHID: 'MESSENGER',
    IID: 'MASCS',
    PT: 'MEAP2',
    limit: '5000',
    offset: '0',
    ...FREEZE,
  };
  const put = (file: string, buf: Buffer, prov: Record<string, unknown>) => {
    writeFileSync(join(dir, file), buf);
    writeFileSync(join(dir, `${file}.sha256`), `${sha(buf)}  ${file}\n`);
    writeFileSync(
      join(dir, `${file}.json`),
      JSON.stringify({
        sha256: sha(buf),
        receivedBytes: buf.length,
        retrievedAt: '2026-11-10T00:00:00.000Z',
        ...prov,
      })
    );
  };
  put('meta.raw', cat, {
    dataset: KEY,
    offset: 0,
    limit: 5000,
    freeze: FREEZE,
    query: q,
    ...o.metaOver,
  });
  put('cov.raw', cov, {
    dataset: KEY,
    offset: 0,
    limit: 5000,
    freeze: FREEZE,
    query: { ...q, query: 'coveragetargz' },
    ...o.covOver,
  });
  writeFileSync(
    join(cache, 'counts.json'),
    JSON.stringify({ [KEY]: o.count ?? IDS.length + excluded.length })
  );
  writeFileSync(join(cache, 'freeze.json'), JSON.stringify(FREEZE));
  return { cache, dir };
}
const build = (fx: Fixture) =>
  buildReconciliation({
    cacheDir: fx.cache,
    key: KEY,
    metadataFile: 'meta.raw',
    coverageFile: 'cov.raw',
    now: new Date('2026-11-10T00:00:00Z'),
  });
const refused = (fn: () => unknown, re: RegExp) => {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ReconciliationError);
  expect((error as Error).message).toMatch(re);
};
/** Empreinte de tout un dossier (chemin -> SHA-256), pour prouver qu'rien n'a bougé. */
function snap(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) walk(p);
      else out[p.slice(root.length)] = sha(readFileSync(p));
    }
  };
  walk(root);
  return out;
}

describe('surfaces _ga : construction du manifeste', () => {
  it('6 catalogués = 5 empreintes + 1 exclu, avec 6 enregistrements pour 5 identifiants par variante', () => {
    const { manifest } = build(fixture());
    expect(manifest.geometryKind).toBe('a');
    expect(manifest.counts).toEqual({
      catalogued: 6,
      footprints: 5,
      excluded: 1,
    });
    expect(manifest.excluded.map((e: { odeId: string }) => e.odeId)).toEqual([
      '9',
    ]);
    expect(Object.keys(manifest.excluded[0].inShapefiles).sort()).toEqual([
      'c0a',
      'c180a',
      'ga',
    ]);
    expect(manifest.sources.coverage.variants.ga).toEqual({
      records: 6,
      distinct: 5,
    });
  });

  it('un manifeste de traces garde son format historique : aucune clé geometryKind, variantes _gl', () => {
    const { manifest } = build(fixture({ kind: 'l' }));
    expect('geometryKind' in manifest).toBe(false);
    expect(Object.keys(manifest.excluded[0].inShapefiles).sort()).toEqual([
      'c0l',
      'c180l',
      'gl',
    ]);
    expect(manifest.version).toBe(1);
    expect(manifest.counts).toEqual({
      catalogued: 6,
      footprints: 5,
      excluded: 1,
    });
  });

  it('traces : plusieurs enregistrements pour un identifiant de _gl restent refusés', () => {
    const t = traces();
    t.gl = [...t.gl, { id: '1' }];
    refused(
      () => build(fixture({ kind: 'l', archive: archive(t) })),
      /enregistrements pour/
    );
  });

  it('écart de catalogue non prouvé : counts.json ne vaut pas le catalogue lu', () => {
    refused(() => build(fixture({ count: 7 })), /counts\.json/);
    refused(() => build(fixture({ count: 5 })), /counts\.json/);
  });

  it('ProductId incohérents : deux ProductId pour un ODEId, ou shapefile différent des métadonnées', () => {
    const a = surfaces();
    a.ga = [...a.ga, { id: '1', pid: 'autre' }];
    refused(
      () => build(fixture({ archive: archive(a) })),
      /ProductId incohérent/
    );
    const b = surfaces();
    b.ga = b.ga.map((r) => (r.id === '3' ? { id: '3', pid: 'faux' } : r));
    refused(
      () => build(fixture({ archive: archive(b) })),
      /ProductId faux \(shapefile\) différent/
    );
  });

  it('ProductId falsifié dans UNE variante seulement (c0a, puis c180a), ensembles d’identifiants identiques : refus', () => {
    for (const variant of ['c0a', 'c180a']) {
      const rows = surfaces();
      rows[variant] = rows[variant].map((r) =>
        r.id === '2' ? { id: '2', pid: 'falsifie' } : r
      );
      refused(
        () => build(fixture({ archive: archive(rows) })),
        new RegExp(
          `variante ${variant} : ODEId 2 porte le ProductId falsifie au lieu de ${pidOf('2')}`
        )
      );
    }
    // Contrôle : sans falsification, les mêmes ensembles passent.
    expect(build(fixture()).manifest.counts.footprints).toBe(5);
  });

  it('archive de surfaces réduite aux .dbf (une variante, puis toutes) : refus ; le chemin _gl garde son comportement', () => {
    refused(
      () => build(fixture({ archive: archive(surfaces(), ['c180a']) })),
      /variante `_c180a` sans fichier \.shp exploitable/
    );
    refused(
      () =>
        build(
          fixture({ archive: archive(surfaces(), ['ga', 'c0a', 'c180a']) })
        ),
      /sans fichier \.shp exploitable/
    );
    // Traces : l'exigence n'a pas été étendue (comportement historique conservé).
    const t = build(
      fixture({
        kind: 'l',
        archive: archive(traces(), ['gl', 'c0l', 'c180l']),
      })
    );
    expect(t.manifest.counts.excluded).toBe(1);
  });

  it('identifiant inattendu : hors catalogue, ou présent dans une variante seulement', () => {
    refused(
      () => build(fixture({ archive: archive(surfaces([...IDS, '77'])) })),
      /absent du catalogue : 77/
    );
    refused(
      () =>
        build(
          fixture({
            archive: archive(surfaces(IDS, { c180a: recs([...IDS, '9']) })),
          })
        ),
      /variante c180a : identifiant 9 absent de _ga/
    );
  });

  it('variante manquante (c0a, puis ga) ou identifiant de _ga absent d’une autre variante', () => {
    const s = surfaces();
    delete s.c0a;
    refused(
      () => build(fixture({ archive: archive(s) })),
      /variante `_c0a` manquante/
    );
    const g = surfaces();
    delete g.ga;
    refused(
      () => build(fixture({ archive: archive(g) })),
      /manquante|sans shapefile/
    );
    refused(
      () =>
        build(
          fixture({
            archive: archive(surfaces(IDS, { c0a: recs(IDS.slice(1)) })),
          })
        ),
      /identifiant 1 de _ga absent/
    );
  });

  it('produit exclu portant une géométrie : champ connu, ou champ inconnu de nom géométrique ; vide / EMPTY ne comptent pas', () => {
    const withGeo = (fields: Record<string, string>) =>
      metadata([
        ...IDS.map((id) => ({ id, fields: GEO })),
        { id: '9', fields },
      ]);
    refused(
      () => build(fixture({ meta: withGeo(GEO) })),
      /exclusion injustifiée/
    );
    refused(
      () =>
        build(
          fixture({
            meta: withGeo({ Footprint_exotic_geometry: 'POINT (1 2)' }),
          })
        ),
      /exclu mais porte Footprint_exotic_geometry/
    );
    const { manifest } = build(
      fixture({
        meta: withGeo({
          Footprint_exotic_geometry: 'POLYGON EMPTY',
          Footprints_cross_meridian: 'true',
        }),
      })
    );
    expect(manifest.counts.excluded).toBe(1);
  });

  it('empreinte sans géométrie dans les métadonnées : refus', () => {
    const meta = metadata([
      ...IDS.map((id) => ({ id, fields: id === '3' ? {} : GEO })),
      { id: '9' },
    ]);
    refused(
      () => build(fixture({ meta })),
      /produit 3 : dans le shapefile mais sans géométrie/
    );
  });

  it('archive mêlant traces et surfaces : refus', () => {
    const mixed = { ...surfaces(), gl: recs(IDS) };
    refused(
      () => build(fixture({ archive: archive(mixed) })),
      /plusieurs natures/
    );
  });

  it('SHA-256 et provenances corrompus : octet du brut, somme .sha256, provenance, taille', () => {
    let fx = fixture();
    const b = readFileSync(join(fx.dir, 'cov.raw'));
    b[b.length - 5] ^= 0xff;
    writeFileSync(join(fx.dir, 'cov.raw'), b);
    refused(() => build(fx), /SHA-256/);
    fx = fixture();
    writeFileSync(
      join(fx.dir, 'meta.raw.sha256'),
      `${'0'.repeat(64)}  meta.raw\n`
    );
    refused(() => build(fx), /somme \.sha256/);
    refused(
      () => build(fixture({ covOver: { sha256: '1'.repeat(64) } })),
      /différent de la provenance/
    );
    refused(
      () => build(fixture({ metaOver: { receivedBytes: 3 } })),
      /octets pour 3 annoncés/
    );
  });

  it('provenance incompatible : requête d’un autre jeu, gel différent, offset non nul', () => {
    const q = {
      query: 'product',
      results: 'm',
      output: 'JSON',
      target: 'mercury',
      IHID: 'MESSENGER',
      IID: 'MASCS',
      PT: 'MEAP1',
      limit: '5000',
      offset: '0',
      ...FREEZE,
    };
    refused(
      () => build(fixture({ metaOver: { query: q } })),
      /paramètre PT=MEAP1/
    );
    refused(
      () =>
        build(
          fixture({
            covOver: { freeze: { ...FREEZE, maxcreationtime: '2026-10-01' } },
          })
        ),
      /gel différent/
    );
    refused(() => build(fixture({ covOver: { offset: 5000 } })), /offset 5000/);
  });
});

describe('surfaces _ga : manifeste publié et rejeu', () => {
  it('dry-run : rien n’est écrit ; un manifeste existant n’est jamais écrasé', () => {
    const fx = fixture();
    build(fx);
    const before = snap(fx.cache);
    const r = replayReconciled({ cacheDir: fx.cache, key: KEY, dryRun: true });
    expect(r.status).toBe('dry-run');
    expect(r.withFootprint).toBe(5);
    expect(existsSync(join(fx.cache, 'pages'))).toBe(false);
    refused(() => build(fx), /existe déjà/);
    expect(snap(fx.cache)).toEqual(before);
  });

  it('manifeste altéré ou incompatible : source modifiée, nature inconnue, clés de la mauvaise nature, comptes', () => {
    const fx = fixture();
    const { manifest } = build(fx);
    const ctx = {
      cacheDir: fx.cache,
      key: KEY,
      freeze: FREEZE,
      catalogueCount: 6,
      pageSize: PAGE,
    };
    expect(loadReconciliation(ctx)?.geometryKind).toBe('a');
    const bad = (m: unknown) =>
      validateManifest(m, {
        key: KEY,
        freeze: FREEZE,
        catalogueCount: 6,
        pageSize: PAGE,
      });
    expect(bad(manifest)).toEqual([]);
    expect(bad({ ...manifest, geometryKind: 'z' }).join()).toMatch(
      /nature de géométrie z/
    );
    // Sans geometryKind le manifeste est un manifeste de traces : la clé `gl` manque.
    expect(bad({ ...manifest, geometryKind: undefined }).join()).toMatch(
      /absence des shapefiles non démontrée/
    );
    expect(bad({ ...manifest, version: 2 }).join()).toMatch(/version 2/);
    expect(
      bad({
        ...manifest,
        counts: { ...manifest.counts, footprints: 4 },
      }).join()
    ).toMatch(/empreintes annoncées/);
    expect(
      bad({
        ...manifest,
        excluded: [
          {
            ...manifest.excluded[0],
            inShapefiles: { ga: false, c0a: true, c180a: false },
          },
        ],
      }).join()
    ).toMatch(/absence des shapefiles/);
    expect(
      bad({
        ...manifest,
        excluded: [{ ...manifest.excluded[0], inShapefiles: { gl: false } }],
      }).join()
    ).toMatch(/absence des shapefiles/);
    // Surfaces : les trois variantes, toutes à false, ni moins ni plus.
    for (const proof of [
      { ga: false },
      { ga: false, c0a: false },
      { ga: false, c180a: false },
      { c0a: false, c180a: false },
      { ga: false, c0a: false, c180a: false, gl: false },
      { ga: false, c0a: false, c180a: 'false' },
      { ga: false, c0a: false, autre: false },
      { ga: false, c180a: false, autre: false },
      {},
    ])
      expect(
        bad({
          ...manifest,
          excluded: [{ ...manifest.excluded[0], inShapefiles: proof }],
        }).join()
      ).toMatch(/absence des shapefiles non démontrée/);
    expect(
      bad({
        ...manifest,
        excluded: [
          {
            ...manifest.excluded[0],
            inShapefiles: { ga: false, c0a: false, c180a: false },
          },
        ],
      })
    ).toEqual([]);
    writeFileSync(
      join(fx.dir, 'cov.raw'),
      Buffer.concat([readFileSync(join(fx.dir, 'cov.raw')), Buffer.from('x')])
    );
    refused(() => loadReconciliation(ctx), /source coverage/);
  });
});

describe('import d’une capture conservée', () => {
  function source() {
    const fx = fixture();
    return {
      fx,
      cap: join(fx.dir, 'cov.raw'),
      meta: join(fx.dir, 'meta.raw'),
    };
  }
  function destination() {
    const dest = mkdtempSync(join(tmpdir(), 'dest-surf-'));
    writeFileSync(join(dest, 'counts.json'), JSON.stringify({ [KEY]: 6 }));
    writeFileSync(join(dest, 'freeze.json'), JSON.stringify(FREEZE));
    return dest;
  }

  it('mode sec par défaut ; import réel : originaux intouchés, copies identiques, rejeu idempotent, puis réconciliation', () => {
    const s = source();
    const dest = destination();
    const before = snap(s.fx.dir);
    const dry = importCapture({ cacheDir: dest, mainFile: s.cap });
    expect(dry.status).toBe('dry-run');
    expect(existsSync(join(dest, 'diagnostics'))).toBe(false);
    for (const f of [s.meta, s.cap])
      expect(
        importCapture({ cacheDir: dest, mainFile: f, write: true }).status
      ).toBe('imported');
    expect(snap(s.fx.dir)).toEqual(before);
    for (const f of ['cov.raw', 'cov.raw.json', 'cov.raw.sha256'])
      expect(
        readFileSync(join(dest, 'diagnostics', f)).equals(
          readFileSync(join(s.fx.dir, f))
        )
      ).toBe(true);
    expect(
      importCapture({ cacheDir: dest, mainFile: s.cap, write: true }).imported
    ).toEqual([]);
    expect(
      readdirSync(join(dest, 'diagnostics')).filter((f) => f.endsWith('.tmp'))
    ).toEqual([]);
    const { manifest } = buildReconciliation({
      cacheDir: dest,
      key: KEY,
      metadataFile: 'meta.raw',
      coverageFile: 'cov.raw',
    });
    expect(manifest.counts.excluded).toBe(1);
  });

  it('collision avec un contenu différent : refus AVANT toute écriture, rien n’est écrasé', () => {
    const s = source();
    const dest = destination();
    mkdirSync(join(dest, 'diagnostics'));
    writeFileSync(join(dest, 'diagnostics', 'cov.raw.sha256'), 'AUTRE');
    const before = snap(dest);
    expect(() =>
      importCapture({ cacheDir: dest, mainFile: s.cap, write: true })
    ).toThrow(/collision/);
    expect(snap(dest)).toEqual(before);
  });

  it.each([
    [
      'octet du contenu',
      (c: string) => {
        const b = readFileSync(c);
        b[0] ^= 1;
        writeFileSync(c, b);
      },
    ],
    [
      'somme .sha256',
      (c: string) => writeFileSync(`${c}.sha256`, `${'0'.repeat(64)}  x\n`),
    ],
    [
      'SHA-256 de la provenance',
      (c: string) =>
        writeFileSync(
          `${c}.json`,
          JSON.stringify({
            sha256: '2'.repeat(64),
            receivedBytes: readFileSync(c).length,
          })
        ),
    ],
    [
      'taille de la provenance',
      (c: string) =>
        writeFileSync(
          `${c}.json`,
          JSON.stringify({ sha256: sha(readFileSync(c)), receivedBytes: 1 })
        ),
    ],
    ['provenance absente', (c: string) => rmSync(`${c}.json`)],
  ])('source corrompue (%s) : refus sans écriture', (_name, mutate) => {
    const s = source();
    const dest = destination();
    mutate(s.cap);
    expect(() =>
      importCapture({ cacheDir: dest, mainFile: s.cap, write: true })
    ).toThrow(ImportError);
    expect(readdirSync(dest).sort()).toEqual(['counts.json', 'freeze.json']);
  });

  it('lien dur impossible : refus, aucun repli par copie, rien laissé', () => {
    const s = source();
    const dest = destination();
    let copies = 0;
    const fs = {
      linkSync: () => {
        throw Object.assign(new Error('x'), { code: 'EPERM' });
      },
      copyFileSync: () => {
        copies++;
      },
    };
    expect(() =>
      importCapture({ cacheDir: dest, mainFile: s.cap, write: true, fs })
    ).toThrow(/lien dur impossible.*aucun repli/);
    expect(copies).toBe(0);
    expect(readdirSync(join(dest, 'diagnostics'))).toEqual([]);
  });

  it('interruption en cours d’import : les fichiers créés par CET appel sont retirés, les autres intacts', () => {
    const s = source();
    const dest = destination();
    mkdirSync(join(dest, 'diagnostics'));
    writeFileSync(join(dest, 'diagnostics', 'preexistant.txt'), 'garde');
    let n = 0;
    const flaky = {
      linkSync: (a: string, b: string) => {
        if (++n === 3) throw Object.assign(new Error('x'), { code: 'EPERM' });
        linkSync(a, b);
      },
    };
    expect(() =>
      importCapture({ cacheDir: dest, mainFile: s.cap, write: true, fs: flaky })
    ).toThrow(ImportError);
    expect(readdirSync(join(dest, 'diagnostics'))).toEqual(['preexistant.txt']);
  });

  it('import partiel (processus tué après la provenance et la somme) : jamais pris pour complet, reprise possible', () => {
    const s = source();
    const dest = destination();
    importCapture({ cacheDir: dest, mainFile: s.meta, write: true });
    // Reste d'une interruption : provenance et somme présentes, contenu principal absent.
    for (const f of ['cov.raw.json', 'cov.raw.sha256'])
      writeFileSync(
        join(dest, 'diagnostics', f),
        readFileSync(join(s.fx.dir, f))
      );
    expect(() =>
      buildReconciliation({
        cacheDir: dest,
        key: KEY,
        metadataFile: 'meta.raw',
        coverageFile: 'cov.raw',
      })
    ).toThrow();
    expect(existsSync(join(dest, 'reconciliation'))).toBe(false);
    const r = importCapture({ cacheDir: dest, mainFile: s.cap, write: true });
    expect(r.imported).toEqual(['cov.raw']);
    expect(r.alreadyPresent).toHaveLength(2);
    expect(
      buildReconciliation({
        cacheDir: dest,
        key: KEY,
        metadataFile: 'meta.raw',
        coverageFile: 'cov.raw',
      }).manifest.counts.excluded
    ).toBe(1);
  });

  it.each([
    ['chemin relatif', () => 'relatif/cache'],
    ['chemin vide', () => ''],
    ['dossier du dépôt', () => join(process.cwd(), 'cache-test')],
    ['dossier inexistant', () => join(tmpdir(), 'n-existe-pas-06l')],
    ['dossier sans counts.json', () => mkdtempSync(join(tmpdir(), 'vide-'))],
  ])('destination dangereuse (%s) : refus sans écriture', (_n, make) => {
    const s = source();
    const dest = make();
    expect(() =>
      importCapture({ cacheDir: dest, mainFile: s.cap, write: true })
    ).toThrow(ImportError);
    if (dest && existsSync(dest))
      expect(existsSync(join(dest, 'diagnostics'))).toBe(false);
  });

  it('chemin RELATIF vers un cache valide (ligne de commande, cwd voisin) : refus, rien écrit', () => {
    const s = source();
    const dest = destination();
    const r = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'ode-import-capture.mjs'),
        '--cache-dir',
        basename(dest),
        '--source',
        s.cap,
        '--write',
      ],
      { cwd: dirname(dest), encoding: 'utf8' }
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/chemin absolu/);
    expect(existsSync(join(dest, 'diagnostics'))).toBe(false);
  });

  it('cache situé dans un dépôt git (un .git plus haut) : refus', () => {
    const s = source();
    const repo = mkdtempSync(join(tmpdir(), 'depot-'));
    mkdirSync(join(repo, '.git'));
    const dest = join(repo, 'cache');
    mkdirSync(dest);
    writeFileSync(join(dest, 'counts.json'), '{}');
    expect(() =>
      importCapture({ cacheDir: dest, mainFile: s.cap, write: true })
    ).toThrow(/dépôt|worktree|git/);
    expect(existsSync(join(dest, 'diagnostics'))).toBe(false);
  });

  it('jonction hors dépôt vers un cache situé dans un dépôt git : refus sur le chemin canonique, rien écrit', () => {
    const s = source();
    const repo = mkdtempSync(join(tmpdir(), 'depot-reel-'));
    mkdirSync(join(repo, '.git'));
    const cible = join(repo, 'cache');
    mkdirSync(cible);
    writeFileSync(join(cible, 'counts.json'), '{}');
    const lien = join(mkdtempSync(join(tmpdir(), 'hors-depot-')), 'cache');
    symlinkSync(cible, lien, 'junction');
    // Sans la jonction, le chemin fourni est externe et valide : seule la cible réelle est fautive.
    expect(existsSync(join(lien, 'counts.json'))).toBe(true);
    expect(() =>
      importCapture({ cacheDir: lien, mainFile: s.cap, write: true })
    ).toThrow(/git|dépôt|worktree/);
    expect(() => importCapture({ cacheDir: lien, mainFile: s.cap })).toThrow(
      /cible réelle/
    );
    expect(existsSync(join(cible, 'diagnostics'))).toBe(false);
  });

  it('jonction vers un cache valide hors dépôt : acceptée, écriture dans la cible canonique', () => {
    const s = source();
    const cible = destination();
    const lien = join(mkdtempSync(join(tmpdir(), 'hors-depot-')), 'cache');
    symlinkSync(cible, lien, 'junction');
    const r = importCapture({ cacheDir: lien, mainFile: s.cap, write: true });
    expect(r.status).toBe('imported');
    expect(existsSync(join(cible, 'diagnostics', 'cov.raw'))).toBe(true);
  });

  it('diagnostics/ est un lien (jonction) : refus ; source déjà dans le cache : refus', () => {
    const s = source();
    const dest = destination();
    const elsewhere = mkdtempSync(join(tmpdir(), 'ailleurs-'));
    symlinkSync(elsewhere, join(dest, 'diagnostics'), 'junction');
    expect(() =>
      importCapture({ cacheDir: dest, mainFile: s.cap, write: true })
    ).toThrow(/lien symbolique/);
    expect(readdirSync(elsewhere)).toEqual([]);
    const own = destination();
    mkdirSync(join(own, 'diagnostics'));
    const inside = join(own, 'diagnostics', 'cov.raw');
    for (const f of ['', '.json', '.sha256'])
      writeFileSync(`${inside}${f}`, readFileSync(`${s.cap}${f}`));
    expect(() =>
      importCapture({ cacheDir: own, mainFile: inside, write: true })
    ).toThrow(/déjà dans le cache/);
  });

  it('le code d’import ne contient aucun repli par copie ni renommage', () => {
    const text = readFileSync(
      join(process.cwd(), 'scripts', 'ode-import-capture.mjs'),
      'utf8'
    ).replace(/\/\*\*[\s\S]*?\*\//, '');
    expect(text).not.toMatch(/copyFile|COPYFILE|writeFileExclusive|renameSync/);
    expect(text).toMatch(/linkSync/);
  });
});
