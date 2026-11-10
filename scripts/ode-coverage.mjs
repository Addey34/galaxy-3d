/**
 * ARCHIVE `coveragetargz` DE L'ODE : lecture et ANALYSE AVANT REGROUPEMENT (GAL-A003-05C).
 *
 * Un enregistrement de forme n'est pas un produit scientifique. Le pilote `Mercury|MESSENGER|MLA|
 * radr` a donné 3 274 produits distincts pour 3 278 attendus : avant de conclure quoi que ce soit,
 * `analyzeRecords` mesure ce que l'archive contient RÉELLEMENT (enregistrements par type de
 * géométrie, identifiants distincts, répétitions, identifiants vides ou invalides, incohérences
 * ODEId / ProductId / DatasetId). `parseCoverageArchive` regroupe par `ODEId` exactement comme
 * avant (le comportement des produits est INCHANGÉ) ; l'analyse est un témoin, jamais une règle
 * de complétude : la politique `attendu === distincts` reste celle de `ode-pages.mjs`.
 */
import { gunzipSync } from 'node:zlib';

export function untar(buf) {
  const out = {};
  let o = 0;
  while (o + 512 <= buf.length) {
    const name = buf
      .subarray(o, o + 100)
      .toString()
      .split('\0')[0];
    if (!name) break;
    const size = parseInt(
      buf
        .subarray(o + 124, o + 136)
        .toString()
        .replace(/\0/g, '')
        .trim() || '0',
      8
    );
    out[name] = buf.subarray(o + 512, o + 512 + size);
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

export function readDbf(d, want) {
  const n = d.readUInt32LE(4);
  const hl = d.readUInt16LE(8);
  const rl = d.readUInt16LE(10);
  const fields = [];
  let o = 32;
  let p = 1;
  while (d[o] !== 0x0d) {
    const name = d
      .subarray(o, o + 11)
      .toString()
      .split('\0')[0];
    const len = d[o + 16];
    fields.push([name, p, len]);
    p += len;
    o += 32;
  }
  const rows = [];
  for (let i = 0; i < n; i++) {
    const b = hl + i * rl;
    const r = {};
    for (const [name, pp, len] of fields)
      if (want.includes(name))
        r[name] = d
          .subarray(b + pp, b + pp + len)
          .toString('latin1')
          .trim();
    rows.push(r);
  }
  return rows;
}

/** Formes d'un .shp (polygones, lignes, points), un tableau d'anneaux par enregistrement, au millieme de degre. */
export function readShp(d) {
  const recs = [];
  let o = 100;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  while (o + 8 <= d.length) {
    const len = d.readInt32BE(o + 4) * 2;
    const c = o + 8;
    const type = d.readInt32LE(c);
    const rings = [];
    if (type === 1 || type === 11 || type === 21) {
      rings.push([[r3(d.readDoubleLE(c + 4)), r3(d.readDoubleLE(c + 12))]]);
    } else if (type === 8 || type === 18 || type === 28) {
      const nPts = d.readInt32LE(c + 36);
      const ring = [];
      for (let k = 0; k < nPts; k++)
        ring.push([
          r3(d.readDoubleLE(c + 40 + 16 * k)),
          r3(d.readDoubleLE(c + 48 + 16 * k)),
        ]);
      rings.push(ring);
    } else if ([3, 13, 23, 5, 15, 25].includes(type)) {
      const nParts = d.readInt32LE(c + 36);
      const nPts = d.readInt32LE(c + 40);
      const parts = [];
      for (let i = 0; i < nParts; i++)
        parts.push(d.readInt32LE(c + 44 + 4 * i));
      const base = c + 44 + 4 * nParts;
      for (let i = 0; i < nParts; i++) {
        const end = i + 1 < nParts ? parts[i + 1] : nPts;
        const ring = [];
        for (let k = parts[i]; k < end; k++)
          ring.push([
            r3(d.readDoubleLE(base + 16 * k)),
            r3(d.readDoubleLE(base + 16 * k + 8)),
          ]);
        rings.push(ring);
      }
    }
    recs.push(rings);
    o = c + len;
  }
  return recs;
}

const KINDS = ['a', 'l', 'p'];
const CAP = 200;

/**
 * Analyse des enregistrements DBF de chaque type de géométrie, AVANT regroupement.
 * `perKind` : { a?: rows[], l?: rows[], p?: rows[] }, chaque ligne { ODEId, ProductId, DatasetId }.
 */
export function analyzeRecords(perKind) {
  const recordsByKind = {};
  const distinctByKind = {};
  const occurrences = new Map(); // id -> { total, byKind }
  const products = new Map(); // id -> { pids:Set, dss:Set }
  const empty = { count: 0, byKind: {} };
  const invalid = [];
  let invalidCount = 0;
  for (const kind of KINDS) {
    const rows = perKind[kind];
    if (!rows) continue;
    recordsByKind[kind] = rows.length;
    const seen = new Set();
    for (const r of rows) {
      const id = r.ODEId ?? '';
      seen.add(id);
      const o = occurrences.get(id) ?? { total: 0, byKind: {} };
      o.total++;
      o.byKind[kind] = (o.byKind[kind] ?? 0) + 1;
      occurrences.set(id, o);
      const p = products.get(id) ?? { pids: new Set(), dss: new Set() };
      p.pids.add(r.ProductId ?? '');
      p.dss.add(r.DatasetId ?? '');
      products.set(id, p);
      if (id === '') {
        empty.count++;
        empty.byKind[kind] = (empty.byKind[kind] ?? 0) + 1;
      } else if (!/^[0-9]+$/.test(id)) {
        invalidCount++;
        if (invalid.length < CAP) invalid.push({ id, kind });
      }
    }
    distinctByKind[kind] = seen.size;
  }
  const repeatedAll = [...occurrences]
    .filter(([, o]) => o.total > 1)
    .map(([id, o]) => ({ id, occurrences: o.total, byKind: o.byKind }))
    .sort((x, y) => y.occurrences - x.occurrences || x.id.localeCompare(y.id));
  const inconsistentAll = [...products]
    .filter(([, p]) => p.pids.size > 1 || p.dss.size > 1)
    .map(([id, p]) => ({
      id,
      productIds: [...p.pids],
      datasetIds: [...p.dss],
    }));
  const allPids = new Set();
  const allDss = new Set();
  for (const p of products.values()) {
    for (const x of p.pids) allPids.add(x);
    for (const x of p.dss) allDss.add(x);
  }
  const totalRecords = Object.values(recordsByKind).reduce((a, n) => a + n, 0);
  return {
    totalRecords,
    recordsByKind,
    distinctByKind,
    unionDistinct: occurrences.size,
    repeatedTotal: repeatedAll.length,
    repeatedRecordsInExcess: totalRecords - occurrences.size,
    repeated: repeatedAll.slice(0, CAP),
    emptyIds: empty,
    invalidIds: { count: invalidCount, sample: invalid },
    inconsistentTotal: inconsistentAll.length,
    inconsistent: inconsistentAll.slice(0, CAP),
    distinctProductIds: allPids.size,
    distinctDatasetIds: allDss.size,
    productsAfterGrouping: occurrences.size,
    note: 'enregistrements de formes et produits scientifiques sont deux comptes distincts',
  };
}

/**
 * Lit l'archive et regroupe par `ODEId` (comportement historique). Rend { products, analysis } ;
 * une réponse de moins de 1 024 octets est une page vide (analysis null).
 */
export function parseCoverageArchive(buf, key, offset) {
  if (buf.length < 1024) return { products: [], analysis: null };
  let tar;
  try {
    tar = untar(gunzipSync(buf));
  } catch {
    tar = untar(buf);
  }
  // UNE SURFACE (`_ga`), UNE TRACE (`_gl`) ou DES POINTS (`_gp`) : le suffixe du fichier dit la
  // forme. UNE MEME PAGE PEUT PORTER LES TROIS (mesuré sur PFS) ; une page sans aucun des trois
  // échoue en le nommant.
  const kinds = KINDS.filter((k) =>
    Object.keys(tar).some((f) => f.endsWith(`_g${k}.dbf`))
  );
  if (!kinds.length)
    throw new Error(
      `ni ga, ni gl, ni gp pour ${key} @${offset} : ${Object.keys(tar)}`
    );
  const byId = new Map();
  const perKind = {};
  for (const kind of kinds) {
    const base = Object.keys(tar)
      .find((f) => f.endsWith(`_g${kind}.dbf`))
      .slice(0, -4);
    const rows = readDbf(tar[`${base}.dbf`], [
      'ODEId',
      'ProductId',
      'DatasetId',
      'UTCstart',
      'UTCend',
      'LabelURL',
      'Target',
    ]);
    const shapes = readShp(tar[`${base}.shp`]);
    if (shapes.length !== rows.length)
      throw new Error(
        `${key} @${offset} : ${rows.length} lignes pour ${shapes.length} formes`
      );
    perKind[kind] = rows;
    rows.forEach((r, i) => {
      const e = byId.get(r.ODEId) ?? {
        id: r.ODEId,
        pid: r.ProductId,
        ds: r.DatasetId,
        t0: r.UTCstart,
        t1: r.UTCend,
        label: r.LabelURL,
        target: r.Target,
        shapes: {},
      };
      (e.shapes[kind] ??= []).push(...shapes[i]);
      byId.set(r.ODEId, e);
    });
  }
  const analysis = analyzeRecords(perKind);
  return { products: [...byId.values()], analysis };
}
