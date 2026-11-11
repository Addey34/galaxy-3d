import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parseCoverageArchive } from '../../scripts/ode-coverage.mjs';
import {
  MaterializeError,
  commitPage,
  parseArgs,
  planReconciledPage,
  run,
  shapesProblem,
} from '../../scripts/ode-materialize.mjs';
import {
  validatePageBuffer,
  writePageAtomic,
} from '../../scripts/ode-pages.mjs';
import { buildReconciliation } from '../../scripts/ode-reconcile.mjs';

/**
 * MATÉRIALISEUR STRICT (GAL-A003-10A). Données SYNTHÉTIQUES, caches jetables sous le dossier temporaire, aucun accès
 * réseau et aucune dépendance au cache scientifique privé : ces tests rejouent en CI. Ils reprennent ceux du
 * matérialiseur de GAL-A003-09D (surfaces 06P, traces 09D).
 */
const FREEZE = { mincreationtime: '1900-01-01', maxcreationtime: '2026-09-29' };
const IDS = ['1', '2', '3', '4', '5'];
const NL = String.fromCharCode(10);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
type Kind = 'a' | 'l';
type Bad = null | 'short' | 'degenerate' | 'nan' | 'bounds' | 'multipart';
const CASES: Record<
  Kind,
  { key: string; dir: string; pid: string; it: string }
> = {
  a: {
    key: 'Mercury|MESSENGER|MASCS|MEAP2',
    dir: 'Mercury_MESSENGER_MASCS_MEAP2',
    pid: 'uvvs',
    it: 'MEAP2',
  },
  l: {
    key: 'Mercury|MESSENGER|MLA|scirdrv2',
    dir: 'Mercury_MESSENGER_MLA_scirdrv2',
    pid: 'mlascirdr',
    it: 'scirdrv2',
  },
};
const roots: string[] = [];
const scratch = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  roots.push(d);
  return d;
};
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

// ---------- constructeurs d'archives ----------
const FIELDS = ['ODEId', 'ProductId', 'DatasetId', 'UTCstart', 'UTCend'];
const WIDTH = 24;
function dbf(rows: [string, string][]): Buffer {
  const hl = 32 + 32 * FIELDS.length + 1;
  const rl = 1 + WIDTH * FIELDS.length;
  const out = Buffer.alloc(hl + rows.length * rl);
  out[0] = 3;
  out.writeUInt32LE(rows.length, 4);
  out.writeUInt16LE(hl, 8);
  out.writeUInt16LE(rl, 10);
  FIELDS.forEach((n, i) => {
    out.write(n, 32 + 32 * i, 'latin1');
    out[32 + 32 * i + 16] = WIDTH;
  });
  out[32 + 32 * FIELDS.length] = 0x0d;
  rows.forEach(([id, pid], r) => {
    const base = hl + r * rl;
    out[base] = 0x20;
    const v = [id, pid, 'DS', '2011-01-01', '2011-01-02'];
    FIELDS.forEach((_, i) =>
      out.write(v[i].padEnd(WIDTH, ' '), base + 1 + WIDTH * i, 'latin1')
    );
  });
  return out;
}
type Pt = [number, number];
function record(type: number, parts: Pt[][], i: number): Buffer[] {
  const pts = parts.flat();
  const c = Buffer.alloc(44 + 4 * parts.length + 16 * pts.length);
  c.writeInt32LE(type, 0);
  c.writeInt32LE(parts.length, 36);
  c.writeInt32LE(pts.length, 40);
  let at = 0;
  parts.forEach((p, k) => {
    c.writeInt32LE(at, 44 + 4 * k);
    at += p.length;
  });
  const base = 44 + 4 * parts.length;
  pts.forEach(([x, y], k) => {
    c.writeDoubleLE(x, base + 16 * k);
    c.writeDoubleLE(y, base + 8 + 16 * k);
  });
  const h = Buffer.alloc(8);
  h.writeInt32BE(i + 1, 0);
  h.writeInt32BE(c.length / 2, 4);
  return [h, c];
}
/** Polylignes (type 3). `bad` s'applique au 3e enregistrement. */
function shpLines(n: number, bad: Bad): Buffer {
  const out: Buffer[] = [Buffer.alloc(100)];
  for (let i = 0; i < n; i++) {
    let pts: Pt[] = [
      [10 + i, 20],
      [10.5 + i, 21],
      [11 + i, 22],
    ];
    const hit = i === 2;
    if (hit && bad === 'short') pts = [[10, 20]];
    if (hit && bad === 'degenerate')
      pts = [
        [110.986, 81.899],
        [110.986, 81.899],
      ];
    if (hit && bad === 'nan') pts[1] = [NaN, 21];
    if (hit && bad === 'bounds') pts[1] = [10, 95];
    const parts: Pt[][] =
      hit && bad === 'multipart' ? [pts.slice(0, 2), [pts[1], pts[2]]] : [pts];
    out.push(...record(3, parts, i));
  }
  return Buffer.concat(out);
}
/** Polygones (type 5). `open` ouvre le 3e anneau. */
function shpPolygons(n: number, open: boolean): Buffer {
  const out: Buffer[] = [Buffer.alloc(100)];
  for (let i = 0; i < n; i++) {
    const ring: Pt[] = [
      [10 + i, 20],
      [10 + i, 21],
      [11 + i, 21],
      [11 + i, 20],
      [10 + i, 20],
    ];
    if (open && i === 2) ring[4] = [15, 25];
    out.push(...record(5, [ring], i));
  }
  return Buffer.concat(out);
}
function tarOf(entries: Record<string, Buffer>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 'latin1');
    h.write(data.length.toString(8).padStart(11, '0') + ' ', 124, 'latin1');
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

interface Options {
  kind?: Kind;
  bad?: Bad | 'open';
  mixed?: boolean;
}
/** Cache fictif réconcilié : 5 produits sur 6 catalogués (le 9 n'a pas de géométrie). */
function fixture({ kind = 'a', bad = null, mixed = false }: Options = {}) {
  const c = CASES[kind];
  const cache = scratch('mat10a-');
  const dir = join(cache, 'diagnostics');
  mkdirSync(dir, { recursive: true });
  const rows = (extra: string[]) =>
    [...IDS, ...extra].map((id): [string, string] => [id, `${c.pid}_${id}`]);
  const entries: Record<string, Buffer> = {};
  // c0* et c180* ont un enregistrement de plus : découpe au méridien.
  const variants: [string, string[]][] =
    kind === 'a'
      ? [
          ['ga', []],
          ['c0a', ['2']],
          ['c180a', ['3']],
        ]
      : [
          ['gl', []],
          ['c0l', ['2']],
          ['c180l', ['3']],
        ];
  for (const [v, extra] of variants) {
    entries[`m_${v}.dbf`] = dbf(rows(extra));
    const n = IDS.length + extra.length;
    entries[`m_${v}.shp`] =
      kind === 'a'
        ? shpPolygons(n, bad === 'open' && v === 'ga')
        : shpLines(n, v === 'gl' ? (bad as Bad) : null);
  }
  if (mixed) {
    entries['m_ga.dbf'] = dbf(rows([]).slice(0, IDS.length));
    entries['m_ga.shp'] = shpPolygons(IDS.length, false);
  }
  entries['m_pad.prj'] = randomBytes(1500);
  const cov = gzipSync(tarOf(entries));
  const Product = [
    ...IDS.map((id) => ({ id, geo: true })),
    { id: '9', geo: false },
  ].map(({ id, geo }) => ({
    ProductURL: `http://ode/x.aspx?product_id=${c.pid}_${id}&product_idGeo=${id}`,
    ...(geo
      ? {
          Footprint_geometry:
            kind === 'a'
              ? 'POLYGON ((1 2, 3 4, 5 6, 1 2))'
              : 'LINESTRING (1 2, 3 4)',
        }
      : {}),
  }));
  const meta = Buffer.from(
    JSON.stringify({ ODEResults: { Status: 'Success', Products: { Product } } })
  );
  const q = {
    query: 'product',
    results: 'm',
    output: 'JSON',
    target: 'mercury',
    IHID: 'MESSENGER',
    IID: kind === 'a' ? 'MASCS' : 'MLA',
    PT: c.it,
    limit: '5000',
    offset: '0',
    ...FREEZE,
  };
  const put = (file: string, buf: Buffer, query: Record<string, string>) => {
    writeFileSync(join(dir, file), buf);
    writeFileSync(join(dir, `${file}.sha256`), `${sha(buf)}  ${file}${NL}`);
    writeFileSync(
      join(dir, `${file}.json`),
      JSON.stringify({
        sha256: sha(buf),
        receivedBytes: buf.length,
        retrievedAt: '2026-11-10T00:00:00.000Z',
        dataset: c.key,
        offset: 0,
        limit: 5000,
        freeze: FREEZE,
        query,
      })
    );
  };
  put('meta.raw', meta, q);
  put('cov.raw', cov, { ...q, query: 'coveragetargz' });
  writeFileSync(join(cache, 'counts.json'), JSON.stringify({ [c.key]: 6 }));
  writeFileSync(join(cache, 'freeze.json'), JSON.stringify(FREEZE));
  mkdirSync(join(cache, 'pages', 'autre_jeu'), { recursive: true });
  writeFileSync(join(cache, 'pages', 'autre_jeu', '0.ndjson.gz'), 'historique');
  const build = () =>
    buildReconciliation({
      cacheDir: cache,
      key: c.key,
      metadataFile: 'meta.raw',
      coverageFile: 'cov.raw',
      now: new Date('2026-11-10T00:00:00Z'),
    });
  if (!mixed) build();
  return {
    cache,
    dir,
    key: c.key,
    pageDir: c.dir,
    build,
    mf: join(cache, 'reconciliation', `${c.dir}.json`),
    plan: () => planReconciledPage({ cacheDir: cache, key: c.key }),
  };
}

function snap(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p.slice(root.length)] = sha(readFileSync(p));
    }
  };
  walk(root);
  return out;
}
const refused = (fn: () => unknown, re: RegExp) => {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(MaterializeError);
  expect((error as Error).message).toMatch(re);
};
const edit = (file: string, fn: (o: Record<string, unknown>) => void) => {
  const o = JSON.parse(readFileSync(file, 'utf8'));
  fn(o);
  writeFileSync(file, JSON.stringify(o));
};
/** Les octets que produit le pipeline normal (writePageAtomic) pour la même capture. */
function pipelineBytes(
  fx: ReturnType<typeof fixture>,
  p: ReturnType<typeof fixture>['plan'] extends () => infer R ? R : never
) {
  const { products } = parseCoverageArchive(
    readFileSync(join(fx.dir, 'cov.raw')),
    fx.key,
    0
  );
  const ref = scratch('mat10a-ref-');
  writePageAtomic(join(ref, '0.ndjson.gz'), products, {
    expected: p.count,
    excludedIds: p.excludedIds,
    allowedIds: p.footprintIds,
  });
  return readFileSync(join(ref, '0.ndjson.gz'));
}
const lines = (target: string) =>
  gunzipSync(readFileSync(target))
    .toString('utf8')
    .split(NL)
    .map((l) => JSON.parse(l));

describe.each(['a', 'l'] as Kind[])('page valide, nature %s', (kind) => {
  it('plan sans écriture, octets identiques au pipeline normal, un seul fichier ajouté par la publication', () => {
    const fx = fixture({ kind });
    const before = snap(fx.cache);
    const p = fx.plan();
    expect(p.kind).toBe(kind);
    expect(p.count).toBe(5);
    expect(p.catalogued).toBe(6);
    expect([...p.footprintIds].sort()).toEqual(IDS);
    expect([...p.excludedIds]).toEqual(['9']);
    expect(snap(fx.cache)).toEqual(before);
    expect(existsSync(p.dir)).toBe(false);
    expect(pipelineBytes(fx, p).equals(p.bytes)).toBe(true);
    const r = commitPage(p, { cacheDir: fx.cache });
    expect(r.sha256).toBe(p.pageSha256);
    expect(r.bytes).toBe(p.pageBytes);
    expect(statSync(p.target).nlink).toBe(1);
    expect(readdirSync(p.dir)).toEqual(['0.ndjson.gz']);
    const after = snap(fx.cache);
    expect(Object.keys(after).filter((k) => !(k in before))).toHaveLength(1);
    for (const k of Object.keys(before)) expect(after[k]).toBe(before[k]);
  });

  it('manifeste de la bonne nature : une nature incohérente est refusée', () => {
    const fx = fixture({ kind });
    const other = kind === 'a' ? undefined : 'a';
    edit(fx.mf, (m) => {
      if (other) m['geometryKind'] = other;
      else delete m['geometryKind'];
    });
    refused(() => fx.plan(), /manifeste refusé|nature du shapefile/);
    edit(fx.mf, (m) => (m['geometryKind'] = 'p'));
    refused(() => fx.plan(), /manifeste refusé|non admise/);
    expect(existsSync(join(fx.cache, 'pages', fx.pageDir))).toBe(false);
  });

  it('identifiants manquants ou inattendus, exclusion incohérente, gel : refus, rien d’écrit', () => {
    const alt = (fn: (m: Record<string, unknown>) => void) => {
      const f = fixture({ kind });
      edit(f.mf, fn);
      return f;
    };
    const ids = (m: Record<string, unknown>) => m['footprintIds'] as string[];
    const ex = (m: Record<string, unknown>) =>
      (
        m['excluded'] as {
          odeId: string;
          inShapefiles: Record<string, boolean>;
        }[]
      )[0];
    refused(() => alt((m) => ids(m).pop()).plan(), /manifeste refusé/);
    refused(
      () => alt((m) => ids(m).push('77')).plan(),
      /manifeste refusé|identifiant/
    );
    refused(
      () =>
        alt(
          (m) => (m['footprintIds'] = ids(m).map((i) => (i === '5' ? '8' : i)))
        ).plan(),
      /identifiant|rejeu|manifeste refusé/
    );
    refused(
      () =>
        alt((m) => {
          ex(m).inShapefiles[kind === 'a' ? 'c0a' : 'gl'] = true;
        }).plan(),
      /manifeste refusé[^]*absence des shapefiles/
    );
    refused(
      () =>
        alt((m) => {
          ex(m).odeId = '5';
          m['footprintIds'] = ids(m).map((i) => (i === '5' ? '9' : i));
        }).plan(),
      /exclu|rejeu|manifeste refusé|identifiant/
    );
    const fx = fixture({ kind });
    writeFileSync(
      join(fx.cache, 'freeze.json'),
      JSON.stringify({ ...FREEZE, maxcreationtime: '2026-10-01' })
    );
    refused(() => fx.plan(), /gel/);
    const none = fixture({ kind });
    rmSync(none.mf);
    refused(() => none.plan(), /aucun manifeste/);
  });

  it('sources et provenances falsifiées (octets, SHA-256, taille, somme annexe, jeu, limite) : refus par le manifeste', () => {
    const f1 = fixture({ kind });
    const b = readFileSync(join(f1.dir, 'cov.raw'));
    b[b.length - 4] ^= 0xff;
    writeFileSync(join(f1.dir, 'cov.raw'), b);
    refused(() => f1.plan(), /manifeste refusé[^]*source coverage/);
    const f2 = fixture({ kind });
    writeFileSync(
      join(f2.dir, 'meta.raw'),
      Buffer.concat([readFileSync(join(f2.dir, 'meta.raw')), Buffer.from('x')])
    );
    refused(() => f2.plan(), /manifeste refusé[^]*source metadata/);
    const prov = (file: string, fn: (p: Record<string, unknown>) => void) => {
      const f = fixture({ kind });
      edit(join(f.dir, file), fn);
      return f;
    };
    refused(
      () => prov('cov.raw.json', (p) => (p['sha256'] = 'f'.repeat(64))).plan(),
      /manifeste refusé[^]*provenance/
    );
    refused(
      () => prov('meta.raw.json', (p) => (p['receivedBytes'] = 1)).plan(),
      /manifeste refusé[^]*provenance/
    );
    refused(
      () =>
        prov('cov.raw.json', (p) => (p['dataset'] = 'Autre|Jeu|X|y')).plan(),
      /manifeste refusé[^]*provenance/
    );
    refused(
      () => prov('cov.raw.json', (p) => (p['limit'] = 100)).plan(),
      /manifeste refusé[^]*limite/
    );
    const f3 = fixture({ kind });
    writeFileSync(
      join(f3.dir, 'cov.raw.sha256'),
      `${'0'.repeat(64)}  cov.raw${NL}`
    );
    refused(() => f3.plan(), /manifeste refusé[^]*somme/);
    const f4 = fixture({ kind });
    rmSync(join(f4.dir, 'meta.raw.json'));
    refused(() => f4.plan(), /manifeste refusé[^]*provenance/);
  });

  it('verrou, cible existante, dossier non vide et temporaire préexistant : refus au plan et à la publication', () => {
    let fx = fixture({ kind });
    writeFileSync(join(fx.cache, 'collect.lock'), '1');
    refused(() => fx.plan(), /collect\.lock/);
    fx = fixture({ kind });
    let p = fx.plan();
    writeFileSync(join(fx.cache, 'collect.lock'), '1');
    refused(() => commitPage(p, { cacheDir: fx.cache }), /collect\.lock/);
    expect(existsSync(p.dir)).toBe(false);
    fx = fixture({ kind });
    p = fx.plan();
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(p.target, 'AUTRE');
    refused(() => fx.plan(), /existe déjà|statut/);
    refused(() => commitPage(p, { cacheDir: fx.cache }), /existe déjà/);
    expect(readFileSync(p.target, 'utf8')).toBe('AUTRE');
    fx = fixture({ kind });
    p = fx.plan();
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(join(p.dir, '0.ndjson.gz.tmp'), 'reste');
    refused(() => fx.plan(), /pas vide|statut|existe/);
    refused(() => commitPage(p, { cacheDir: fx.cache }), /pas vide/);
    expect(readFileSync(join(p.dir, '0.ndjson.gz.tmp'), 'utf8')).toBe('reste');
    expect(existsSync(p.target)).toBe(false);
  });

  it('collision à l’instant du lien : la page du gagnant est laissée intacte, aucun temporaire', () => {
    const fx = fixture({ kind });
    const p = fx.plan();
    const link = (a: string, b: string) => {
      writeFileSync(b, 'GAGNANT');
      linkSync(a, b);
    };
    refused(
      () => commitPage(p, { cacheDir: fx.cache, fs: { linkSync: link } }),
      /collision/
    );
    expect(readFileSync(p.target, 'utf8')).toBe('GAGNANT');
    expect(readdirSync(p.dir)).toEqual(['0.ndjson.gz']);
  });

  it.each(['EPERM', 'EXDEV', 'ENOSYS', 'ENOTSUP', 'EACCES'])(
    'lien dur impossible (%s) : refus, aucune page, aucune copie, cache intact',
    (code) => {
      const fx = fixture({ kind });
      const p = fx.plan();
      const before = snap(fx.cache);
      let copies = 0;
      const fs = {
        linkSync: () => {
          throw Object.assign(new Error('x'), { code });
        },
        copyFileSync: () => {
          copies++;
        },
      };
      refused(
        () => commitPage(p, { cacheDir: fx.cache, fs }),
        /lien dur impossible.*aucun repli/
      );
      expect(copies).toBe(0);
      expect(existsSync(p.target)).toBe(false);
      expect(readdirSync(p.dir)).toEqual([]);
      const after = snap(fx.cache);
      for (const k of Object.keys(before)) expect(after[k]).toBe(before[k]);
    }
  );

  it('écriture interrompue (disque plein) : aucune page, aucun temporaire ; contenu altéré non gzip après le lien : page retirée', () => {
    let fx = fixture({ kind });
    let p = fx.plan();
    expect(() =>
      commitPage(p, {
        cacheDir: fx.cache,
        fs: {
          writeSync: () => {
            throw Object.assign(new Error('disque plein'), { code: 'ENOSPC' });
          },
        },
      })
    ).toThrow();
    expect(existsSync(p.target)).toBe(false);
    expect(readdirSync(p.dir)).toEqual([]);
    fx = fixture({ kind });
    p = fx.plan();
    const link = (a: string, b: string) => {
      linkSync(a, b);
      writeFileSync(b, Buffer.concat([readFileSync(b), Buffer.from('x')]));
    };
    refused(
      () => commitPage(p, { cacheDir: fx.cache, fs: { linkSync: link } }),
      /ÉTAT PARTIEL[^]*relecture différente[^]*laissée/
    );
    // Contenu modifié SUR PLACE : ce n'est plus prouvé le nôtre, la page est laissée (jamais retirée à l'aveugle).
    expect(existsSync(p.target)).toBe(true);
  });

  it('altération APRÈS le lien laissant un gzip VALIDE (libellé ou coordonnée) : l’égalité des octets la détecte, page retirée', () => {
    const mutations: ((pr: Record<string, unknown>) => void)[] = [
      (pr) => (pr['label'] = `${String(pr['label'])}-ALTERE`),
      (pr) => {
        const s = pr['shapes'] as Record<string, number[][][]>;
        s[kind][0][0][1] += 0.001;
      },
    ];
    for (const mutate of mutations) {
      const fx = fixture({ kind });
      const p = fx.plan();
      const link = (a: string, b: string) => {
        linkSync(a, b);
        const products = lines(b);
        mutate(products[2]);
        writeFileSync(
          b,
          gzipSync(products.map((x) => JSON.stringify(x)).join(NL))
        );
      };
      // Contrôle : la page altérée reste VALIDE pour validatePageBuffer, seule l'égalité des octets la refuse.
      const probe = scratch('mat10a-alt-');
      writeFileSync(join(probe, 'x'), p.bytes);
      link(join(probe, 'x'), join(probe, 'y'));
      const altered = readFileSync(join(probe, 'y'));
      expect(() =>
        validatePageBuffer(altered, {
          expected: p.count,
          excludedIds: p.excludedIds,
          allowedIds: p.footprintIds,
        })
      ).not.toThrow();
      expect(sha(altered)).not.toBe(p.pageSha256);
      refused(
        () => commitPage(p, { cacheDir: fx.cache, fs: { linkSync: link } }),
        /ÉTAT PARTIEL[^]*relecture différente[^]*laissée/
      );
      expect(existsSync(p.target)).toBe(true);
      expect(readdirSync(p.dir)).toEqual(['0.ndjson.gz']);
    }
  });

  it('un second nom physique sur la page publiée : refus et page retirée (nlink différent de 1)', () => {
    const fx = fixture({ kind });
    const p = fx.plan();
    const extra = join(fx.cache, 'second-nom');
    const link = (a: string, b: string) => {
      linkSync(a, b);
      linkSync(b, extra);
    };
    refused(
      () => commitPage(p, { cacheDir: fx.cache, fs: { linkSync: link } }),
      /plusieurs noms/
    );
    expect(existsSync(p.target)).toBe(false);
  });

  describe('retour arrière après le lien : seule la page liée par CET appel est retirée', () => {
    /** Fait échouer la relecture de la cible UNE fois, après `act` (autrui agit entre le lien et le retour arrière). */
    const hooked = (target: string, act: () => void) => {
      let first = true;
      return {
        readFileSync: (f: string) => {
          if (first && f === target) {
            first = false;
            act();
            return Buffer.from('relecture différente');
          }
          return readFileSync(f);
        },
      };
    };
    it('cible toujours identique (même inode, mêmes octets) : retour arrière autorisé, cause d’origine gardée', () => {
      const fx = fixture({ kind });
      const p = fx.plan();
      refused(
        () =>
          commitPage(p, {
            cacheDir: fx.cache,
            fs: hooked(p.target, () => undefined),
          }),
        /^page retirée après relecture : relecture différente/
      );
      expect(existsSync(p.target)).toBe(false);
      expect(readdirSync(p.dir)).toEqual([]);
    });
    it('cible remplacée par un AUTRE contenu : fichier d’autrui préservé, état partiel', () => {
      const fx = fixture({ kind });
      const p = fx.plan();
      const keep = join(fx.cache, 'ancien-inode');
      const fs = hooked(p.target, () => {
        // Un lien garde l'ancien inode vivant : le test ne dépend jamais de sa réattribution.
        linkSync(p.target, keep);
        rmSync(p.target);
        writeFileSync(p.target, 'contenu d’autrui');
      });
      refused(
        () => commitPage(p, { cacheDir: fx.cache, fs }),
        /ÉTAT PARTIEL, intervention manuelle : relecture différente[^]*laissée/
      );
      expect(readFileSync(p.target, 'utf8')).toBe('contenu d’autrui');
      expect(readdirSync(p.dir)).toEqual(['0.ndjson.gz']);
    });
    it('DÉFAUT D’ORIGINE : un fichier d’autrui posé juste après le lien n’est jamais supprimé', () => {
      const fx = fixture({ kind });
      const p = fx.plan();
      const keep = join(fx.cache, 'ancien-inode');
      const link = (a: string, b: string) => {
        linkSync(a, b);
        linkSync(b, keep);
        rmSync(b);
        writeFileSync(b, 'contenu d’autrui');
      };
      expect(() =>
        commitPage(p, { cacheDir: fx.cache, fs: { linkSync: link } })
      ).toThrow(/ÉTAT PARTIEL|plusieurs noms|relecture/);
      expect(existsSync(p.target)).toBe(true);
      expect(readFileSync(p.target, 'utf8')).toBe('contenu d’autrui');
    });
    it('cible recréée avec les MÊMES octets mais un autre inode : préservée', () => {
      const fx = fixture({ kind });
      const p = fx.plan();
      const keep = join(fx.cache, 'ancien-inode');
      const fs = hooked(p.target, () => {
        linkSync(p.target, keep);
        rmSync(p.target);
        writeFileSync(p.target, p.bytes);
      });
      refused(
        () => commitPage(p, { cacheDir: fx.cache, fs }),
        /ÉTAT PARTIEL[^]*laissée/
      );
      expect(readFileSync(p.target).equals(p.bytes)).toBe(true);
      expect(statSync(p.target, { bigint: true }).ino).not.toBe(
        statSync(keep, { bigint: true }).ino
      );
    });
    it('même inode, contenu modifié sur place : préservée', () => {
      const fx = fixture({ kind });
      const p = fx.plan();
      const fs = hooked(p.target, () =>
        writeFileSync(p.target, 'modifié sur place')
      );
      refused(
        () => commitPage(p, { cacheDir: fx.cache, fs }),
        /ÉTAT PARTIEL[^]*laissée/
      );
      expect(readFileSync(p.target, 'utf8')).toBe('modifié sur place');
    });
    it('cible disparue : aucun autre fichier n’est retiré, la cause d’origine est rendue', () => {
      const fx = fixture({ kind });
      const p = fx.plan();
      const sibling = join(p.dir, '9.ndjson.gz');
      mkdirSync(p.dir, { recursive: true });
      writeFileSync(sibling, 'page sœur');
      const fs = hooked(p.target, () => rmSync(p.target));
      refused(
        () =>
          commitPage(p, { cacheDir: fx.cache, fs, allowSiblingPages: true }),
        /^page retirée après relecture : relecture différente/
      );
      expect(readFileSync(sibling, 'utf8')).toBe('page sœur');
      expect(existsSync(p.target)).toBe(false);
    });
    it('retrait impossible de la cible (identique) : état partiel explicite avec le chemin', () => {
      const fx = fixture({ kind });
      const p = fx.plan();
      const fs = {
        ...hooked(p.target, () => undefined),
        rmSync: (f: string, o?: { force?: boolean }) => {
          if (f === p.target)
            throw Object.assign(new Error('x'), { code: 'EBUSY' });
          rmSync(f, o);
        },
      };
      refused(
        () => commitPage(p, { cacheDir: fx.cache, fs }),
        /ÉTAT PARTIEL, intervention manuelle : relecture différente[^]*n'a pas pu être retirée \(EBUSY\)/
      );
      expect(existsSync(p.target)).toBe(true);
    });
    it('page sœur déjà présente : jamais réécrite ni retirée par un échec voisin', () => {
      const fx = fixture({ kind });
      const p = fx.plan();
      const sibling = join(p.dir, '9.ndjson.gz');
      mkdirSync(p.dir, { recursive: true });
      writeFileSync(sibling, 'page sœur');
      const before = statSync(sibling, { bigint: true });
      refused(
        () =>
          commitPage(p, {
            cacheDir: fx.cache,
            allowSiblingPages: true,
            fs: hooked(p.target, () => undefined),
          }),
        /page retirée après relecture/
      );
      expect(statSync(sibling, { bigint: true }).ino).toBe(before.ino);
      expect(readFileSync(sibling, 'utf8')).toBe('page sœur');
    });
  });

  it('page contenant l’exclu ou un identifiant hors manifeste : la validation refuse et retire la page liée', () => {
    const fx = fixture({ kind });
    let p = fx.plan();
    p.footprintIds = new Set(['1', '2', '3', '4']);
    refused(
      () => commitPage(p, { cacheDir: fx.cache }),
      /retirée après relecture.*identifiant non attendu/
    );
    expect(existsSync(p.target)).toBe(false);
    p = fx.plan();
    p.excludedIds = new Set(['3']);
    refused(
      () => commitPage(p, { cacheDir: fx.cache }),
      /retirée après relecture.*exclusion injustifiée/
    );
    expect(readdirSync(p.dir)).toEqual([]);
  });

  it('deux processus publient en même temps : un seul gagnant, l’autre refuse sans écraser', async () => {
    const fx = fixture({ kind });
    const barrier = scratch('mat10a-bar-');
    const module = pathToFileURL(
      join(process.cwd(), 'scripts', 'ode-materialize.mjs')
    ).href;
    const code = `import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { planReconciledPage, commitPage } from ${JSON.stringify(module)};
const [cacheDir, key, barrier] = process.argv.slice(1);
const plan = planReconciledPage({ cacheDir, key });
console.log('READY');
while (!existsSync(join(barrier, 'go'))) await new Promise((r) => setTimeout(r, 2));
try { console.log('RESULT ' + JSON.stringify({ ok: true, sha256: commitPage(plan, { cacheDir }).sha256 })); }
catch (e) { console.log('RESULT ' + JSON.stringify({ ok: false, message: e.message })); }`;
    const children = [0, 1].map(() => {
      const c = spawn(
        process.execPath,
        ['--input-type=module', '-e', code, fx.cache, fx.key, barrier],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      const out = {
        text: '',
        ready: Promise.resolve(),
        done: Promise.resolve(),
      };
      out.ready = new Promise<void>((resolve) =>
        c.stdout.on('data', (d) => {
          out.text += String(d);
          if (out.text.includes('READY')) resolve();
        })
      );
      out.done = new Promise<void>((resolve) => c.on('close', () => resolve()));
      c.stderr.on('data', (d) => (out.text += String(d)));
      return out;
    });
    await Promise.all(children.map((c) => c.ready));
    writeFileSync(join(barrier, 'go'), '');
    await Promise.all(children.map((c) => c.done));
    const results = children.map((c) => {
      const l = c.text.split(NL).find((x) => x.startsWith('RESULT '));
      return JSON.parse(
        (
          l ??
          'RESULT {"ok":false,"message":"aucun résultat: ' +
            c.text.slice(-300) +
            '"}'
        ).slice(7)
      );
    });
    expect(
      results.filter((r) => r.ok),
      JSON.stringify(results)
    ).toHaveLength(1);
    expect(results.find((r) => !r.ok).message).toMatch(
      /collision|existe déjà|pas vide/
    );
    const pageDir = join(fx.cache, 'pages', fx.pageDir);
    expect(readdirSync(pageDir)).toEqual(['0.ndjson.gz']);
    expect(statSync(join(pageDir, '0.ndjson.gz')).nlink).toBe(1);
  }, 60_000);
});

describe('finalisation après le lien (GAL-A003-10B)', () => {
  const tmpName = (f: unknown) =>
    /\.tmp$/.test(String(f)) && !/\.tmp\.tmp$/.test(String(f));
  const auxName = (f: unknown) => /\.tmp\.tmp$/.test(String(f));
  /** rmSync qui échoue sur les fichiers désignés, comme un antivirus ou un disque en défaut. */
  const failing = (pick: (f: unknown) => boolean) => ({
    rmSync: (f: string, o?: { force?: boolean }) => {
      if (pick(f))
        throw Object.assign(new Error('EPERM simulé'), { code: 'EPERM' });
      rmSync(f, o);
    },
  });
  const catchError = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e as Error;
    }
    return null;
  };

  it('publication normale : résultat inchangé (SHA-256, taille, un seul nom, un seul fichier)', () => {
    const fx = fixture({ kind: 'l' });
    const p = fx.plan();
    const r = commitPage(p, { cacheDir: fx.cache, fs: failing(() => false) });
    expect(r).toEqual({
      target: p.target,
      sha256: p.pageSha256,
      bytes: p.pageBytes,
    });
    expect(statSync(p.target).nlink).toBe(1);
    expect(readdirSync(p.dir)).toEqual(['0.ndjson.gz']);
  });

  it('échec du retrait du temporaire APRÈS le lien : jamais de succès, page retirée, temporaire signalé', () => {
    const fx = fixture({ kind: 'l' });
    const p = fx.plan();
    const e = catchError(() =>
      commitPage(p, { cacheDir: fx.cache, fs: failing(tmpName) })
    );
    expect(e).toBeInstanceOf(MaterializeError);
    expect(e?.message).toMatch(
      /non retiré\(s\), à retirer à la main[^]*plusieurs noms/
    );
    expect(e?.message).not.toMatch(/ÉTAT PARTIEL/);
    expect(existsSync(p.target)).toBe(false);
    // Seul NOTRE temporaire reste, nommé dans le message ; rien d'autre n'a bougé.
    const left = readdirSync(p.dir);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/\.tmp$/);
    expect(e?.message).toContain(left[0]);
  });

  it('échec du retrait du temporaire AUXILIAIRE après le lien : même refus explicite', () => {
    const fx = fixture({ kind: 'l' });
    const p = fx.plan();
    // Le temporaire auxiliaire n'existe pas : on exige que l'échec de son retrait soit traité comme les autres.
    const e = catchError(() =>
      commitPage(p, { cacheDir: fx.cache, fs: failing(auxName) })
    );
    expect(e).toBeInstanceOf(MaterializeError);
    expect(e?.message).toMatch(/non retiré\(s\), à retirer à la main/);
    expect(existsSync(p.target)).toBe(false);
    expect(readdirSync(p.dir)).toEqual([]);
  });

  it('échec du nettoyage AVANT le lien (écriture en échec) : aucune page, l’erreur d’origine reste en tête', () => {
    const fx = fixture({ kind: 'l' });
    const p = fx.plan();
    const fs = {
      ...failing(tmpName),
      writeSync: () => {
        throw Object.assign(new Error('disque plein'), { code: 'ENOSPC' });
      },
    };
    const e = catchError(() => commitPage(p, { cacheDir: fx.cache, fs }));
    expect(e?.message).toMatch(/^disque plein/);
    expect(existsSync(p.target)).toBe(false);
    // Le temporaire écrit par writeFileAtomic a été retiré par lui ; un reste éventuel est signalé, jamais ignoré.
    for (const f of readdirSync(p.dir)) expect(e?.message).toContain(f);
  });

  it('collision au lien puis échec du retrait du temporaire : la page du gagnant reste intacte', () => {
    const fx = fixture({ kind: 'l' });
    const p = fx.plan();
    const fs = {
      ...failing(tmpName),
      linkSync: (a: string, b: string) => {
        writeFileSync(b, 'GAGNANT');
        linkSync(a, b);
      },
    };
    const e = catchError(() => commitPage(p, { cacheDir: fx.cache, fs }));
    expect(e?.message).toMatch(/collision[^]*à retirer à la main/);
    expect(readFileSync(p.target, 'utf8')).toBe('GAGNANT');
  });

  it('échec de récupération après une première erreur : état partiel explicite, les deux erreurs rapportées, rien d’autre touché', () => {
    const fx = fixture({ kind: 'l' });
    const p = fx.plan();
    const fs = {
      ...failing((f) => String(f) === p.target),
      linkSync: (a: string, b: string) => {
        linkSync(a, b);
        writeFileSync(b, Buffer.concat([readFileSync(b), Buffer.from('x')]));
      },
    };
    const before = snap(fx.cache);
    const e = catchError(() => commitPage(p, { cacheDir: fx.cache, fs }));
    expect(e).toBeInstanceOf(MaterializeError);
    expect(e?.message).toMatch(
      /ÉTAT PARTIEL, intervention manuelle[^]*relecture différente[^]*laissée/
    );
    expect(e?.message).toContain(p.target);
    // État sur disque : la page altérée est LAISSÉE (non retirable de façon sûre), aucun autre fichier du cache ne change.
    expect(existsSync(p.target)).toBe(true);
    const after = snap(fx.cache);
    for (const k of Object.keys(before)) expect(after[k]).toBe(before[k]);
    expect(Object.keys(after).filter((k) => !(k in before))).toHaveLength(1);
  });

  it('temporaire et récupération en échec ensemble : état partiel, temporaire nommé', () => {
    const fx = fixture({ kind: 'l' });
    const p = fx.plan();
    const e = catchError(() =>
      commitPage(p, {
        cacheDir: fx.cache,
        fs: failing((f) => tmpName(f) || String(f) === p.target),
      })
    );
    expect(e?.message).toMatch(
      /ÉTAT PARTIEL[^]*plusieurs noms[^]*n'a pas pu être retirée[^]*à retirer à la main/
    );
    expect(statSync(p.target).nlink).toBe(2);
  });
});

describe('surfaces', () => {
  it('anneau non fermé dans la capture : refus avant toute écriture', () => {
    const fx = fixture({ kind: 'a', bad: 'open' });
    refused(() => fx.plan(), /non fermé|anneau/);
    expect(existsSync(join(fx.cache, 'pages', fx.pageDir))).toBe(false);
  });
});

describe('traces', () => {
  it('segment dégénéré (2 points identiques) : conservé dans la page, jamais supprimé ni corrigé', () => {
    const fx = fixture({ kind: 'l', bad: 'degenerate' });
    const p = fx.plan();
    commitPage(p, { cacheDir: fx.cache });
    const prods = lines(p.target);
    const prod3 = prods.find((x) => String(x.id) === '3');
    expect(prod3.shapes.l).toEqual([
      [
        [110.986, 81.899],
        [110.986, 81.899],
      ],
    ]);
    expect(prods.reduce((n, x) => n + x.shapes.l.length, 0)).toBe(5);
  });

  it.each([
    ['short', /moins de 2 points/],
    ['nan', /non finie|hors bornes/],
    ['bounds', /hors bornes/],
  ] as [Bad, RegExp][])(
    'ligne inexploitable (%s) : refus avant toute écriture',
    (bad, re) => {
      const fx = fixture({ kind: 'l', bad });
      const before = snap(fx.cache);
      refused(() => fx.plan(), re);
      expect(snap(fx.cache)).toEqual(before);
      expect(existsSync(join(fx.cache, 'pages', fx.pageDir))).toBe(false);
    }
  );

  it('enregistrement _gl multipartie : refus prudent (lignes des produits différentes des enregistrements)', () => {
    const fx = fixture({ kind: 'l', bad: 'multipart' });
    refused(
      () => fx.plan(),
      /lignes dans les produits pour \d+ enregistrements _gl|manifeste refusé/
    );
    expect(existsSync(join(fx.cache, 'pages', fx.pageDir))).toBe(false);
  });

  it('jeu mêlant surfaces et traces : aucun manifeste, donc aucun plan', () => {
    const mixed = fixture({ kind: 'l', mixed: true });
    expect(() => mixed.build()).toThrow(/plusieurs natures/);
    expect(existsSync(mixed.mf)).toBe(false);
    refused(() => mixed.plan(), /aucun manifeste|manifeste refusé/);
  });
});

describe('nature des formes', () => {
  const ring = [
    [0, 0],
    [0, 1],
    [1, 1],
    [0, 0],
  ];
  it('surfaces', () => {
    expect(shapesProblem({ shapes: { a: [ring] } })).toBeNull();
    expect(shapesProblem({ shapes: {} })).toMatch(/aucune/);
    expect(shapesProblem({ shapes: { l: [ring] } })).toMatch(/surfaces/);
    expect(shapesProblem({ shapes: { a: [] } })).toMatch(/aucun anneau/);
    expect(
      shapesProblem({
        shapes: {
          a: [
            [
              [0, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      })
    ).toMatch(/moins de 4/);
    expect(
      shapesProblem({
        shapes: {
          a: [
            [
              [0, 0],
              [0, 1],
              [1, 1],
              [2, 2],
            ],
          ],
        },
      })
    ).toMatch(/non fermé/);
    expect(
      shapesProblem({
        shapes: {
          a: [
            [
              [0, 0],
              [0, 95],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      })
    ).toMatch(/hors bornes/);
    expect(
      shapesProblem({
        shapes: {
          a: [
            [
              [0, 0],
              [NaN, 1],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      })
    ).toMatch(/non finie/);
  });
  it('traces', () => {
    expect(
      shapesProblem(
        {
          shapes: {
            l: [
              [
                [0, 0],
                [1, 1],
              ],
            ],
          },
        },
        'l'
      )
    ).toBeNull();
    expect(
      shapesProblem(
        {
          shapes: {
            l: [
              [
                [5, 5],
                [5, 5],
              ],
            ],
          },
        },
        'l'
      )
    ).toBeNull();
    expect(shapesProblem({ shapes: { l: [] } }, 'l')).toMatch(/aucune ligne/);
    expect(shapesProblem({ shapes: { a: [ring] } }, 'l')).toMatch(/traces/);
    expect(
      shapesProblem(
        {
          shapes: {
            l: [
              [
                [0, 0],
                [1, 1],
              ],
            ],
          },
        },
        'a'
      )
    ).toMatch(/surfaces/);
    expect(
      shapesProblem(
        {
          shapes: {
            l: [
              [
                [0, 0],
                [1, 1],
              ],
            ],
          },
        },
        'p'
      )
    ).toMatch(/non admise/);
  });
});

describe('interface : mode sec par défaut, écriture explicite, aucun défaut', () => {
  it('chemin du cache et jeu obligatoires, option inconnue refusée, rien d’implicite', () => {
    refused(() => parseArgs([]), /--cache-dir est obligatoire/);
    refused(() => parseArgs(['--dataset', 'x']), /--cache-dir est obligatoire/);
    refused(
      () => parseArgs(['--cache-dir', 'C:/x']),
      /--dataset est obligatoire/
    );
    refused(() => parseArgs(['--write']), /--cache-dir est obligatoire/);
    refused(() => parseArgs(['--cache-dir']), /exige une valeur/);
    refused(
      () => parseArgs(['--cache-dir', '--write', '--dataset', 'k']),
      /exige une valeur/
    );
    refused(
      () => parseArgs(['--cache-dir', 'C:/x', '--dataset', 'k', '--force']),
      /option inconnue/
    );
    expect(parseArgs(['--cache-dir', 'C:/x', '--dataset', 'k'])).toEqual({
      cacheDir: 'C:/x',
      key: 'k',
      write: false,
    });
    expect(
      parseArgs(['--cache-dir', 'C:/x', '--dataset', 'k', '--write']).write
    ).toBe(true);
  });

  it('cache relatif, absent, hors cache de collecte ou dans le dépôt : refus', () => {
    refused(() => run(['--cache-dir', 'relatif', '--dataset', 'k']), /./);
    refused(
      () =>
        run([
          '--cache-dir',
          join(tmpdir(), 'inexistant-mat10a'),
          '--dataset',
          'k',
        ]),
      /./
    );
    const empty = scratch('mat10a-vide-');
    refused(
      () => run(['--cache-dir', empty, '--dataset', 'k']),
      /counts\.json absent/
    );
    refused(() => run(['--cache-dir', process.cwd(), '--dataset', 'k']), /./);
    const fx = fixture({ kind: 'l' });
    refused(
      () => run(['--cache-dir', fx.cache, '--dataset', 'Mercury|X|Y|z']),
      /absent de counts\.json/
    );
  });

  it('sans --write : ne crée rien ; avec --write : publie une page, et seulement elle', () => {
    const fx = fixture({ kind: 'l' });
    const before = snap(fx.cache);
    const dry = run(['--cache-dir', fx.cache, '--dataset', fx.key]);
    expect(dry.published).toBeNull();
    expect(dry.report['mode']).toBe('SEC');
    expect(dry.report['nature']).toBe('l');
    expect(snap(fx.cache)).toEqual(before);
    expect(existsSync(join(fx.cache, 'pages', fx.pageDir))).toBe(false);
    const wet = run(['--cache-dir', fx.cache, '--dataset', fx.key, '--write']);
    expect(wet.report['mode']).toBe('ECRITURE');
    expect(wet.published?.sha256).toBe(dry.report['sha256Page']);
    const after = snap(fx.cache);
    expect(Object.keys(after).filter((k) => !(k in before))).toHaveLength(1);
    // Une seconde publication ne peut rien écraser.
    refused(
      () => run(['--cache-dir', fx.cache, '--dataset', fx.key, '--write']),
      /existe déjà|statut|pas vide/
    );
    expect(snap(fx.cache)).toEqual(after);
  });

  it('aucune requête réseau : fetch n’est jamais appelé, même sur un jeu absent', () => {
    const spy = vi.fn(() => {
      throw new Error('réseau interdit');
    });
    vi.stubGlobal('fetch', spy);
    try {
      const fx = fixture({ kind: 'a' });
      run(['--cache-dir', fx.cache, '--dataset', fx.key]);
      rmSync(join(fx.dir, 'cov.raw'));
      refused(() => run(['--cache-dir', fx.cache, '--dataset', fx.key]), /./);
      const src = readFileSync(
        join(process.cwd(), 'scripts', 'ode-materialize.mjs'),
        'utf8'
      )
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(src).not.toMatch(
        /\bfetch\s*\(|node:https?|node:net|XMLHttpRequest|writePageAtomic\s*\(|copyFileSync|renameSync/
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
