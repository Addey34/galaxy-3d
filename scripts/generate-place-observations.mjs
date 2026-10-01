#!/usr/bin/env node
/* global console, process, Buffer */
/**
 * QUELLES MISSIONS ONT OBSERVÉ CETTE FORMATION (ligne 40.3) : le CROISEMENT, hors ligne.
 *
 * Lit les empreintes tirées par `scripts/pull-ode-footprints.mjs` dans `.cache/ode-footprints/`
 * et les formations du gazetteer livré (`public/assets/gazetteer/`), et écrit, par corps, ce que
 * l'Orbital Data Explorer déclare avoir observé sur chaque formation nommée : par instrument, le
 * nombre d'observations, la première et la dernière, et l'étiquette PDS de la première, qui est
 * la source primaire. Ce script ne demande RIEN au réseau.
 *
 * La géométrie n'est pas recopiée : elle est importée de `src/core/placeObservation.ts`, qui porte
 * ses tests et la règle de l'antipode (un produit qui couvre aussi l'antipode d'un lieu ne
 * l'observe pas).
 *
 * Le rayon de chaque corps est lu dans sa fiche du registre (`facts.radiusKm`), jamais écrit ici.
 *
 * `--partial` accepte un tirage incomplet (développement : rien ne doit être livré ainsi, et
 * l'index le DIT) ; `--only <corps>`.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'ode-footprints');
const GAZ = join(ROOT, 'public', 'assets', 'gazetteer');
const OUT = join(ROOT, 'public', 'assets', 'place-observations');
const INDEX = join(ROOT, 'src', 'config', 'placeObservationIndex.json');
const PAGE = 5000;
/** Poids visé par morceau servi : une formation demandée ne doit pas coûter le corps entier. */
const SHARD_TARGET = 256 * 1024;
/** Le corps du catalogue pour chaque base de métadonnées de l'ODE. */
const BODY = { Moon: 'moon', Mars: 'mars', Mercury: 'mercury', Venus: 'venus' };

const args = process.argv.slice(2);
const PARTIAL = args.includes('--partial');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': join(ROOT, 'src') } },
});
const { observesShapes } = await loader.ssrLoadModule(
  '/src/core/placeObservation.ts'
);
await loader.close();

/**
 * UNE ÉTIQUETTE EN `http://` N'EST PAS RÉÉCRITE À L'AVEUGLE. Le bloc n'affiche qu'un lien `https`,
 * donc ces observations perdaient leur source à l'écran. Un hôte n'est passé en `https` que si la
 * MÊME ressource y est servie, octet pour octet, et c'est mesuré : `static.mars.asu.edu` (THEMIS),
 * 10 732 octets identiques des deux côtés, le 2026-10-01. Tout autre hôte en `http` fait ÉCHOUER
 * le générateur, pour être vérifié au lieu d'être deviné.
 */
const HTTPS_VERIFIED = new Set(['static.mars.asu.edu']);
function secureLabel(url) {
  if (!url || url.startsWith('https://')) return url;
  const m = /^http:\/\/([^/]+)(\/.*)$/.exec(url);
  if (m && HTTPS_VERIFIED.has(m[1])) return `https://${m[1]}${m[2]}`;
  throw new Error(`étiquette hors https sur un hôte non vérifié : ${url}`);
}

const safe = (k) => k.replace(/[^A-Za-z0-9_.-]+/g, '_');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
/** Le gel du tirage, lu dans le cache du tirage et jamais recopié. */
const FROZEN_AT = readJson(join(CACHE, 'freeze.json')).maxcreationtime;

const iipt = readJson(join(CACHE, 'iipt.json')).ODEResults.IIPTSets.IIPTSet;
/** Les jeux que l'ODE n'a servis par AUCUNE route au tirage, avec l'erreur mesuree : publies. */
const unavailableFile = join(CACHE, 'unavailable.json');
const unavailable = existsSync(unavailableFile)
  ? readJson(unavailableFile)
  : {};
const counts = readJson(join(CACHE, 'counts.json'));
const redundancy = readJson(join(CACHE, 'redundancy.json'));
const names = new Map();
for (const s of iipt)
  names.set(`${s.ODEMetaDB}|${s.IHID}|${s.IID}`, {
    mission: s.IHName,
    instrument: s.IName,
  });

/** Grille de 1° : cellule → formations dont le disque peut toucher la cellule. */
function gridOf(features, radiusKm) {
  const grid = new Map();
  const kmPerDeg = (radiusKm * Math.PI) / 180;
  features.forEach((f, idx) => {
    const dLat = f.diameterKm / 2 / kmPerDeg + 0.01;
    const lat0 = Math.max(-90, Math.floor(f.lat - dLat));
    const lat1 = Math.min(89, Math.floor(f.lat + dLat));
    const cos = Math.cos(
      (Math.min(89.9, Math.abs(f.lat) + dLat) * Math.PI) / 180
    );
    const dLon = Math.min(180, dLat / Math.max(cos, 1e-6));
    const allLon = dLon >= 180 || Math.abs(f.lat) + dLat >= 89;
    for (let la = lat0; la <= lat1; la++) {
      if (allLon) {
        for (let lo = 0; lo < 360; lo++) push(grid, la, lo, idx);
      } else {
        for (
          let lo = Math.floor(f.lon - dLon);
          lo <= Math.floor(f.lon + dLon);
          lo++
        )
          push(grid, la, ((lo % 360) + 360) % 360, idx);
      }
    }
  });
  return grid;
}
function push(grid, la, lo, idx) {
  const k = la * 360 + lo;
  const a = grid.get(k);
  if (a) a.push(idx);
  else grid.set(k, [idx]);
}

/**
 * Les formations candidates d'un produit. Une SURFACE se prend par sa boîte (les anneaux `ga` ne
 * traversent jamais le méridien 0). Une TRACE se prend LE LONG de ses segments : sa boîte, pour
 * une trace de MARSIS qui traverse la planète, couvrirait des milliers de formations qu'elle ne
 * frôle pas, et elle TRAVERSE le méridien, ce qui rendrait la boîte fausse.
 */
function candidates(grid, rings, kind) {
  const out = new Set();
  const take = (lat, lon) => {
    const la = Math.max(-90, Math.min(89, Math.floor(lat)));
    const lo = ((Math.floor(lon) % 360) + 360) % 360;
    const a = grid.get(la * 360 + lo);
    if (a) for (const i of a) out.add(i);
  };
  if (kind === 'l' || kind === 'p') {
    for (const track of rings) {
      track.forEach(([lon, lat], k) => {
        take(lat, lon);
        if (k === 0) return;
        const [lon0, lat0] = track[k - 1];
        let dLon = lon - lon0;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const steps = Math.ceil(
          Math.max(Math.abs(dLon), Math.abs(lat - lat0)) / 0.5
        );
        for (let s = 1; s < steps; s++)
          take(lat0 + ((lat - lat0) * s) / steps, lon0 + (dLon * s) / steps);
      });
    }
    return out;
  }
  for (const ring of rings) {
    let w = 360;
    let e = 0;
    let s = 90;
    let n = -90;
    for (const [lon, lat] of ring) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
    for (
      let la = Math.max(-90, Math.floor(s));
      la <= Math.min(89, Math.floor(n));
      la++
    )
      for (
        let lo = Math.max(0, Math.floor(w));
        lo <= Math.min(359, Math.floor(e));
        lo++
      ) {
        const a = grid.get(la * 360 + lo);
        if (a) for (const i of a) out.add(i);
      }
  }
  return out;
}

function* products(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ndjson.gz'))
    .sort((a, b) => parseInt(a) - parseInt(b));
  for (const f of files) {
    const text = gunzipSync(readFileSync(join(dir, f))).toString();
    for (const line of text.split('\n')) if (line) yield JSON.parse(line);
  }
}

const bodyRadius = (body) => {
  const r = readJson(join(ROOT, 'src', 'registry', 'entities', `${body}.json`))
    .facts?.radiusKm?.value;
  if (!Number.isFinite(r))
    throw new Error(`${body} : pas de facts.radiusKm dans sa fiche`);
  return r;
};

const summary = {
  provider: {
    publisher: 'NASA PDS Geosciences Node, Washington University in St. Louis',
    title: 'Orbital Data Explorer (ODE) REST interface',
    url: 'https://oderest.rsl.wustl.edu/',
    /**
     * Une requete REELLE et legere que `pnpm sources:health` rejoue pour savoir si le service
     * repond encore : ce guetteur la relit ici, personne ne la tient a deux endroits.
     */
    api: 'https://oderest.rsl.wustl.edu/live2/?query=product&results=c&output=JSON&target=moon&IHID=LRO&IID=LROC&PT=EDRNAC4',
  },
  frozenAt: FROZEN_AT,
  unavailable: Object.entries(unavailable).map(([key, u]) => ({
    key,
    products: counts[key],
    error: u.error,
    at: u.at,
  })),
  bodies: {},
  complete: true,
};
mkdirSync(OUT, { recursive: true });

for (const [db, body] of Object.entries(BODY)) {
  if (ONLY && ONLY !== body) continue;
  const features = readJson(join(GAZ, `${body}.json`));
  const R = bodyRadius(body);
  const grid = gridOf(features, R);
  const keys = Object.keys(counts).filter(
    (k) =>
      k.startsWith(`${db}|`) &&
      counts[k] > 0 &&
      redundancy[k]?.verdict !== 'redundant' &&
      !unavailable[k]
  );
  const instruments = [];
  const instIndex = new Map();
  const agg = features.map(() => new Map());
  let seen = 0;
  let global = 0;
  let missingPages = 0;
  const t0 = Date.now();
  for (const key of keys) {
    const dir = join(CACHE, 'pages', safe(key));
    const expected = Math.ceil(counts[key] / PAGE);
    const have = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.gz')).length
      : 0;
    missingPages += expected - have;
    if (!have) continue;
    const [, IHID, IID] = key.split('|');
    const ik = `${db}|${IHID}|${IID}`;
    if (!instIndex.has(ik)) {
      instIndex.set(ik, instruments.length);
      instruments.push({ host: IHID, id: IID, ...names.get(ik) });
    }
    const inst = instIndex.get(ik);
    const ids = new Set();
    for (const p of products(dir)) {
      if (ids.has(p.id)) continue;
      ids.add(p.id);
      seen++;
      const cands = new Set();
      for (const [kind, rings] of Object.entries(p.shapes))
        for (const i of candidates(grid, rings, kind)) cands.add(i);
      for (const i of cands) {
        const v = observesShapes(p.shapes, features[i], R);
        if (v === 'none') continue;
        if (v === 'global') {
          global++;
          continue;
        }
        /**
         * PREMIER DÉPART, DERNIÈRE FIN. Un produit porte un INTERVALLE : les produits dérivés de
         * MOLA déclarent 1997-09-15 → 2001-06-30, toute la mission, et n'en lire que le départ
         * faisait croire à une seule journée. Une date ABSENTE le reste : Viking Orbiter n'en
         * publie aucune dans l'ODE, et rien ici n'en invente.
         */
        const m = agg[i];
        const e = m.get(inst);
        const t0 = p.t0 || '';
        const t1 = p.t1 || t0;
        if (!e) m.set(inst, { n: 1, first: t0, last: t1, label: p.label });
        else {
          e.n++;
          if (t0 && (!e.first || t0 < e.first)) {
            e.first = t0;
            e.label = p.label;
          }
          if (t1 > e.last) e.last = t1;
        }
      }
    }
  }
  const observed = {};
  let withAny = 0;
  features.forEach((f, i) => {
    if (!agg[i].size) return;
    withAny++;
    observed[f.iauId] = [...agg[i]]
      // Les instruments sans date en DERNIER : les trier avant tous serait les dire les premiers.
      .sort((a, b) => {
        // Comparaison BRUTE et non `localeCompare` : celle-ci range « ~ » AVANT les chiffres, et les
        // instruments sans date (Viking) sortaient en tête au lieu de la fin. Mesuré sur Jezero.
        const x = a[1].first || '\uffff';
        const y = b[1].first || '\uffff';
        return x < y ? -1 : x > y ? 1 : 0;
      })
      .map(([inst, e]) => [
        inst,
        e.n,
        e.first.slice(0, 10),
        e.last.slice(0, 10),
        secureLabel(e.label),
      ]);
  });
  /**
   * EN MORCEAUX, parce qu'une seule formation est demandée à la fois : le fichier de la Lune porte
   * des milliers de formations, et le servir entier pour en lire une ferait payer au visiteur ce
   * qu'il ne lit pas. Le nombre de morceaux se DÉRIVE du poids (cible SHARD_TARGET), et la
   * formation se retrouve par `iauId % shards`, que l'index publie.
   */
  const whole = Buffer.byteLength(JSON.stringify(observed));
  const shards = Math.max(1, Math.ceil(whole / SHARD_TARGET));
  const dir = join(OUT, body);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (let k = 0; k < shards; k++) {
    const part = {};
    for (const [id, v] of Object.entries(observed))
      if (Number(id) % shards === k) part[id] = v;
    const text = JSON.stringify({ instruments, observed: part });
    bytes += Buffer.byteLength(text);
    writeFileSync(join(dir, `${k}.json`), text);
  }
  summary.bodies[body] = {
    formations: features.length,
    observed: withAny,
    instruments: instruments.length,
    products: seen,
    globalExcluded: global,
    shards,
    bytes,
    missingPages,
  };
  console.log(
    `${body} : ${withAny}/${features.length} formations observées, ${seen} produits lus, ` +
      `${global} couples écartés comme globaux, ${missingPages} pages manquantes, ` +
      `${shards} morceaux, ${bytes} o, ${((Date.now() - t0) / 1000).toFixed(0)} s`
  );
}

/**
 * `--only` NE REMPLACE QUE SON CORPS. La premiere version reecrivait l'index avec le seul corps
 * traite : lance sur Venus, elle effacait la Lune, et le bloc de la Lune se declarait alors « non
 * couvert », a juste titre pour un index faux. Les autres corps sont repris de l'index existant,
 * et la completude se DERIVE de tous : chaque corps couvert present, aucune page manquante.
 */
if (ONLY && existsSync(INDEX)) {
  const previous = readJson(INDEX);
  for (const [body, entry] of Object.entries(previous.bodies ?? {}))
    if (!(body in summary.bodies)) summary.bodies[body] = entry;
}
summary.complete = Object.values(BODY).every(
  (body) => summary.bodies[body] && summary.bodies[body].missingPages === 0
);
if (!summary.complete && !PARTIAL) {
  console.error(
    'Tirage incomplet : relancer `node scripts/pull-ode-footprints.mjs`, ou --partial.'
  );
  process.exit(1);
}
// Ecrit MEME en `--partial`, avec `complete: false` : c'est `config/placeObservations.test.ts`
// qui refuse de livrer un index incomplet, et une garde vaut mieux qu'une consigne.
writeFileSync(INDEX, JSON.stringify(summary, null, 1) + '\n');
