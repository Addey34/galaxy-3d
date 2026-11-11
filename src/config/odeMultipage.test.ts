import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import {
  cpSync,
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
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaterializeError } from '../../scripts/ode-materialize.mjs';
import {
  DATASET_PAGINATION,
  MultipageError,
  PAGINATION_PROFILES,
  allowedDatasetIdsFromIipt,
  analyzeWindow,
  buildPageBytes,
  loadQualifiedDataset,
  materializeWindows,
  multipageManifestPath,
  parseArgs,
  planWindowPage,
  qualifyDataset,
  validateMultipageManifest,
  windowOffsets,
  writeManifestExclusive,
} from '../../scripts/ode-multipage.mjs';
import { parseCoverageArchive } from '../../scripts/ode-coverage.mjs';
import { writePageAtomic } from '../../scripts/ode-pages.mjs';

/**
 * INFRASTRUCTURE MULTIPAGE (GAL-A003-11B). Jeu UVVDDR FICTIF de 27 146 produits sur six fenêtres (dernière : 2 146),
 * caches jetables sous le dossier temporaire, aucun réseau, aucune dépendance au cache scientifique privé.
 */
const FREEZE = { mincreationtime: '1900-01-01', maxcreationtime: '2026-09-29' };
const PAGE = 5000;
const NL = String.fromCharCode(10);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const roots: string[] = [];
const scratch = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  roots.push(d);
  return d;
};
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

interface Cfg {
  key: string;
  dir: string;
  ihid: string;
  iid: string;
  pt: string;
  ds: string;
  kind: 'a' | 'l';
  n: number;
  /** Profil de pagination dont les captures respectent les offsets réels (défaut : identique). */
  profile?: 'identique' | 'metadonnees-base-1';
}
/** Jeu fictif d'un AUTRE nom que UVVDDR : le profil y est explicite (`identique`), jamais déduit. */
const CFG: Cfg = {
  key: 'Mercury|MESSENGER|MASCS|UVVDDX',
  dir: 'Mercury_MESSENGER_MASCS_UVVDDX',
  ihid: 'MESSENGER',
  iid: 'MASCS',
  pt: 'UVVDDX',
  ds: 'MESS-E/V/H-MASCS-4-UVVS-DDR-V1.0',
  kind: 'a',
  n: 27146,
};
/** Le vrai jeu pilote : son profil est DÉCLARÉ (métadonnées comptées à partir de 1). */
const REAL_KEY: Cfg = {
  ...CFG,
  key: 'Mercury|MESSENGER|MASCS|UVVDDR',
  dir: 'Mercury_MESSENGER_MASCS_UVVDDR',
  pt: 'UVVDDR',
  profile: 'metadonnees-base-1',
};
/** Offsets réels des requêtes selon le profil du jeu fictif. */
const requestOf = (cfg: Cfg, logical: number) => ({
  coverage: logical,
  metadata:
    cfg.profile === 'metadonnees-base-1' && logical > 0 ? logical + 1 : logical,
});
const DS_DASH = 'MESS-E-V-H-MASCS-4-UVVS-DDR-V1.0';
const OFFSETS = [0, 5000, 10000, 15000, 20000, 25000];
/** Trois produits sans géométrie : leurs indices (jamais dans les shapefiles, sans géométrie dans les métadonnées). */
const EXCLUDED = [5007, 12345, 26000];
const odeId = (i: number) => String(16000000 + i);

// ---------- constructeurs d'archives ----------
const FIELDS = [
  'ODEId',
  'ProductId',
  'DatasetId',
  'UTCstart',
  'UTCend',
  'Target',
];
const WIDTH = 40;
function dbf(rows: string[][]): Buffer {
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
  rows.forEach((v, r) => {
    const base = hl + r * rl;
    out[base] = 0x20;
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
const ring = (i: number): Pt[] => {
  const x = (i % 3000) / 10;
  const y = (i % 1500) / 20 - 37;
  return [
    [x, y],
    [x, y + 0.5],
    [x + 0.5, y + 0.5],
    [x + 0.5, y],
    [x, y],
  ];
};
const line = (i: number): Pt[] => {
  const x = (i % 3000) / 10;
  return [
    [x, 1],
    [x + 0.5, 2],
    [x + 1, 3],
  ];
};
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

/** Un produit de la fenêtre : `i` donne ODEId, ProductId et forme ; chaque champ peut être falsifié. */
interface Prod {
  i: number;
  id?: string;
  pid?: string;
  covPid?: string;
  ds?: string;
  target?: string;
  metaGeo?: boolean;
  inCov?: boolean;
  parts?: number;
  /** Un seul enregistrement portant deux parties (multipartie au sens du .shp). */
  twoPartsInRecord?: boolean;
}
function products(cfg: Cfg, offset: number): Prod[] {
  const size = Math.min(PAGE, cfg.n - offset);
  const out: Prod[] = [];
  for (let k = 0; k < size; k++) {
    const i = offset + k;
    const gone = cfg.kind === 'a' && EXCLUDED.includes(i);
    out.push({ i, metaGeo: !gone, inCov: !gone });
  }
  return out;
}
/** Les deux réponses brutes d'une fenêtre. */
function responses(cfg: Cfg, ps: Prod[]) {
  const pid = (p: Prod) => p.pid ?? `${cfg.pt.toLowerCase()}_${p.i}`;
  const Product = ps.map((p) => ({
    ProductURL: `http://ode/x.aspx?product_id=${pid(p)}&product_idGeo=${p.id ?? odeId(p.i)}`,
    ...(p.metaGeo === false
      ? {}
      : {
          Footprint_geometry:
            cfg.kind === 'a'
              ? 'POLYGON ((1 2, 3 4, 5 6, 1 2))'
              : 'LINESTRING (1 2, 3 4)',
        }),
  }));
  const meta = Buffer.from(
    JSON.stringify({ ODEResults: { Status: 'Success', Products: { Product } } })
  );
  const variants =
    cfg.kind === 'a' ? ['ga', 'c0a', 'c180a'] : ['gl', 'c0l', 'c180l'];
  const entries: Record<string, Buffer> = {};
  for (const v of variants) {
    const rows: string[][] = [];
    const shapes: Buffer[] = [Buffer.alloc(100)];
    let r = 0;
    for (const p of ps) {
      if (p.inCov === false) continue;
      for (let part = 0; part < (p.parts ?? 1); part++) {
        rows.push([
          p.id ?? odeId(p.i),
          p.covPid ?? pid(p),
          p.ds ?? cfg.ds,
          '2011-01-01',
          '2011-01-02',
          p.target ?? 'MERCURY',
        ]);
        const base =
          cfg.kind === 'a' ? ring(p.i + part * 7) : line(p.i + part * 7);
        const two = p.twoPartsInRecord && v.startsWith('g');
        shapes.push(
          ...record(
            cfg.kind === 'a' ? 5 : 3,
            two ? [base.slice(0, 3), base.slice(1)] : [base],
            r++
          )
        );
      }
    }
    entries[`m_${v}.dbf`] = dbf(rows);
    entries[`m_${v}.shp`] = Buffer.concat(shapes);
  }
  entries['m_pad.prj'] = randomBytes(1500);
  return { meta, cov: gzipSync(tarOf(entries)) };
}
function put(
  dir: string,
  file: string,
  buf: Buffer,
  query: object,
  extra: object
) {
  writeFileSync(join(dir, file), buf);
  writeFileSync(join(dir, `${file}.sha256`), `${sha(buf)}  ${file}${NL}`);
  writeFileSync(
    join(dir, `${file}.json`),
    JSON.stringify({
      sha256: sha(buf),
      receivedBytes: buf.length,
      retrievedAt: '2026-11-11T00:00:00.000Z',
      freeze: FREEZE,
      limit: PAGE,
      http: { status: 200 },
      query,
      ...extra,
    })
  );
}
/** Écrit (ou remplace) les deux captures d'une fenêtre. `edit` falsifie les provenances avant écriture. */
function writeWindow(
  cache: string,
  cfg: Cfg,
  offset: number,
  ps: Prod[],
  edit: {
    metaBuf?: Buffer;
    covBuf?: Buffer;
    covExtra?: object;
    metaExtra?: object;
    covQuery?: object;
    metaQuery?: object;
    /** Offset RÉEL de la requête, quand il diffère de celui du profil du jeu. */
    metaOffset?: number;
    covOffset?: number;
  } = {}
) {
  const dir = join(cache, 'diagnostics');
  mkdirSync(dir, { recursive: true });
  const r = responses(cfg, ps);
  const want = requestOf(cfg, offset);
  const mo = edit.metaOffset ?? want.metadata;
  const co = edit.covOffset ?? want.coverage;
  const q = {
    target: 'mercury',
    IHID: cfg.ihid,
    IID: cfg.iid,
    PT: cfg.pt,
    limit: String(PAGE),
    ...FREEZE,
  };
  put(
    dir,
    `meta-${mo}.raw`,
    edit.metaBuf ?? r.meta,
    {
      query: 'product',
      results: 'm',
      output: 'JSON',
      ...q,
      offset: String(mo),
      ...edit.metaQuery,
    },
    { dataset: cfg.key, offset: mo, ...edit.metaExtra }
  );
  put(
    dir,
    `cov-${co}.raw`,
    edit.covBuf ?? r.cov,
    { query: 'coveragetargz', ...q, offset: String(co), ...edit.covQuery },
    { dataset: cfg.key, offset: co, ...edit.covExtra }
  );
}
function makeCache(
  cfg: Cfg,
  mods: Record<number, (ps: Prod[]) => Prod[]> = {}
) {
  const cache = scratch('mp-');
  writeFileSync(
    join(cache, 'counts.json'),
    JSON.stringify({ [cfg.key]: cfg.n })
  );
  writeFileSync(join(cache, 'freeze.json'), JSON.stringify(FREEZE));
  writeFileSync(
    join(cache, 'iipt.json'),
    JSON.stringify({
      ODEResults: {
        IIPTSets: {
          IIPTSet: [cfg.ds, DS_DASH].map((DataSetId) => ({
            ODEMetaDB: 'Mercury',
            IHID: cfg.ihid,
            IID: cfg.iid,
            PT: cfg.pt,
            DataSetId,
          })),
        },
      },
    })
  );
  for (const o of windowOffsets(cfg.n))
    writeWindow(
      cache,
      cfg,
      o,
      (mods[o] ?? ((x: Prod[]) => x))(products(cfg, o))
    );
  return cache;
}
const NOW = new Date('2026-11-11T00:00:00Z');
const clone = (src: string) => {
  const dst = scratch('mp-c-');
  cpSync(src, dst, { recursive: true });
  return dst;
};
const manifestOf = (cache: string, cfg: Cfg = CFG) =>
  qualifyDataset({
    cacheDir: cache,
    key: cfg.key,
    pagination: cfg.profile ?? 'identique',
    now: NOW,
  });
const writeManifest = (cache: string, cfg: Cfg = CFG) =>
  writeManifestExclusive(
    multipageManifestPath(cache, cfg.key),
    JSON.stringify(manifestOf(cache, cfg)) + NL
  );
const error = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('aucune erreur levée');
};
const refusedMp = (fn: () => unknown, re: RegExp) => {
  const e = error(fn);
  expect(e).toBeInstanceOf(MultipageError);
  expect(e.message).toMatch(re);
};
const refusedMat = (fn: () => unknown, re: RegExp) => {
  const e = error(fn);
  expect(e).toBeInstanceOf(MaterializeError);
  expect(e.message).toMatch(re);
};
const pagesOf = (cache: string) => {
  const d = join(cache, 'pages', CFG.dir);
  return existsSync(d) ? readdirSync(d).sort() : [];
};
const pagePath = (cache: string, offset: number) =>
  join(cache, 'pages', CFG.dir, `${offset}.ndjson.gz`);
const freezeCtx = { key: CFG.key, freeze: FREEZE, catalogueCount: CFG.n };
type Manifest = ReturnType<typeof manifestOf>;
const clone2 = (m: Manifest): Manifest => JSON.parse(JSON.stringify(m));

describe(
  'multipage : jeu fictif UVVDDR de 27 146 produits',
  { timeout: 300_000 },
  () => {
    let base: string;
    let withManifest: string;
    let manifest: Manifest;
    beforeAll(() => {
      base = makeCache(CFG);
      withManifest = clone(base);
      manifest = manifestOf(base);
      writeManifest(withManifest);
    });

    describe('1. jeu nominal', () => {
      it('six fenêtres exactes, comptes, déterminisme, statut qualifié', () => {
        expect(windowOffsets(CFG.n)).toEqual(OFFSETS);
        expect(
          manifest.windows.map((w: { offset: number }) => w.offset)
        ).toEqual(OFFSETS);
        expect(
          manifest.windows.map(
            (w: { counts: { catalogued: number } }) => w.counts.catalogued
          )
        ).toEqual([5000, 5000, 5000, 5000, 5000, 2146]);
        expect(manifest.counts).toEqual({
          catalogued: 27146,
          footprints: 27143,
          excluded: 3,
          windows: 6,
        });
        expect(manifest.status).toBe('qualifie');
        expect(JSON.stringify(manifestOf(base))).toBe(JSON.stringify(manifest));
        expect(validateMultipageManifest(manifest, freezeCtx)).toEqual([]);
        const ex = manifest.windows.flatMap(
          (w: { excluded: { odeId: string }[] }) =>
            w.excluded.map((e) => e.odeId)
        );
        expect(ex).toEqual(EXCLUDED.map(odeId));
      });
      it('DatasetId : les deux écritures déclarées par iipt.json sont admises', () => {
        expect(manifest.allowedDatasetIds).toEqual([CFG.ds, DS_DASH].sort());
        const c = clone(base);
        writeWindow(
          c,
          CFG,
          10000,
          products(CFG, 10000).map((p, k) =>
            k % 2 ? { ...p, ds: DS_DASH } : p
          )
        );
        expect(manifestOf(c).windows[2].datasetIds).toEqual(
          [CFG.ds, DS_DASH].sort()
        );
      });
      it('un manifeste historique à une page n’est pas touché : le chemin multipage est distinct', () => {
        expect(multipageManifestPath('/c', CFG.key)).toMatch(
          /\.multipage\.json$/
        );
      });
    });

    describe('qualification : fenêtres et captures', () => {
      it('2. page absente : capture coveragetargz manquante, nommée', () => {
        const c = clone(base);
        for (const s of ['', '.json', '.sha256'])
          rmSync(join(c, 'diagnostics', `cov-15000.raw${s}`));
        refusedMp(
          () => manifestOf(c),
          /@15000 : capture coveragetargz absente/
        );
      });
      it('4. offset doublé : deux captures pour la même fenêtre refusées, jamais choisies', () => {
        const c = clone(base);
        writeWindow(c, CFG, 10000, products(CFG, 10000));
        const d = join(c, 'diagnostics');
        for (const s of ['', '.json', '.sha256'])
          cpSync(join(d, `cov-10000.raw${s}`), join(d, `cov-10000b.raw${s}`));
        refusedMp(
          () => manifestOf(c),
          /plusieurs captures coverage pour .* @10000/
        );
      });
      it('5. ODEId présent dans deux pages : refusé en nommant les deux fenêtres et l’identifiant', () => {
        const c = clone(base);
        writeWindow(
          c,
          CFG,
          5000,
          products(CFG, 5000).map((p, k) =>
            k === 1 ? { ...p, id: odeId(4999), pid: 'uvvddx_4999' } : p
          )
        );
        refusedMp(
          () => manifestOf(c),
          new RegExp(
            `ODEId ${odeId(4999)} présent dans deux fenêtres @0 et @5000`
          )
        );
      });
      it('7. produit absent du shapefile sans preuve d’exclusion : refusé (la géométrie existe dans les métadonnées)', () => {
        const c = clone(base);
        writeWindow(
          c,
          CFG,
          10000,
          products(CFG, 10000).map((p, k) =>
            k === 3 ? { ...p, inCov: false } : p
          )
        );
        refusedMp(
          () => manifestOf(c),
          new RegExp(
            `@10000 : produit ${odeId(10003)} : géométrie dans les métadonnées mais absent du shapefile \\(exclusion injustifiée\\)`
          )
        );
      });
      it('9. produit exclu réapparaissant ailleurs : refusé, les deux fenêtres nommées', () => {
        const c = clone(base);
        writeWindow(
          c,
          CFG,
          20000,
          products(CFG, 20000).map((p, k) =>
            k === 0 ? { i: 5007, metaGeo: true, inCov: true } : p
          )
        );
        refusedMp(
          () => manifestOf(c),
          new RegExp(
            `ODEId ${odeId(5007)} : exclu @5000 mais géolocalisé @20000`
          )
        );
      });
      it('10. métadonnées et coverage désalignées : correspondance non démontrée, NO-GO sans heuristique', () => {
        const c = clone(base);
        // Les métadonnées de la fenêtre 15000 servent à la fenêtre 10000 (même provenance d'offset annoncée).
        writeWindow(c, CFG, 10000, products(CFG, 10000), {
          metaBuf: responses(CFG, products(CFG, 15000)).meta,
        });
        refusedMp(
          () => manifestOf(c),
          /@10000 : \d+ produit\(s\) du shapefile absent\(s\) du catalogue de la fenêtre \(fenêtres désalignées \?\)/
        );
      });
      it('11. réponse HTTP 200 partielle : distinguée d’une réponse complète, deux manières', () => {
        let c = clone(base);
        const partial = products(CFG, 10000).slice(0, 4990);
        writeWindow(c, CFG, 10000, products(CFG, 10000), {
          metaBuf: responses(CFG, partial).meta,
        });
        refusedMp(
          () => manifestOf(c),
          /@10000 : réponse PARTIELLE des métadonnées : 4990 produits pour 5000 attendus/
        );
        c = clone(base);
        writeWindow(
          c,
          CFG,
          10000,
          products(CFG, 10000).map((p, k) =>
            k >= 4990 ? { ...p, inCov: false } : p
          )
        );
        refusedMp(() => manifestOf(c), /exclusion injustifiée/);
      });
      it('12. ProductId contradictoires : entre métadonnées et shapefile, et entre fenêtres', () => {
        const c = clone(base);
        writeWindow(
          c,
          CFG,
          5000,
          products(CFG, 5000).map((p, k) =>
            k === 9 ? { ...p, covPid: 'autre' } : p
          )
        );
        refusedMp(
          () => manifestOf(c),
          new RegExp(
            `produit ${odeId(5009)} : ProductId autre \\(shapefile\\) différent de uvvddx_5009`
          )
        );
        const m = clone2(manifest);
        m.windows[3].productIds[0] = 'x';
        m.windows[4].footprintIds[0] = m.windows[3].footprintIds[0];
        const e = validateMultipageManifest(m, freezeCtx).join(NL);
        expect(e).toMatch(/ProductId contradictoires/);
      });
      it('13. DatasetId non autorisé : refusé avec le produit et la valeur', () => {
        const c = clone(base);
        writeWindow(
          c,
          CFG,
          20000,
          products(CFG, 20000).map((p, k) =>
            k === 5 ? { ...p, ds: 'AUTRE-JEU' } : p
          )
        );
        refusedMp(
          () => manifestOf(c),
          new RegExp(
            `@20000 : produit ${odeId(20005)} : DatasetId "AUTRE-JEU" non autorisé`
          )
        );
      });
      it('13b. cible : un produit d’une autre cible est refusé', () => {
        const c = clone(base);
        writeWindow(
          c,
          CFG,
          0,
          products(CFG, 0).map((p, k) =>
            k === 2 ? { ...p, target: 'VENUS' } : p
          )
        );
        refusedMp(() => manifestOf(c), /cible VENUS \(attendu Mercury\)/);
      });
      it('14. géométrie multipartie : surfaces admises (anneaux regroupés par ODEId) ; traces refusées', () => {
        const c = clone(base);
        writeWindow(
          c,
          CFG,
          0,
          products(CFG, 0).map((p, k) => (k === 4 ? { ...p, parts: 2 } : p))
        );
        const m = manifestOf(c);
        expect(m.windows[0].geometry.shapes).toBe(5001);
        expect(m.windows[0].counts.footprints).toBe(5000);
        const L: Cfg = {
          ...CFG,
          key: 'Mercury|MESSENGER|MLA|scirdrv1',
          dir: 'Mercury_MESSENGER_MLA_scirdrv1',
          iid: 'MLA',
          pt: 'scirdrv1',
          ds: 'MESS-E/V/H-MLA-3-CDR-V1',
          kind: 'l',
          n: 7,
        };
        const l = makeCache(L, {
          0: (ps) =>
            ps.map((p, k) => (k === 3 ? { ...p, twoPartsInRecord: true } : p)),
        });
        refusedMp(
          () => manifestOf(l, L),
          /lignes dans les produits pour .* enregistrements _gl|variante c0l|multipartie/
        );
        expect(manifestOf(makeCache(L), L).geometryKind).toBe('l');
      });
      it('15. archive tronquée : refusée même si sa provenance décrit fidèlement les octets reçus', () => {
        const c = clone(base);
        const full = responses(CFG, products(CFG, 5000)).cov;
        writeWindow(c, CFG, 5000, products(CFG, 5000), {
          covBuf: full.subarray(0, Math.floor(full.length / 2)),
        });
        refusedMp(
          () => manifestOf(c),
          /@5000 : archive coveragetargz illisible ou tronquée|sans shapefile/
        );
      });
      it('22a. gel ou provenance falsifiés : refus nommé', () => {
        let c = clone(base);
        writeWindow(c, CFG, 15000, products(CFG, 15000), {
          covExtra: {
            freeze: {
              mincreationtime: '1900-01-01',
              maxcreationtime: '2026-09-30',
            },
          },
        });
        refusedMp(
          () => manifestOf(c),
          /@15000 coveragetargz : gel de la provenance différent/
        );
        c = clone(base);
        writeWindow(c, CFG, 15000, products(CFG, 15000), {
          covExtra: { offset: 20000 },
        });
        refusedMp(
          () => manifestOf(c),
          /plusieurs captures coverage pour .* @20000/
        );
        c = clone(base);
        writeFileSync(
          join(c, 'diagnostics', 'meta-5000.raw.sha256'),
          `${'0'.repeat(64)}  x${NL}`
        );
        refusedMp(
          () => manifestOf(c),
          /@5000 métadonnées : somme \.sha256 différente du contenu/
        );
        c = clone(base);
        writeWindow(c, CFG, 5000, products(CFG, 5000), {
          metaExtra: { http: { status: 206 } },
        });
        refusedMp(() => manifestOf(c), /statut HTTP 206/);
      });
    });

    describe('validation globale du jeu (manifeste)', () => {
      it('3. offset manquant et surnuméraire', () => {
        const m = clone2(manifest);
        m.windows.splice(2, 1);
        expect(validateMultipageManifest(m, freezeCtx).join(NL)).toMatch(
          /fenêtre @10000 manquante/
        );
        const x = clone2(manifest);
        x.windows[5].offset = 30000;
        expect(validateMultipageManifest(x, freezeCtx).join(NL)).toMatch(
          /fenêtre @25000 manquante[\s\S]*fenêtre @30000 surnuméraire/
        );
      });
      it('4b. offset répété dans le manifeste', () => {
        const m = clone2(manifest);
        m.windows[3] = clone2({ ...m, windows: [m.windows[2]] }).windows[0];
        expect(validateMultipageManifest(m, freezeCtx).join(NL)).toMatch(
          /fenêtre @15000 manquante[\s\S]*fenêtre @10000 répétée 2 fois/
        );
      });
      it('6. trou dans le catalogue : perte non justifiée', () => {
        const m = clone2(manifest);
        m.windows[1].footprintIds.pop();
        m.windows[1].productIds.pop();
        const e = validateMultipageManifest(m, freezeCtx).join(NL);
        expect(e).toMatch(/@5000 : comptes annoncés/);
        expect(e).toMatch(/perte non justifiée/);
        m.windows[1].counts.footprints -= 1;
        expect(validateMultipageManifest(m, freezeCtx).join(NL)).toMatch(
          /4999 empreintes \+ 1 exclus ≠ 5000 catalogués \(perte non justifiée\)|empreintes \+ \d+ exclusions démontrées ≠ 27146/
        );
      });
      it('8. produit exclu sans justification : preuve absente ou insuffisante', () => {
        for (const mutate of [
          (e: Record<string, unknown>) => delete e.inShapefiles,
          (e: Record<string, unknown>) =>
            (e.inShapefiles = { ga: false, c0a: false }),
          (e: Record<string, unknown>) =>
            (e.inShapefiles = { ga: true, c0a: false, c180a: false }),
          (e: Record<string, unknown>) => (e.metadataGeometry = 'presente'),
          (e: Record<string, unknown>) => (e.reason = 'inconnu'),
        ]) {
          const m = clone2(manifest);
          mutate(
            m.windows[1].excluded[0] as unknown as Record<string, unknown>
          );
          expect(validateMultipageManifest(m, freezeCtx).join(NL)).toMatch(
            new RegExp(`@5000 : exclusion ${odeId(5007)} :`)
          );
        }
      });
      it('5b. ODEId dupliqué entre fenêtres, et exclu ici / géolocalisé là, au niveau du manifeste', () => {
        const m = clone2(manifest);
        m.windows[0].footprintIds[0] = m.windows[1].footprintIds[0];
        m.windows[0].productIds[0] = m.windows[1].productIds[0];
        expect(validateMultipageManifest(m, freezeCtx).join(NL)).toMatch(
          new RegExp(
            `ODEId ${m.windows[1].footprintIds[0]} présent dans deux fenêtres @0 et @5000`
          )
        );
        const x = clone2(manifest);
        x.windows[2].footprintIds[0] = x.windows[1].excluded[0].odeId;
        x.windows[2].productIds[0] = x.windows[1].excluded[0].productId;
        expect(validateMultipageManifest(x, freezeCtx).join(NL)).toMatch(
          /exclu @5000 mais géolocalisé @10000/
        );
      });
      it('comptes : somme des fenêtres, compte gelé, gel, version, statut, même capture pour deux fenêtres', () => {
        const m = clone2(manifest);
        expect(
          validateMultipageManifest(m, {
            ...freezeCtx,
            catalogueCount: 27147,
          }).join(NL)
        ).toMatch(
          /catalogue du manifeste 27146 différent du compte gelé 27147/
        );
        expect(
          validateMultipageManifest(m, {
            ...freezeCtx,
            freeze: { ...FREEZE, maxcreationtime: '2026-10-01' },
          }).join(NL)
        ).toMatch(/gel du manifeste différent/);
        m.status = 'brouillon';
        m.version = 1;
        m.counts.excluded = 9;
        m.windows[4].sources.coverage.sha256 =
          m.windows[3].sources.coverage.sha256;
        const e = validateMultipageManifest(m, freezeCtx).join(NL);
        expect(e).toMatch(/statut brouillon/);
        expect(e).toMatch(/version 1 \(attendu 2\)/);
        expect(e).toMatch(/comptes globaux annoncés/);
        expect(e).toMatch(/@20000 : même capture coveragetargz que @15000/);
      });
    });

    describe('matérialisation par offset', () => {
      it('mode sec par défaut : rien n’est écrit ; publication de toutes les fenêtres, octets identiques au pipeline normal', () => {
        const c = clone(withManifest);
        const before = readdirSync(c).sort();
        const dry = materializeWindows({
          cacheDir: c,
          key: CFG.key,
          offsets: 'all',
        });
        expect(dry.mode).toBe('sec');
        expect(dry.report.map((r: { status: string }) => r.status)).toEqual(
          Array(6).fill('sec')
        );
        expect(readdirSync(c).sort()).toEqual(before);
        expect(pagesOf(c)).toEqual([]);
        const done = materializeWindows({
          cacheDir: c,
          key: CFG.key,
          offsets: 'all',
          write: true,
        });
        expect(done.report.map((r: { status: string }) => r.status)).toEqual(
          Array(6).fill('publiee')
        );
        expect(pagesOf(c)).toEqual(OFFSETS.map((o) => `${o}.ndjson.gz`).sort());
        OFFSETS.forEach((o, k) => {
          const page = readFileSync(pagePath(c, o));
          expect(sha(page)).toBe(manifest.windows[k].page.sha256);
          expect(page.length).toBe(manifest.windows[k].page.bytes);
          expect(statSync(pagePath(c, o)).nlink).toBe(1);
          // Pipeline normal : mêmes produits, writePageAtomic.
          const { products: prods } = parseCoverageArchive(
            readFileSync(join(c, 'diagnostics', `cov-${o}.raw`)),
            CFG.key,
            o
          );
          const ref = scratch('mp-ref-');
          writePageAtomic(join(ref, 'p.gz'), prods, {
            expected: manifest.windows[k].counts.footprints,
          });
          expect(readFileSync(join(ref, 'p.gz')).equals(page)).toBe(true);
          expect(buildPageBytes(prods).equals(page)).toBe(true);
        });
        expect(existsSync(join(c, 'collect.lock'))).toBe(false);
      });
      it('un seul offset explicite : les autres ne sont pas créés', () => {
        const c = clone(withManifest);
        materializeWindows({
          cacheDir: c,
          key: CFG.key,
          offsets: [10000],
          write: true,
        });
        expect(pagesOf(c)).toEqual(['10000.ndjson.gz']);
        refusedMat(
          () =>
            materializeWindows({
              cacheDir: c,
              key: CFG.key,
              offsets: [12345],
              write: true,
            }),
          /offset 12345 absent du manifeste/
        );
      });
      it('17-18. interruption après plusieurs pages puis reprise sans remplacement', () => {
        const c = clone(withManifest);
        let n = 0;
        const e = error(() =>
          materializeWindows({
            cacheDir: c,
            key: CFG.key,
            offsets: 'all',
            write: true,
            fs: {
              linkSync: (a: string, b: string) => {
                if (++n === 3)
                  throw Object.assign(new Error('coupure'), { code: 'EIO' });
                linkSync(a, b);
              },
            },
          })
        ) as Error & { report: { offset: number; status: string }[] };
        expect(e.message).toMatch(/lien dur impossible \(EIO\)/);
        expect(e.report.map((r) => r.offset)).toEqual([0, 5000]);
        expect(pagesOf(c)).toEqual(['0.ndjson.gz', '5000.ndjson.gz']);
        const ino = [0, 5000].map(
          (o) => statSync(pagePath(c, o), { bigint: true }).ino
        );
        const again = materializeWindows({
          cacheDir: c,
          key: CFG.key,
          offsets: 'all',
          write: true,
        });
        expect(again.report.map((r: { status: string }) => r.status)).toEqual([
          'deja-publiee',
          'deja-publiee',
          'publiee',
          'publiee',
          'publiee',
          'publiee',
        ]);
        expect(
          [0, 5000].map((o) => statSync(pagePath(c, o), { bigint: true }).ino)
        ).toEqual(ino);
        expect(pagesOf(c)).toHaveLength(6);
      });
      it('19. concurrence : un rival crée la page entre le plan et le lien, il reste intact', () => {
        const c = clone(withManifest);
        const rival = Buffer.from('page d’un autre processus');
        const e = error(() =>
          materializeWindows({
            cacheDir: c,
            key: CFG.key,
            offsets: [5000],
            write: true,
            fs: {
              linkSync: (a: string, b: string) => {
                writeFileSync(b, rival);
                linkSync(a, b);
              },
            },
          })
        );
        expect(e.message).toMatch(
          /collision : la page cible existe déjà, laissée intacte/
        );
        expect(readFileSync(pagePath(c, 5000)).equals(rival)).toBe(true);
        expect(
          readdirSync(join(c, 'pages', CFG.dir)).filter((f) =>
            f.endsWith('.tmp')
          )
        ).toEqual([]);
      });
      it('16 et 20. page existante divergente : arrêt, jamais corrigée ; gzip valide mais contenu altéré', () => {
        const c = clone(withManifest);
        materializeWindows({
          cacheDir: c,
          key: CFG.key,
          offsets: [0],
          write: true,
        });
        const good = readFileSync(pagePath(c, 0));
        // Contenu altéré mais gzip et structure valides (un ProductId modifié).
        const text = require_gunzip(good).replace('uvvddx_1"', 'uvvddx_X"');
        rmSync(pagePath(c, 0));
        writeFileSync(pagePath(c, 0), gzipSync(text));
        refusedMat(
          () =>
            materializeWindows({
              cacheDir: c,
              key: CFG.key,
              offsets: [0],
              write: true,
            }),
          /page existante DIVERGENTE du manifeste/
        );
        expect(readFileSync(pagePath(c, 0)).equals(good)).toBe(false);
        // Fichier existant non gzip.
        writeFileSync(pagePath(c, 0), 'n’importe quoi');
        refusedMat(
          () =>
            materializeWindows({
              cacheDir: c,
              key: CFG.key,
              offsets: [0, 5000],
              write: true,
            }),
          /page existante invalide/
        );
        expect(readFileSync(pagePath(c, 0), 'utf8')).toBe('n’importe quoi');
        expect(existsSync(pagePath(c, 5000))).toBe(false);
      });
      it('état partiel : temporaire ou fichier inattendu dans le dossier du jeu = arrêt, rien n’est retiré', () => {
        const c = clone(withManifest);
        mkdirSync(join(c, 'pages', CFG.dir), { recursive: true });
        writeFileSync(
          join(c, 'pages', CFG.dir, '0.ndjson.gz.123.tmp'),
          'reste'
        );
        refusedMat(
          () =>
            materializeWindows({
              cacheDir: c,
              key: CFG.key,
              offsets: [0],
              write: true,
            }),
          /ÉTAT PARTIEL/
        );
        rmSync(join(c, 'pages', CFG.dir, '0.ndjson.gz.123.tmp'));
        writeFileSync(join(c, 'pages', CFG.dir, 'etranger.txt'), 'x');
        refusedMat(
          () =>
            materializeWindows({
              cacheDir: c,
              key: CFG.key,
              offsets: [0],
              write: true,
            }),
          /fichier inattendu etranger\.txt/
        );
        expect(readdirSync(join(c, 'pages', CFG.dir))).toEqual([
          'etranger.txt',
        ]);
      });
      it('21. erreurs de disque et de suppression : erreur d’origine conservée, aucune page, état annoncé', () => {
        let c = clone(withManifest);
        let e = error(() =>
          materializeWindows({
            cacheDir: c,
            key: CFG.key,
            offsets: [0],
            write: true,
            fs: {
              writeSync: () => {
                throw Object.assign(new Error('disque plein'), {
                  code: 'ENOSPC',
                });
              },
            },
          })
        );
        expect(e.message).toMatch(/disque plein/);
        expect(pagesOf(c).filter((f) => !f.endsWith('.tmp'))).toEqual([]);
        c = clone(withManifest);
        e = error(() =>
          materializeWindows({
            cacheDir: c,
            key: CFG.key,
            offsets: [0],
            write: true,
            fs: {
              rmSync: (f: string, o?: { force?: boolean }) => {
                if (String(f).endsWith('.tmp'))
                  throw Object.assign(new Error('verrou'), { code: 'EBUSY' });
                rmSync(f, o);
              },
            },
          })
        );
        expect(e.message).toMatch(/à retirer à la main/);
        expect(existsSync(pagePath(c, 0))).toBe(false);
      });
      it('22b. falsifications après qualification : capture altérée, gel du cache, manifeste altéré', () => {
        let c = clone(withManifest);
        writeFileSync(
          join(c, 'diagnostics', 'cov-5000.raw'),
          Buffer.concat([
            readFileSync(join(c, 'diagnostics', 'cov-5000.raw')),
            Buffer.from('x'),
          ])
        );
        refusedMat(
          () =>
            materializeWindows({
              cacheDir: c,
              key: CFG.key,
              offsets: [0],
              write: true,
            }),
          /@5000 source coverage : \d+ octets pour \d+/
        );
        expect(pagesOf(c)).toEqual([]);
        c = clone(withManifest);
        writeFileSync(
          join(c, 'freeze.json'),
          JSON.stringify({ ...FREEZE, maxcreationtime: '2026-10-01' })
        );
        refusedMat(
          () => loadQualifiedDataset({ cacheDir: c, key: CFG.key }),
          /freeze\.json différent du gel de référence/
        );
        c = clone(withManifest);
        const file = multipageManifestPath(c, CFG.key);
        const m = JSON.parse(readFileSync(file, 'utf8'));
        m.windows[2].page.sha256 = 'a'.repeat(64);
        writeFileSync(file, JSON.stringify(m));
        refusedMat(
          () =>
            materializeWindows({
              cacheDir: c,
              key: CFG.key,
              offsets: [10000],
              write: true,
            }),
          /requalification.*@10000 page/
        );
        m.status = 'brouillon';
        writeFileSync(file, JSON.stringify(m));
        refusedMat(
          () =>
            materializeWindows({
              cacheDir: c,
              key: CFG.key,
              offsets: [0],
              write: true,
            }),
          /statut brouillon/
        );
        expect(pagesOf(c)).toEqual([]);
      });
      it('aucun manifeste : refus ; verrou de collecte : refus', () => {
        refusedMat(
          () =>
            materializeWindows({
              cacheDir: clone(base),
              key: CFG.key,
              offsets: [0],
            }),
          /aucun manifeste multipage/
        );
        const c = clone(withManifest);
        writeFileSync(join(c, 'collect.lock'), '1');
        refusedMat(
          () => materializeWindows({ cacheDir: c, key: CFG.key, offsets: [0] }),
          /collect\.lock/
        );
      });
      it('planWindowPage : une page publiée identique est reconnue sans écriture', () => {
        const c = clone(withManifest);
        materializeWindows({
          cacheDir: c,
          key: CFG.key,
          offsets: [25000],
          write: true,
        });
        const ctx = loadQualifiedDataset({ cacheDir: c, key: CFG.key });
        expect(planWindowPage(ctx, 25000).status).toBe('deja-publiee');
        expect(planWindowPage(ctx, 0).status).toBe('a-publier');
      });
    });

    describe('écriture exclusive du manifeste et ligne de commande', () => {
      it('jamais d’écrasement ; lien refusé sans repli par copie ; nettoyage sans masquage', () => {
        const c = clone(base);
        const f = multipageManifestPath(c, CFG.key);
        writeManifestExclusive(f, 'a');
        expect(() => writeManifestExclusive(f, 'b')).toThrow(
          /existe déjà.*jamais écrasé/
        );
        expect(readFileSync(f, 'utf8')).toBe('a');
        const g = join(c, 'reconciliation', 'autre.json');
        let copies = 0;
        expect(() =>
          writeManifestExclusive(g, 'x', {
            fs: {
              linkSync: () => {
                throw Object.assign(new Error('x'), { code: 'EPERM' });
              },
              copyFileSync: () => {
                copies++;
              },
            },
          })
        ).toThrow(/aucun repli par copie/);
        expect(copies).toBe(0);
        expect(existsSync(g)).toBe(false);
        const e = error(() =>
          writeManifestExclusive(g, 'x', {
            fs: {
              linkSync: () => {
                throw Object.assign(new Error('x'), { code: 'EPERM' });
              },
              rmSync: () => {
                throw Object.assign(new Error('verrou'), { code: 'EBUSY' });
              },
            },
          })
        );
        expect(e.message).toMatch(/^lien dur impossible/);
        expect(e.message).toMatch(/à retirer à la main/);
      });
      it('arguments : cache et jeu obligatoires, offset explicite, options inconnues refusées', () => {
        expect(
          parseArgs([
            'materialize',
            '--cache-dir',
            'C:/x',
            '--dataset',
            CFG.key,
            '--offset',
            'all',
          ])
        ).toMatchObject({ offset: 'all', write: false });
        expect(() =>
          parseArgs([
            'materialize',
            '--cache-dir',
            'C:/x',
            '--dataset',
            CFG.key,
          ])
        ).toThrow(/--offset est obligatoire/);
        expect(() =>
          parseArgs([
            'materialize',
            '--cache-dir',
            'C:/x',
            '--dataset',
            CFG.key,
            '--offset',
            '-1',
          ])
        ).toThrow(/entier positif/);
        expect(() => parseArgs(['build', '--dataset', CFG.key])).toThrow(
          /--cache-dir est obligatoire/
        );
        expect(() =>
          parseArgs([
            'build',
            '--cache-dir',
            'C:/x',
            '--dataset',
            CFG.key,
            '--force',
          ])
        ).toThrow(/option inconnue/);
        expect(() =>
          parseArgs([
            'build',
            '--cache-dir',
            'C:/x',
            '--dataset',
            CFG.key,
            '--offset',
            '0',
          ])
        ).toThrow(/ne s’applique qu’à materialize/);
      });
    });
  }
);

/**
 * CONTRAT D'OFFSET (GAL-A003-11C-04). Mesuré sur le vrai UVVDDR : `coveragetargz` à l'offset N et `results=m` à
 * l'offset N + 1 (N > 0) désignent la même fenêtre. Le jeu fictif REAL_KEY reprend le nom du jeu pilote, dont le
 * profil est déclaré ; les autres jeux fictifs exigent un profil explicite.
 */
describe(
  'multipage : contrat d’offset explicite (profil metadonnees-base-1)',
  { timeout: 300_000 },
  () => {
    const SH = REAL_KEY;
    let shifted: string;
    let manifest: Manifest;
    let small: string;
    const metaFiles = (c: string) =>
      readdirSync(join(c, 'diagnostics')).filter((f) =>
        /^meta-\d+\.raw$/.test(f)
      );
    beforeAll(() => {
      shifted = makeCache(SH);
      manifest = manifestOf(shifted, SH);
      small = makeCache({ ...CFG, n: 6000 });
    });
    const ctx = { ...freezeCtx, key: SH.key };
    type Win = {
      offset: number;
      counts: { catalogued: number; footprints: number; excluded: number };
      sources: Record<
        'metadata' | 'coverage',
        { requestOffset: number; file: string }
      >;
      catalogueRange: { first: string; last: string };
    };
    const wins = (m: Manifest) => m.windows as unknown as Win[];

    it('2. offsets réels : coverage 0, 5000, … ; métadonnées 0, 5001, 10001, 15001, 20001, 25001', () => {
      expect(manifest.version).toBe(2);
      expect(manifest.pagination).toEqual({ profile: 'metadonnees-base-1' });
      expect(wins(manifest).map((w) => w.offset)).toEqual(OFFSETS);
      expect(
        wins(manifest).map((w) => w.sources.coverage.requestOffset)
      ).toEqual(OFFSETS);
      expect(
        wins(manifest).map((w) => w.sources.metadata.requestOffset)
      ).toEqual([0, 5001, 10001, 15001, 20001, 25001]);
      expect(wins(manifest).map((w) => w.sources.metadata.file)).toEqual(
        [0, 5001, 10001, 15001, 20001, 25001].map((o) => `meta-${o}.raw`)
      );
    });
    it('3 et 10. les six fenêtres sont qualifiées ; la dernière compte 2 146 produits ; comptes exacts', () => {
      expect(validateMultipageManifest(manifest, ctx)).toEqual([]);
      expect(wins(manifest).map((w) => w.counts.catalogued)).toEqual([
        5000, 5000, 5000, 5000, 5000, 2146,
      ]);
      expect(manifest.counts).toEqual({
        catalogued: 27146,
        footprints: 27143,
        excluded: 3,
        windows: 6,
      });
      expect(wins(manifest)[5].catalogueRange).toEqual({
        first: odeId(25000),
        last: odeId(27145),
      });
    });
    it('1. offsets identiques : profil explicite, jamais déduit pour un autre jeu', () => {
      const cfg: Cfg = { ...CFG, n: 6000 };
      const m = manifestOf(small, cfg);
      expect(m.pagination).toEqual({ profile: 'identique' });
      expect(
        wins(m).every((w) => w.sources.metadata.requestOffset === w.offset)
      ).toBe(true);
      refusedMp(
        () => qualifyDataset({ cacheDir: small, key: CFG.key, now: NOW }),
        /profil de pagination explicite exigé/
      );
      refusedMp(
        () =>
          qualifyDataset({
            cacheDir: small,
            key: CFG.key,
            pagination: 'inconnu',
            now: NOW,
          }),
        /profil de pagination inconnu/
      );
    });
    it('le profil déclaré du jeu pilote ne peut pas être remplacé par « identique »', () => {
      refusedMp(
        () =>
          qualifyDataset({
            cacheDir: shifted,
            key: SH.key,
            pagination: 'identique',
            now: NOW,
          }),
        /profil identique refusé, le jeu est déclaré en metadonnees-base-1/
      );
      expect(
        JSON.stringify(
          qualifyDataset({ cacheDir: shifted, key: SH.key, now: NOW })
        )
      ).toBe(JSON.stringify(manifest));
    });
    it('5. capture diagnostique @5000 : conservée, jamais sélectionnée, jamais modifiée', () => {
      const c = clone(shifted);
      writeWindow(c, SH, 5000, products(SH, 5000), { metaOffset: 5000 });
      // La capture couverture légitime reste celle d'origine (les octets de remplissage de l'archive sont aléatoires).
      for (const x of ['', '.json', '.sha256'])
        cpSync(
          join(shifted, 'diagnostics', `cov-5000.raw${x}`),
          join(c, 'diagnostics', `cov-5000.raw${x}`)
        );
      const before = sha(readFileSync(join(c, 'diagnostics', 'meta-5000.raw')));
      expect(metaFiles(c)).toContain('meta-5000.raw');
      const diagnostics: {
        file: string;
        kind: string;
        requestOffset: number;
        reason: string;
      }[] = [];
      const m = qualifyDataset({
        cacheDir: c,
        key: SH.key,
        now: NOW,
        diagnostics,
      });
      expect(JSON.stringify(m)).toBe(JSON.stringify(manifest));
      expect(wins(m)[1].sources.metadata.file).toBe('meta-5001.raw');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].file).toBe('meta-5000.raw');
      expect(diagnostics[0].reason).toMatch(/exige 5001/);
      expect(sha(readFileSync(join(c, 'diagnostics', 'meta-5000.raw')))).toBe(
        before
      );
    });
    it('5b. seule la capture @5000 présente : refus, la fenêtre @5000 reste sans métadonnées', () => {
      const c = clone(shifted);
      for (const s of ['', '.json', '.sha256'])
        rmSync(join(c, 'diagnostics', `meta-5001.raw${s}`));
      writeWindow(c, SH, 5000, products(SH, 5000), { metaOffset: 5000 });
      refusedMp(
        () => manifestOf(c, SH),
        /@5000 : capture de métadonnées absente \(requête offset=5001\)/
      );
    });
    it('6. provenance réécrite à 5001 sur le contenu demandé à 5000 : refus par désalignement', () => {
      const c = clone(shifted);
      // Contenu réel d'une requête offset=5000 : le dernier produit de la fenêtre précédente en tête.
      const real = [
        ...products(SH, 4999).slice(0, 1),
        ...products(SH, 5000).slice(0, -1),
      ];
      writeWindow(c, SH, 5000, real);
      refusedMp(() => manifestOf(c, SH), /désalignées|deux fenêtres/);
    });
    it('7. offset de requête absent (paramètre ou champ de capture) : refus', () => {
      const a = clone(shifted);
      writeWindow(a, SH, 10000, products(SH, 10000), {
        metaQuery: { offset: undefined },
      });
      refusedMp(
        () => manifestOf(a, SH),
        /paramètre offset=undefined \(attendu 10001\)/
      );
      const b = clone(shifted);
      writeWindow(b, SH, 10000, products(SH, 10000), {
        metaExtra: { offset: undefined },
      });
      refusedMp(
        () => manifestOf(b, SH),
        /@10000 : capture de métadonnées absente \(requête offset=10001\)/
      );
      // Capture lue par son emplacement, mais dont la provenance contredit ensuite l'offset exigé : refus d'identité.
      const dir = join(shifted, 'diagnostics');
      const rd = (file: string) => ({
        file,
        buffer: readFileSync(join(dir, file)),
        provenance: JSON.parse(readFileSync(join(dir, `${file}.json`), 'utf8')),
        sidecarSha256: sha(readFileSync(join(dir, file))),
      });
      const meta = rd('meta-10001.raw');
      const cov = rd('cov-10000.raw');
      const analyse = (metadata: object) =>
        analyzeWindow({
          key: SH.key,
          freeze: FREEZE,
          catalogueCount: SH.n,
          offset: 10000,
          pagination: 'metadonnees-base-1',
          metadata,
          coverage: cov,
          allowedDatasetIds: [SH.ds],
        }).problems.join(NL);
      expect(analyse(meta)).toBe('');
      expect(
        analyse({
          ...meta,
          provenance: { ...meta.provenance, offset: undefined },
        })
      ).toMatch(/offset undefined \(attendu 10001\)/);
      expect(
        analyse({
          ...meta,
          provenance: { ...meta.provenance, offset: 10000 },
        })
      ).toMatch(/offset 10000 \(attendu 10001\)/);
    });
    it('8. décalage de deux produits : refus (provenance 5002, puis contenu décalé)', () => {
      const a = clone(shifted);
      writeWindow(a, SH, 5000, products(SH, 5000), {
        metaExtra: { offset: 5002 },
        metaQuery: { offset: '5002' },
      });
      refusedMp(
        () => manifestOf(a, SH),
        /@5000 : capture de métadonnées absente \(requête offset=5001\)/
      );
      const b = clone(shifted);
      writeWindow(b, SH, 5000, [
        ...products(SH, 4998).slice(0, 2),
        ...products(SH, 5000).slice(0, -2),
      ]);
      refusedMp(() => manifestOf(b, SH), /désalignées|deux fenêtres/);
    });
    it('9. couverture et métadonnées désalignées : refus', () => {
      const c = clone(shifted);
      const other = responses(SH, products(SH, 15000));
      writeWindow(c, SH, 10000, products(SH, 10000), { covBuf: other.cov });
      refusedMp(() => manifestOf(c, SH), /désalignées/);
    });
    it('4, 11 et 12. produit commun à deux fenêtres : refus (empreinte, exclu, ProductId contradictoires)', () => {
      const c = clone(shifted);
      const last0 = products(SH, 0).at(-1)!;
      writeWindow(c, SH, 5000, [last0, ...products(SH, 5000).slice(0, -1)]);
      refusedMp(
        () => manifestOf(c, SH),
        new RegExp(
          `ODEId ${odeId(4999)} présent dans deux fenêtres @0 et @5000`
        )
      );
      const e = clone(shifted);
      const gone = { ...last0, metaGeo: false, inCov: false };
      writeWindow(e, SH, 0, [...products(SH, 0).slice(0, -1), gone]);
      writeWindow(e, SH, 5000, [gone, ...products(SH, 5000).slice(0, -1)]);
      refusedMp(
        () => manifestOf(e, SH),
        new RegExp(
          `ODEId ${odeId(4999)} présent dans deux fenêtres @0 et @5000`
        )
      );
      const p = clone(shifted);
      writeWindow(p, SH, 5000, [
        { ...last0, pid: 'autre' },
        ...products(SH, 5000).slice(0, -1),
      ]);
      refusedMp(() => manifestOf(p, SH), /ProductId contradictoires/);
    });
    it('13. profil modifié dans un manifeste existant : refus à la requalification', () => {
      const c = clone(shifted);
      writeManifest(c, SH);
      const file = multipageManifestPath(c, SH.key);
      const good = readFileSync(file, 'utf8');
      const edit = (f: (m: Record<string, unknown>) => void) => {
        const m = JSON.parse(good);
        f(m);
        writeFileSync(file, JSON.stringify(m) + NL);
      };
      expect(() =>
        loadQualifiedDataset({ cacheDir: c, key: SH.key })
      ).not.toThrow();
      edit((m) => {
        m.pagination = { profile: 'identique' };
      });
      refusedMat(
        () => loadQualifiedDataset({ cacheDir: c, key: SH.key }),
        /profil de pagination identique refusé/
      );
      edit((m) => {
        m.pagination = { profile: 'x' };
      });
      refusedMat(
        () => loadQualifiedDataset({ cacheDir: c, key: SH.key }),
        /profil de pagination "x" absent ou inconnu/
      );
      edit((m) => {
        delete m.pagination;
        m.version = 1;
      });
      refusedMat(
        () => loadQualifiedDataset({ cacheDir: c, key: SH.key }),
        /version 1 \(attendu 2\)/
      );
      edit((m) => {
        (m.windows as Win[])[1].sources.metadata.requestOffset = 5000;
      });
      refusedMat(
        () => loadQualifiedDataset({ cacheDir: c, key: SH.key }),
        /source metadata demandée à offset 5000 \(profil metadonnees-base-1 : 5001\)/
      );
      writeFileSync(file, good);
      expect(() =>
        loadQualifiedDataset({ cacheDir: c, key: SH.key })
      ).not.toThrow();
    });
    it('14. publication exclusive et reprise : six pages, contenu et empreintes identiques au manifeste', () => {
      const c = clone(shifted);
      writeManifest(c, SH);
      const first = materializeWindows({
        cacheDir: c,
        key: SH.key,
        offsets: [5000],
        write: true,
      });
      expect(first.report.map((r) => r.status)).toEqual(['publiee']);
      const all = materializeWindows({
        cacheDir: c,
        key: SH.key,
        offsets: 'all',
        write: true,
      });
      expect(all.report.map((r) => r.status)).toEqual([
        'publiee',
        'deja-publiee',
        'publiee',
        'publiee',
        'publiee',
        'publiee',
      ]);
      for (const w of manifest.windows as unknown as {
        offset: number;
        page: { sha256: string; bytes: number; products: number };
      }[]) {
        const page = readFileSync(
          join(c, 'pages', SH.dir, `${w.offset}.ndjson.gz`)
        );
        expect(sha(page)).toBe(w.page.sha256);
        expect(page.length).toBe(w.page.bytes);
        expect(require_gunzip(page).split(NL).filter(Boolean)).toHaveLength(
          w.page.products
        );
      }
      const again = materializeWindows({
        cacheDir: c,
        key: SH.key,
        offsets: 'all',
        write: true,
      });
      expect(again.report.every((r) => r.status === 'deja-publiee')).toBe(true);
    });
    it('analyzeWindow refuse l’absence de profil et un offset logique non aligné', () => {
      const r = analyzeWindow({
        key: SH.key,
        freeze: FREEZE,
        catalogueCount: SH.n,
        offset: 5000,
        allowedDatasetIds: [SH.ds],
      });
      expect(r.window).toBeNull();
      expect(r.problems.join(NL)).toMatch(
        /profil de pagination absent ou inconnu/
      );
      const q = analyzeWindow({
        key: SH.key,
        freeze: FREEZE,
        catalogueCount: SH.n,
        offset: 5001,
        pagination: 'metadonnees-base-1',
        allowedDatasetIds: [SH.ds],
      });
      expect(q.problems.join(NL)).toMatch(/non aligné/);
    });
    it('profils : définitions et arguments de la ligne de commande', () => {
      expect(PAGINATION_PROFILES.identique.requestOffsets(5000)).toEqual({
        coverage: 5000,
        metadata: 5000,
      });
      expect(
        [0, 5000, 25000].map(
          (o) =>
            PAGINATION_PROFILES['metadonnees-base-1'].requestOffsets(o).metadata
        )
      ).toEqual([0, 5001, 25001]);
      expect(DATASET_PAGINATION).toEqual({
        'Mercury|MESSENGER|MASCS|UVVDDR': 'metadonnees-base-1',
      });
      expect(
        parseArgs([
          'build',
          '--cache-dir',
          'C:/x',
          '--dataset',
          CFG.key,
          '--pagination',
          'identique',
        ])
      ).toMatchObject({ pagination: 'identique' });
      expect(() =>
        parseArgs([
          'materialize',
          '--cache-dir',
          'C:/x',
          '--dataset',
          CFG.key,
          '--offset',
          '0',
          '--pagination',
          'identique',
        ])
      ).toThrow(/ne s’applique qu’à build/);
    });
  }
);

function require_gunzip(b: Buffer): string {
  return gunzipSync(b).toString('utf8');
}

describe(
  '11B-R1 : requalification, statut HTTP, base ODE',
  { timeout: 300_000 },
  () => {
    let base: string;
    let withManifest: string;
    beforeAll(() => {
      base = makeCache(CFG);
      withManifest = clone(base);
      writeManifest(withManifest);
    });
    const edited = (fn: (m: Manifest) => void) => {
      const c = clone(withManifest);
      const f = multipageManifestPath(c, CFG.key);
      const m = JSON.parse(readFileSync(f, 'utf8'));
      fn(m);
      writeFileSync(f, JSON.stringify(m));
      return c;
    };
    const noPage = (c: string) => expect(pagesOf(c)).toEqual([]);

    describe('A. le manifeste est requalifié à partir des captures', () => {
      it('exclusion : un ODEId inexistant, comptes et preuves conservés, est refusé avant toute écriture', () => {
        const c = edited((m) => {
          m.windows[1].excluded[0].odeId = '99999999';
        });
        refusedMat(
          () =>
            materializeWindows({
              cacheDir: c,
              key: CFG.key,
              offsets: 'all',
              write: true,
            }),
          /requalification.*@5000/
        );
        noPage(c);
      });
      it.each([
        [
          'ProductId d’une empreinte',
          (m: Manifest) => {
            m.windows[2].productIds[0] = 'altere';
          },
        ],
        [
          'ProductId d’une exclusion',
          (m: Manifest) => {
            m.windows[1].excluded[0].productId = 'altere';
          },
        ],
        [
          'identifiant d’empreinte inexistant',
          (m: Manifest) => {
            m.windows[3].footprintIds[0] = '88888888';
          },
        ],
        [
          'identifiants autorisés',
          (m: Manifest) => {
            m.allowedDatasetIds.push('AUTRE-JEU');
          },
        ],
        [
          'DatasetId observés',
          (m: Manifest) => {
            m.windows[0].datasetIds = ['AUTRE-JEU'];
          },
        ],
        [
          'cible observée',
          (m: Manifest) => {
            m.windows[0].target.check = 'verifie';
            m.windows[0].target.observed = ['VENUS'];
          },
        ],
        [
          'preuve déclarative de l’exclusion',
          (m: Manifest) => {
            m.windows[1].excluded[0].inShapefiles = {
              ga: false,
              c0a: false,
              c180a: false,
              x: false,
            };
          },
        ],
        [
          'variantes observées',
          (m: Manifest) => {
            m.windows[4].geometry.variants.ga.records += 1;
            m.windows[4].geometry.shapes += 1;
          },
        ],
      ])('altération du manifeste (%s) : refusée', (_n, mutate) => {
        const c = edited(mutate);
        const e = error(() =>
          loadQualifiedDataset({ cacheDir: c, key: CFG.key })
        );
        expect(e).toBeInstanceOf(MaterializeError);
        expect(e.message).toMatch(/refusé/);
        noPage(c);
      });
      it('le manifeste intact reste accepté', () => {
        const c = clone(withManifest);
        expect(
          loadQualifiedDataset({ cacheDir: c, key: CFG.key }).manifest.status
        ).toBe('qualifie');
      });
    });

    describe('B. statut HTTP explicite obligatoire', () => {
      const run = (extra: object, which: 'cov' | 'meta') => {
        const c = clone(base);
        writeWindow(
          c,
          CFG,
          10000,
          products(CFG, 10000),
          which === 'cov' ? { covExtra: extra } : { metaExtra: extra }
        );
        return () => manifestOf(c);
      };
      it.each(['cov', 'meta'] as const)('200 accepté (%s)', (w) => {
        expect(run({ http: { status: 200 } }, w)()).toMatchObject({
          status: 'qualifie',
        });
      });
      it.each(['cov', 'meta'] as const)(
        '206, 403, http absent, status absent : refusés (%s)',
        (w) => {
          refusedMp(run({ http: { status: 206 } }, w), /statut HTTP 206/);
          refusedMp(run({ http: { status: 403 } }, w), /statut HTTP 403/);
          refusedMp(run({ http: undefined }, w), /statut HTTP undefined/);
          refusedMp(run({ http: {} }, w), /statut HTTP undefined/);
        }
      );
      it('la vérification des sources à la publication exige aussi le statut', () => {
        const c = clone(withManifest);
        const f = join(c, 'diagnostics', 'cov-0.raw.json');
        const p = JSON.parse(readFileSync(f, 'utf8'));
        delete p.http;
        writeFileSync(f, JSON.stringify(p));
        refusedMat(
          () => loadQualifiedDataset({ cacheDir: c, key: CFG.key }),
          /statut HTTP undefined/
        );
      });
    });

    describe('C. DatasetId et base ODE', () => {
      it('une entrée d’un autre corps aux mêmes IHID, IID et PT n’est pas acceptée', () => {
        const c = clone(base);
        const f = join(c, 'iipt.json');
        const iipt = JSON.parse(readFileSync(f, 'utf8'));
        iipt.ODEResults.IIPTSets.IIPTSet.push({
          ODEMetaDB: 'Mars',
          IHID: CFG.ihid,
          IID: CFG.iid,
          PT: CFG.pt,
          DataSetId: 'MARS-ETRANGER',
        });
        writeFileSync(f, JSON.stringify(iipt));
        expect(manifestOf(c).allowedDatasetIds).toEqual(
          [CFG.ds, DS_DASH].sort()
        );
        writeWindow(
          c,
          CFG,
          0,
          products(CFG, 0).map((p, k) =>
            k === 1 ? { ...p, ds: 'MARS-ETRANGER' } : p
          )
        );
        refusedMp(
          () => manifestOf(c),
          /DatasetId "MARS-ETRANGER" non autorisé/
        );
      });
      it('une entrée sans ODEMetaDB n’autorise rien ; les écritures de Mercure restent toutes admises', () => {
        const wrap = (l: object[]) => ({
          ODEResults: { IIPTSets: { IIPTSet: l } },
        });
        expect(
          allowedDatasetIdsFromIipt(
            wrap([{ IHID: 'M', IID: 'I', PT: 'P', DataSetId: 'X' }]),
            'Mercury|M|I|P'
          )
        ).toEqual([]);
        expect(
          allowedDatasetIdsFromIipt(
            wrap([
              {
                ODEMetaDB: 'Mercury',
                IHID: 'M',
                IID: 'I',
                PT: 'P',
                DataSetId: 'a/b',
              },
              {
                ODEMetaDB: 'Mercury',
                IHID: 'M',
                IID: 'I',
                PT: 'P',
                DataSetId: 'a-b',
              },
            ]),
            'Mercury|M|I|P'
          )
        ).toEqual(['a-b', 'a/b']);
      });
    });
  }
);
