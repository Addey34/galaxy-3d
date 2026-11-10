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
 * `--body <mercury|mars>` (OBLIGATOIRE pour tirer : selection stricte par CIBLE ; `--only` filtre par
 * mission et MESSENGER couvre aussi Venus), `--cache-dir <chemin absolu hors depot>` (ou
 * GALAXY_ODE_CACHE, obligatoire avec --body), `--plan` (compte et redondance seulement, rien n'est
 * tire), `--only <IHID>` (intersection avec --body), `--dataset <cle>` (UN jeu, egalite exacte avec
 * sa cle `Corps|MISSION|INSTRUMENT|TYPE`, du corps demande), `--max-pages <n>` (refuse la collecte
 * si plus de n pages sont a telecharger), `--diagnostic` (avec --dataset : conserve la reponse brute
 * `coveragetargz` et son analyse avant regroupement sous <cache>/diagnostics/, jamais dans pages/),
 * `--concurrency <n>`
 * (2 par defaut, avec un espacement de 3 s entre departs : a 3 et sans espacement, l'ODE a
 * commence a rendre des 403).
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTABLE_BODIES,
  FREEZE,
  PAGE,
  acquireLock,
  assertMaxPages,
  assertLocalMetadata,
  assertMetadataComplete,
  datasetsFromIipt,
  freezeAction,
  optionValue,
  parseDatasetArg,
  parseMaxPages,
  resolveCacheDir,
  selectDatasets,
} from './ode-selection.mjs';
import {
  EXIT_LOCAL_STORAGE,
  collectPages,
  inspectExistingPages,
  pageName,
  writeFileAtomic,
  isLocalStorageError,
} from './ode-pages.mjs';
import { parseCoverageArchive } from './ode-coverage.mjs';
import {
  describeGap,
  diagnosticsDir,
  quarantineRaw,
  writeAnalysis,
} from './ode-diagnostic.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * `--cache-dir <chemin absolu>` (ou GALAXY_ODE_CACHE) : le cache vit HORS de tout dépôt et de tout
 * worktree. Une collecte par corps l'exige ; sans `--body`, l'ancien emplacement reste permis
 * (`--plan`, lecture). Voir `ode-selection.mjs`.
 */
const argv = process.argv.slice(2);
const argValue = (name) =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : null;
const BODY = argValue('--body');
let CACHE;
let DATASET = null;
let MAX_PAGES = null;
/** Un pilote (--dataset / --max-pages) ne sollicite JAMAIS l'ODE pour ses métadonnées. */
let PILOT = false;
/** Mode diagnostic explicite : conserve le brut `coveragetargz` en quarantaine (jamais dans pages/). */
let DIAGNOSTIC = false;
try {
  CACHE = resolveCacheDir({
    arg: argValue('--cache-dir'),
    env: process.env.GALAXY_ODE_CACHE ?? null,
    root: ROOT,
    requireExternal: BODY !== null || !argv.includes('--plan'),
  });
  DATASET = parseDatasetArg(optionValue(argv, '--dataset'));
  MAX_PAGES = parseMaxPages(optionValue(argv, '--max-pages'));
  PILOT = DATASET !== null || MAX_PAGES !== null;
  if (DATASET !== null && BODY === null)
    throw new Error('--dataset exige --body');
  DIAGNOSTIC = argv.includes('--diagnostic');
  if (DIAGNOSTIC && DATASET === null)
    throw new Error('--diagnostic exige --dataset (un seul jeu)');
  if (BODY !== null && !COLLECTABLE_BODIES.includes(BODY))
    throw new Error(
      `--body ${BODY} : corps inconnu (${COLLECTABLE_BODIES.join(', ')})`
    );
  if (BODY === null && !argv.includes('--plan'))
    throw new Error(
      `une collecte exige --body (${COLLECTABLE_BODIES.join(' | ')}) ; --plan seul ne tire rien`
    );
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const ODE = 'https://oderest.rsl.wustl.edu/live2/';
/** Le gel (`FREEZE`) et la taille de page (`PAGE`) viennent de `ode-selection.mjs`, source unique. */
/** Un type n'est declare redondant que sur au moins autant d'images toutes deja gardees. */
const MIN_REDUNDANT_SAMPLE = 20;

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

async function request(params, timeoutMs = 600000, attempts = 4, meta = null) {
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
      if (meta) {
        meta.status = r.status;
        meta.contentType = r.headers.get('content-type');
        meta.url = String(u);
      }
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
  if (PILOT)
    return Promise.reject(
      new Error(
        `${name} absent du cache : un pilote ne le récupère pas en ligne`
      )
    );
  return compute().then((v) => {
    writeFileAtomic(f, JSON.stringify(v, null, 1));
    return v;
  });
}

/** Les jeux a empreintes, une ligne par CLE (la liste de l'ODE repete une cle par DataSetId). */
async function datasets() {
  const raw = await cached('iipt.json', async () =>
    JSON.parse(await request({ query: 'iipt', output: 'JSON' }))
  );
  return datasetsFromIipt(raw);
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
    writeFileAtomic(
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
  writeFileAtomic(META_ONLY_FILE, JSON.stringify([...metaOnly], null, 1));
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
    // Une panne de stockage local (quarantaine diagnostique) ne se contourne pas par d'autres requêtes.
    if (isLocalStorageError(e)) throw e;
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
  const meta = {};
  const buf = await request(
    {
      query: 'coveragetargz',
      ...q(s),
      limit: String(limit),
      offset: String(offset),
      ...freezeFor(s),
    },
    600000,
    attempts,
    meta
  );
  // Mode diagnostic : le brut est conservé AVANT toute transformation. Un échec d'écriture est une
  // erreur de stockage local qui interrompt la collecte (jamais un jeu indisponible).
  const kept = DIAGNOSTIC
    ? quarantineRaw({
        cacheDir: CACHE,
        raw: buf,
        key: s.key,
        offset,
        limit,
        freeze: { ...freezeFor(s) },
        http: {
          status: meta.status ?? null,
          contentType: meta.contentType ?? null,
          url: meta.url ?? null,
        },
      })
    : null;
  const { products, analysis } = parseCoverageArchive(buf, s.key, offset, {
    analyze: DIAGNOSTIC,
  });
  const gap = describeGap(analysis);
  if (gap) console.log(`${s.key} @${offset} : ${gap}`);
  if (kept && analysis) {
    writeAnalysis({ dir: kept.dir, base: kept.base, analysis });
    console.log(
      `diagnostic : brut et analyse conserves dans ${diagnosticsDir(CACHE)} (${kept.base})`
    );
  }
  return products;
}

const safe = (k) => k.replace(/[^A-Za-z0-9_.-]+/g, '_');

async function main() {
  // Pilote : tout doit déjà être en local, vérifié AVANT le verrou, le gel et toute requête.
  if (PILOT) assertLocalMetadata(CACHE);
  mkdirSync(CACHE, { recursive: true });
  // Un seul collecteur par cache : deux processus se réécriraient `unavailable.json`.
  const release = acquireLock(CACHE);
  process.on('exit', release);
  // Le gel est ECRIT a cote des pages : le croisement le relit pour le publier, sans le recopier.
  // S'il existe deja avec une AUTRE valeur, on s'arrete (verifie plus bas) au lieu de l'ecraser.
  const freezeFile = join(CACHE, 'freeze.json');
  const freezeOnDisk = existsSync(freezeFile)
    ? JSON.parse(readFileSync(freezeFile, 'utf8'))
    : null;
  // Jamais recréé dans un cache qui contient déjà une collecte (freezeAction lève sinon).
  if (freezeAction(CACHE) === 'create')
    writeFileAtomic(freezeFile, JSON.stringify(FREEZE) + '\n');
  // Les metadonnees sont celles de TOUS les jeux : la selection par corps vient APRES.
  const full = await datasets();
  let list = full;
  const n = await counts(full);
  const uf = join(CACHE, 'unfrozen.json');
  UNFROZEN = existsSync(uf) ? JSON.parse(readFileSync(uf, 'utf8')) : null;
  const red = await redundancy(full, n);
  assertMetadataComplete({
    list: full,
    counts: n,
    redundancy: red,
    unfrozen: UNFROZEN,
    freezeOnDisk,
    freeze: FREEZE,
  });
  console.log(
    `${Object.keys(UNFROZEN).length} jeux NON geles (produits sans date de creation)`
  );
  if (BODY)
    list = selectDatasets(full, {
      body: BODY,
      only: ONLY,
      dataset: DATASET,
    });
  else if (ONLY) list = list.filter((s) => s.IHID === ONLY);
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
  let reused = 0;
  for (const s of todo) {
    const dir = join(CACHE, 'pages', safe(s.key));
    mkdirSync(dir, { recursive: true });
    const offsets = [];
    for (let off = 0; off < n[s.key]; off += PAGE) offsets.push(off);
    /**
     * UNE PAGE PRÉSENTE N'EST PAS UNE PAGE VALIDE : chaque fichier est relu en entier (gzip, JSON,
     * id, shapes) avant d'être tenu pour acquis. Une page invalide est SIGNALÉE et retéléchargée ;
     * elle n'est jamais supprimée, le nouveau fichier validé la remplace par renommage atomique.
     * Les temporaires abandonnés d'une écriture interrompue sont retirés.
     */
    const found = inspectExistingPages(dir, offsets, (off) =>
      Math.min(PAGE, n[s.key] - off)
    );
    for (const name of found.staleTmp)
      console.log(`temporaire abandonne retire : ${s.key} ${name}`);
    for (const bad of found.invalid)
      console.log(
        `PAGE INVALIDE ${s.key} @${bad.offset} (${bad.reason}) : a retelecharger`
      );
    reused += found.valid.size;
    for (const off of offsets)
      if (!found.valid.has(off))
        tasks.push({
          key: s.key,
          s,
          off,
          offset: off,
          expected: Math.min(PAGE, n[s.key] - off),
          file: join(dir, pageName(off)),
        });
  }
  console.log(`pages : ${reused} valides deja la, ${tasks.length} a tirer`);
  try {
    assertMaxPages(tasks.length, MAX_PAGES);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  const t0 = Date.now();
  /**
   * UN JEU QUI NE REPOND PAS EST DECLARE, il ne bloque pas le tirage. Une page qui echoue par
   * les TROIS routes (shapefile entier, sous-pages, metadonnees) marque son jeu INDISPONIBLE avec
   * l'erreur mesuree, dans `unavailable.json` : le croisement le PUBLIE au lieu de le taire, et
   * les pages restantes de ce jeu ne coutent plus des heures de reprises.
   * Une erreur de STOCKAGE LOCAL (disque plein, E/S, volume disparu, permissions) n'est PAS un
   * jeu indisponible : elle arrete la collecte proprement (`collectPages`, code de sortie 3).
   */
  const unavailableFile = join(CACHE, 'unavailable.json');
  const unavailable =
    existsSync(unavailableFile) && !RETRY
      ? JSON.parse(readFileSync(unavailableFile, 'utf8'))
      : {};
  const incompleteFile = join(CACHE, 'incomplete.json');
  const incompletes = {};
  const { done, failed, incomplete, fatal, remaining } = await collectPages({
    tasks,
    pull: (t) => pullPage(t.s, t.off),
    unavailable,
    concurrency: CONCURRENCY,
    markUnavailable: (t, e) => {
      unavailable[t.key] = {
        error: e.message.slice(-200),
        offset: t.off,
        at: new Date().toISOString(),
      };
      writeFileAtomic(unavailableFile, JSON.stringify(unavailable, null, 1));
      console.log(
        `ECHEC ${t.key} @${t.off}, jeu declare indisponible : ${e.message.slice(-120)}`
      );
    },
    markIncomplete: (t, e) => {
      incompletes[`${t.key}@${t.off}`] = {
        expected: t.expected,
        got: e.got ?? null,
        error: e.message.slice(-200),
        at: new Date().toISOString(),
      };
      writeFileAtomic(incompleteFile, JSON.stringify(incompletes, null, 1));
      console.log(`INCOMPLET ${t.key} @${t.off} : ${e.message.slice(-120)}`);
    },
    onProgress: ({ done: d, failed: f, queued, task }) => {
      if (d % 20 === 0 || !queued) {
        const rate = (Date.now() - t0) / d;
        console.log(
          `[${d}/${d + queued}] ${task.key} @${task.off} · ${f} echec(s) · ` +
            `reste ~${((rate * queued) / 3600000).toFixed(1)} h`
        );
      }
    },
  });
  if (fatal) {
    console.error(
      `ARRET sur erreur de stockage LOCAL : ${fatal.message}
` +
        `${remaining} page(s) non tirees ; aucun jeu n'a ete declare indisponible a cause de cette erreur. ` +
        `Corriger le stockage puis relancer : les pages valides sont conservees.`
    );
    process.exitCode = EXIT_LOCAL_STORAGE;
    return;
  }
  console.log(
    `FIN ${done} pages, ${failed} echec(s), ${((Date.now() - t0) / 3600000).toFixed(2)} h`
  );
  if (!incomplete && existsSync(incompleteFile)) rmSync(incompleteFile);
  if (incomplete)
    console.error(
      `${incomplete} page(s) INCOMPLETE(S) declaree(s) dans incomplete.json : non publiees, a reprendre`
    );
  if (failed || incomplete) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
