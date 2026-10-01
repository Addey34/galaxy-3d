#!/usr/bin/env node
/* global console, process, fetch, Buffer, AbortSignal, setTimeout, URL */
/**
 * LES EMPREINTES DE TOUTES LES OBSERVATIONS ORBITALES, TIREES UNE FOIS (ligne 40.3).
 *
 * La question « quelles missions ont observe cette FORMATION » ne se pose pas a l'Orbital Data
 * Explorer au clic : il exige un jeu (IHID + IID + PT) a chaque requete, donc une question de
 * lieu s'eventaille sur 126 jeux pour la Lune, et le pre-calcul formation par formation couterait
 * 94 jours (mesure). La forme qui reste est l'INVERSE : tirer les empreintes jeu par jeu, une
 * fois, et croiser hors ligne avec le gazetteer. Ce script ne fait que le TIRAGE, dans
 * `.cache/ode-footprints/` ; le croisement est un autre script, qui ne demande rien au reseau.
 *
 * CE QUI A ETE MESURE AVANT D'ECRIRE UNE LIGNE (le detail vit dans VISION.md, ligne 40.3) :
 *
 * - le vehicule est `query=coveragetargz`, un shapefile dont la table porte l'identifiant, le
 *   jeu, la date et l'etiquette primaire. `results=x` est MONO-produit selon le manuel, et
 *   `results=m` coute 4 ko par produit contre 0,5 a 1,2 ;
 * - le `NumberProducts` de la liste des jeux compte les AUTRES cibles et se repete : le compte
 *   se lit donc par une requete `results=c` restreinte a la cible ;
 * - la pagination par `offset` est STABLE (meme ensemble avec et sans `order`) ;
 * - `maxcreationtime` SEUL est ignore sans un mot (1990 rend 2,9 M) : il ne s'applique qu'avec
 *   `mincreationtime`, et c'est la paire qui GELE l'ensemble tire. Sans ce gel, un produit
 *   publie pendant le tirage decalerait les pages ;
 * - les bornes de la table sont AMBIGUES pour une empreinte qui traverse le meridien 0 ; on
 *   garde donc le POLYGONE, lu dans le fichier `ga`, qui DECOUPE ces empreintes en plusieurs
 *   enregistrements : ils sont regroupes par `ODEId` ;
 * - un type de produit REDONDANT (la meme image, brute puis calibree) se reconnait par une
 *   REGLE et non par une liste : voir `redundancy()`.
 *
 * Reprise : chaque page est un fichier, ecrit seulement quand elle est complete. Relancer
 * reprend ou l'on s'est arrete.
 *
 * `--plan` (compte et redondance seulement, rien n'est tire), `--only <IHID>`, `--concurrency <n>`
 * (2 par defaut, avec un espacement de 3 s entre departs : a 3 et sans espacement, l'ODE a
 * commence a rendre des 403).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'ode-footprints');
const ODE = 'https://oderest.rsl.wustl.edu/live2/';
/**
 * LE GEL EST UN JOUR DEJA FINI. L'ODE lit `maxcreationtime=AAAA-MM-JJ` comme la FIN de ce jour
 * (sa reponse l'ecrit : `2026-09-30T23:59:59.999`), donc geler « aujourd'hui » ne gele rien : un
 * produit publie ce soir decalerait encore les pages. Mesure le 2026-09-30.
 */
const FREEZE = { mincreationtime: '1900-01-01', maxcreationtime: '2026-09-29' };
const PAGE = 5000;
/** Un type n'est declare redondant que sur au moins autant d'images toutes deja gardees. */
const MIN_REDUNDANT_SAMPLE = 20;
const TARGET = {
  Moon: 'moon',
  Mars: 'mars',
  Mercury: 'mercury',
  Venus: 'venus',
};

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ONLY = opt('--only', null);
const CONCURRENCY = Number(opt('--concurrency', '2'));
/** Redonne sa chance a un jeu declare indisponible lors d'un tirage precedent. */
const RETRY = flag('--retry-unavailable');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * UNE REPRISE SE DIT. La premiere version reessayait en silence, six fois avec une attente qui
 * double : sur une page de MARSIS (41,8 Mo, 72 s seule, bien plus a trois en parallele) le
 * tirage est reste muet seize minutes, et ce silence ressemblait a un service en panne.
 */
/**
 * UN REFUS DE DEBIT N'EST PAS UNE PANNE, et c'est mesure le 2026-09-30 : apres une rafale de
 * requetes de metadonnees (environ 45 en 90 s), l'ODE a rendu des HTTP 403 a des requetes qu'il
 * servait une seconde plus tot, et la premiere version en a conclu qu'un jeu etait INDISPONIBLE.
 * Deux regles, pour ne pas charger un service universitaire et ne pas mentir sur ce qu'il sert :
 *   - un ESPACEMENT d'au moins MIN_GAP_MS entre deux departs de requete, tous ouvriers confondus ;
 *   - un 403, 429 ou 503 suspend TOUT le tirage (5 min, puis le double, jusqu'a une heure) et
 *     rejoue la MEME requete, sans consommer de reprise ni declencher de repli.
 */
const MIN_GAP_MS = 3000;
let nextStart = 0;
let pausedUntil = 0;
let pauseMs = 5 * 60000;
const THROTTLED = new Set([403, 429, 503]);

async function waitForSlot() {
  for (;;) {
    const now = Date.now();
    if (now < pausedUntil) {
      await sleep(pausedUntil - now);
      continue;
    }
    if (now < nextStart) {
      await sleep(nextStart - now);
      continue;
    }
    nextStart = now + MIN_GAP_MS;
    return;
  }
}

async function request(params, timeoutMs = 600000, attempts = 4) {
  const u = new URL(ODE);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  let last;
  let throttles = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await waitForSlot();
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
      if (THROTTLED.has(r.status)) {
        if (++throttles > 12)
          throw new Error(`HTTP ${r.status} persistant apres 12 pauses`);
        if (Date.now() >= pausedUntil) {
          pausedUntil = Date.now() + pauseMs;
          console.log(
            `limite de debit (HTTP ${r.status}) : pause de ${pauseMs / 60000} min`
          );
          pauseMs = Math.min(pauseMs * 2, 60 * 60000);
        }
        attempt--;
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      pauseMs = 5 * 60000;
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      last = e;
      if (/persistant/.test(e.message)) throw e;
      console.log(
        `reprise ${attempt + 1}/${attempts} (${e.message}) : ${u.search.slice(0, 160)}`
      );
      if (attempt + 1 < attempts) await sleep(10000 * 2 ** attempt);
    }
  }
  throw new Error(`${u} : ${last?.message}`);
}

function cached(name, compute) {
  const f = join(CACHE, name);
  if (existsSync(f))
    return Promise.resolve(JSON.parse(readFileSync(f, 'utf8')));
  return compute().then((v) => {
    writeFileSync(f, JSON.stringify(v, null, 1));
    return v;
  });
}

/** Les jeux a empreintes, une ligne par CLE (la liste de l'ODE repete une cle par DataSetId). */
async function datasets() {
  const raw = await cached('iipt.json', async () =>
    JSON.parse(await request({ query: 'iipt', output: 'JSON' }))
  );
  const sets = raw.ODEResults.IIPTSets.IIPTSet.filter(
    (s) => s.ValidFootprints === 'T'
  );
  const keys = new Map();
  for (const s of sets) {
    const k = [s.ODEMetaDB, s.IHID, s.IID, s.PT].join('|');
    if (!keys.has(k) && TARGET[s.ODEMetaDB])
      keys.set(k, {
        key: k,
        db: s.ODEMetaDB,
        target: TARGET[s.ODEMetaDB],
        IHID: s.IHID,
        IID: s.IID,
        PT: s.PT,
        mission: s.IHName,
        instrument: s.IName,
        minObs: s.MinObservationTime,
        maxObs: s.MaxObservationTime,
      });
  }
  return [...keys.values()];
}

const q = (s) => ({ target: s.target, IHID: s.IHID, IID: s.IID, PT: s.PT });

/**
 * LE GEL EXCLUT LES PRODUITS SANS DATE DE CREATION, et c'est mesure le 2026-09-30 : 61 252
 * produits, dont TOUT Viking Orbiter (48 431 images), comptaient zero sous le gel. Un jeu dont le
 * compte CHANGE sous le gel n'est donc PAS gele (`UNFROZEN`), et c'est sans risque ici : ce sont
 * des missions finies, qui ne publieront plus rien, ou des jeux qui tiennent en une page. La
 * garde de fin (identifiants distincts = compte) le verifie au lieu de le supposer.
 */
async function counts(list) {
  return cached('counts.json', async () => {
    const out = {};
    const unfrozen = {};
    for (const s of list) {
      const frozen = Number(
        JSON.parse(
          await request({
            query: 'product',
            results: 'c',
            output: 'JSON',
            ...q(s),
            ...FREEZE,
          })
        ).ODEResults.Count
      );
      const all = Number(
        JSON.parse(
          await request({
            query: 'product',
            results: 'c',
            output: 'JSON',
            ...q(s),
          })
        ).ODEResults.Count
      );
      out[s.key] = all > frozen ? all : frozen;
      if (all > frozen) unfrozen[s.key] = { frozen, all };
    }
    writeFileSync(
      join(CACHE, 'unfrozen.json'),
      JSON.stringify(unfrozen, null, 1)
    );
    return out;
  });
}

/** Le filtre de gel d'un jeu : aucun pour un jeu dont des produits ne portent pas de date. */
const freezeFor = (s) => (UNFROZEN[s.key] ? {} : FREEZE);
let UNFROZEN = {};

/**
 * LA REGLE DE REDONDANCE, mesuree et non declaree. Par instrument, types pris du plus gros au plus
 * petit, sur une journee au milieu de la periode du plus gros : un type est redondant si au moins
 * MIN_REDUNDANT_SAMPLE de ses images ont TOUTES un instant de debut deja present dans l'union des
 * types gardes. Tout le reste (fenetre vide, echantillon maigre, date non declaree) est GARDE :
 * l'erreur reste du cote prudent. « Le plus gros type par instrument » aurait ete FAUX : THEMIS
 * range IR et VIS, et MOC ses deux cameras, sous une meme etiquette d'instrument.
 */
async function redundancy(list, n) {
  return cached('redundancy.json', async () => {
    const times = async (s, win) => {
      try {
        const j = JSON.parse(
          await request(
            {
              query: 'product',
              results: 'm',
              output: 'JSON',
              ...q(s),
              limit: '1000',
              ...win,
            },
            120000
          )
        ).ODEResults;
        let p = j.Products?.Product ?? [];
        if (!Array.isArray(p)) p = [p];
        return new Set(
          p
            .map((x) => String(x.UTC_start_time || '').slice(0, 19))
            .filter(Boolean)
        );
      } catch {
        return null;
      }
    };
    const byInst = {};
    for (const s of list)
      (byInst[[s.db, s.IHID, s.IID].join('|')] ??= []).push(s);
    const out = {};
    for (const sets of Object.values(byInst)) {
      sets.sort((a, b) => n[b.key] - n[a.key]);
      const a = Date.parse(sets[0].minObs);
      const b = Date.parse(sets[0].maxObs);
      if (sets.length < 2 || !Number.isFinite(a) || !Number.isFinite(b)) {
        for (const s of sets) out[s.key] = { verdict: 'keep' };
        continue;
      }
      const day = new Date(a + (b - a) / 2).toISOString().slice(0, 10);
      const win = {
        minobtime: day,
        maxobtime: new Date(Date.parse(day) + 86400e3)
          .toISOString()
          .slice(0, 10),
      };
      const kept = new Set();
      for (const s of sets) {
        const T = await times(s, win);
        let verdict = 'keep';
        let inKept = null;
        if (T && T.size >= MIN_REDUNDANT_SAMPLE) {
          inKept = [...T].filter((t) => kept.has(t)).length;
          if (inKept === T.size) verdict = 'redundant';
        }
        if (verdict === 'keep' && T) T.forEach((t) => kept.add(t));
        out[s.key] = { verdict, day, sample: T?.size ?? null, inKept };
      }
    }
    return out;
  });
}

function untar(buf) {
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

function readDbf(d, want) {
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
function readShp(d) {
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

/**
 * UNE PAGE TROP LOURDE SE COUPE au lieu de se redemander : les traces de MARSIS portent jusqu'a
 * 976 sommets par produit, et une page de 5 000 depasse alors ce qu'une requete tient. Une page
 * qui echoue est retiree en CINQ sous-pages de 1 000, et les
 * produits se regroupent par `ODEId` exactement comme dans une page entiere.
 */
/**
 * Les INSTRUMENTS dont l'export shapefile a deja echoue : leurs pages suivantes, et celles de
 * leurs AUTRES types de produits, passent DIRECTEMENT par les metadonnees. C'est l'instrument
 * qui decide, pas le jeu : mesure le 2026-09-30, les quatre jeux de MGS MOC echouent tous, et une
 * memoire par jeu faisait repayer vingt minutes de reprises a chacun.
 */
const META_ONLY_FILE = join(CACHE, 'meta-only.json');
/** Persistee : un redemarrage ne doit pas repayer vingt minutes de reprises par instrument. */
const metaOnly = new Set(
  existsSync(META_ONLY_FILE)
    ? JSON.parse(readFileSync(META_ONLY_FILE, 'utf8'))
    : []
);
const markMetaOnly = (s) => {
  metaOnly.add(instrumentOf(s));
  writeFileSync(META_ONLY_FILE, JSON.stringify([...metaOnly], null, 1));
};
const instrumentOf = (s) => `${s.db}|${s.IHID}|${s.IID}`;

async function pullPage(s, offset) {
  if (metaOnly.has(instrumentOf(s))) {
    const byId = new Map();
    for (let sub = offset; sub < offset + PAGE; sub += PAGE / 5)
      for (const p of await pullMeta(s, sub, PAGE / 5)) byId.set(p.id, p);
    return [...byId.values()];
  }
  try {
    return await pullRange(s, offset, PAGE, 2);
  } catch (e) {
    console.log(
      `page coupee en sous-pages : ${s.key} @${offset} (${e.message.slice(-60)})`
    );
    const byId = new Map();
    for (let sub = offset; sub < offset + PAGE; sub += PAGE / 5)
      for (const p of await pullRangeOrMeta(s, sub, PAGE / 5)) {
        const e2 = byId.get(p.id);
        if (!e2) byId.set(p.id, p);
        else
          for (const [k, v] of Object.entries(p.shapes))
            (e2.shapes[k] ??= []).push(...v);
      }
    return [...byId.values()];
  }
}

/**
 * LE REPLI PAR LES METADONNEES. Mesure le 2026-09-30 : l'export shapefile de MGS MOC ne rend
 * RIEN, pas meme vingt produits en dix minutes, alors que son compte repond en 3 s et que
 * `results=m` le servait le matin meme. Or les metadonnees portent la geometrie en WKT
 * (`Footprint_GL_geometry`, le pendant de `ga`), la date et l'etiquette. Elles coutent 4 ko par
 * produit contre moins d'un, d'ou leur place de REPLI et non de route principale.
 */
async function pullRangeOrMeta(s, offset, limit) {
  // Consultee a CHAQUE sous-page, pas seulement en tete de page : une page deja en vol quand
  // l'instrument est marque repayait sinon dix minutes par sous-page.
  if (metaOnly.has(instrumentOf(s))) return pullMeta(s, offset, limit);
  try {
    return await pullRange(s, offset, limit, 1);
  } catch (e) {
    console.log(
      `repli par les metadonnees : ${s.key} @${offset} (${e.message.slice(-60)})`
    );
    markMetaOnly(s);
    return pullMeta(s, offset, limit);
  }
}

async function pullMeta(s, offset, limit) {
  const j = JSON.parse(
    await request(
      {
        query: 'product',
        results: 'm',
        output: 'JSON',
        ...q(s),
        limit: String(limit),
        offset: String(offset),
        ...freezeFor(s),
      },
      600000,
      3
    )
  ).ODEResults;
  if (j.Status && j.Status !== 'Success')
    throw new Error(`metadonnees : ${j.Error ?? j.Status}`);
  let list = j.Products?.Product ?? [];
  if (!Array.isArray(list)) list = [list];
  const out = [];
  for (const m of list) {
    const shapes = wktShapes(
      m.Footprint_GL_geometry ?? m.Footprint_geometry ?? ''
    );
    if (!shapes) continue;
    const id = /product_idGeo=(\d+)/.exec(m.ProductURL ?? '')?.[1];
    if (!id) continue;
    out.push({
      id,
      pid: /product_id=([^&]+)/.exec(m.ProductURL ?? '')?.[1] ?? '',
      ds: '',
      t0: m.UTC_start_time ?? m.Observation_time ?? '',
      t1: m.UTC_stop_time ?? '',
      label: m.LabelURL ?? '',
      target: '',
      shapes,
    });
  }
  return out;
}

/** WKT → formes rangees par type, au millieme de degre. `null` pour une geometrie vide. */
export function wktShapes(wkt) {
  const r3 = (x) => Math.round(Number(x) * 1000) / 1000;
  const coords = (text) =>
    text
      .split(',')
      .map((pair) => pair.trim().split(/\s+/))
      .filter((xy) => xy.length >= 2)
      .map(([x, y]) => [r3(x), r3(y)]);
  const type = /^\s*([A-Z]+)/.exec(wkt)?.[1];
  if (!type || /EMPTY/.test(wkt)) return null;
  const groups = [...wkt.matchAll(/\(([^()]+)\)/g)].map((m) => coords(m[1]));
  if (!groups.length) return null;
  if (type === 'POLYGON' || type === 'MULTIPOLYGON') return { a: groups };
  if (type === 'LINESTRING' || type === 'MULTILINESTRING') return { l: groups };
  if (type === 'POINT' || type === 'MULTIPOINT')
    return { p: groups.flat().map((pt) => [pt]) };
  return null;
}

async function pullRange(s, offset, limit, attempts) {
  const buf = await request(
    {
      query: 'coveragetargz',
      ...q(s),
      limit: String(limit),
      offset: String(offset),
      ...freezeFor(s),
    },
    600000,
    attempts
  );
  if (buf.length < 1024) return [];
  let tar;
  try {
    tar = untar(gunzipSync(buf));
  } catch {
    tar = untar(buf);
  }
  // UNE SURFACE (`_ga`), UNE TRACE (`_gl`, les sondeurs radar comme MARSIS) ou DES POINTS
  // (`_gp`) : le suffixe du fichier dit la forme. UNE MEME PAGE PEUT PORTER LES TROIS, et c'est
  // mesure sur PFS (9 surfaces et des dizaines de milliers de points pour 200 produits) : la
  // premiere version ne lisait que le premier type trouve et aurait garde 9 produits sur 200
  // sans un mot. Chaque forme est donc rangee sous son type, et une page sans aucun des trois
  // echoue en le nommant.
  const kinds = ['a', 'l', 'p'].filter((k) =>
    Object.keys(tar).some((f) => f.endsWith(`_g${k}.dbf`))
  );
  if (!kinds.length)
    throw new Error(
      `ni ga, ni gl, ni gp pour ${s.key} @${offset} : ${Object.keys(tar)}`
    );
  const byId = new Map();
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
        `${s.key} @${offset} : ${rows.length} lignes pour ${shapes.length} formes`
      );
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
  return [...byId.values()];
}

const safe = (k) => k.replace(/[^A-Za-z0-9_.-]+/g, '_');

async function main() {
  mkdirSync(CACHE, { recursive: true });
  // Le gel est ECRIT a cote des pages : le croisement le relit pour le publier, sans le recopier.
  writeFileSync(join(CACHE, 'freeze.json'), JSON.stringify(FREEZE) + '\n');
  let list = await datasets();
  const n = await counts(list);
  const uf = join(CACHE, 'unfrozen.json');
  UNFROZEN = existsSync(uf) ? JSON.parse(readFileSync(uf, 'utf8')) : {};
  console.log(
    `${Object.keys(UNFROZEN).length} jeux NON geles (produits sans date de creation)`
  );
  const red = await redundancy(list, n);
  if (ONLY) list = list.filter((s) => s.IHID === ONLY);
  const todo = list.filter(
    (s) => red[s.key]?.verdict !== 'redundant' && n[s.key] > 0
  );
  const total = todo.reduce((a, s) => a + n[s.key], 0);
  const skipped = list.filter((s) => red[s.key]?.verdict === 'redundant');
  console.log(
    `${list.length} cles, ${skipped.length} redondantes (${skipped.reduce((a, s) => a + n[s.key], 0)} produits), ` +
      `${todo.length} a tirer, ${total} produits, gel a ${FREEZE.maxcreationtime}`
  );
  if (flag('--plan')) return;

  const tasks = [];
  for (const s of todo) {
    const dir = join(CACHE, 'pages', safe(s.key));
    mkdirSync(dir, { recursive: true });
    const have = new Set(readdirSync(dir));
    for (let off = 0; off < n[s.key]; off += PAGE)
      if (!have.has(`${off}.ndjson.gz`))
        tasks.push({ s, off, file: join(dir, `${off}.ndjson.gz`) });
  }
  const pages = todo.reduce((a, s) => a + Math.ceil(n[s.key] / PAGE), 0);
  console.log(
    `pages : ${pages - tasks.length} deja la, ${tasks.length} a tirer`
  );
  let done = 0;
  let failed = 0;
  const t0 = Date.now();
  /**
   * UN JEU QUI NE REPOND PAS EST DECLARE, il ne bloque pas le tirage. Une page qui echoue par
   * les TROIS routes (shapefile entier, sous-pages, metadonnees) marque son jeu INDISPONIBLE avec
   * l'erreur mesuree, dans `unavailable.json` : le croisement le PUBLIE au lieu de le taire, et
   * les pages restantes de ce jeu ne coutent plus des heures de reprises.
   */
  const unavailableFile = join(CACHE, 'unavailable.json');
  const unavailable =
    existsSync(unavailableFile) && !RETRY
      ? JSON.parse(readFileSync(unavailableFile, 'utf8'))
      : {};
  async function worker() {
    while (tasks.length) {
      const t = tasks.shift();
      if (unavailable[t.s.key]) {
        done++;
        continue;
      }
      try {
        const products = await pullPage(t.s, t.off);
        writeFileSync(
          t.file,
          gzipSync(products.map((p) => JSON.stringify(p)).join('\n'))
        );
      } catch (e) {
        failed++;
        unavailable[t.s.key] = {
          error: e.message.slice(-200),
          offset: t.off,
          at: new Date().toISOString(),
        };
        writeFileSync(unavailableFile, JSON.stringify(unavailable, null, 1));
        console.log(
          `ECHEC ${t.s.key} @${t.off}, jeu declare indisponible : ${e.message.slice(-120)}`
        );
      }
      done++;
      if (done % 20 === 0 || !tasks.length) {
        const rate = (Date.now() - t0) / done;
        console.log(
          `[${done}/${done + tasks.length}] ${t.s.key} @${t.off} · ${failed} echec(s) · ` +
            `reste ~${((rate * tasks.length) / 3600000).toFixed(1)} h`
        );
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `FIN ${done} pages, ${failed} echec(s), ${((Date.now() - t0) / 3600000).toFixed(2)} h`
  );
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
