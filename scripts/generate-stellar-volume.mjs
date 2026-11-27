#!/usr/bin/env node
/* global console, fetch, process, URLSearchParams */
/**
 * LE VOLUME STELLAIRE ÉTENDU (GAL-UNIVERSE-008) : les étoiles à 100 parsecs ou moins, d'après le
 * Gaia Catalogue of Nearby Stars (GCNS), et les étoiles très brillantes qu'il ne contient pas.
 *
 *   pnpm stellar:volume              # lit le cache .cache/stellar-volume/ sinon interroge les archives
 *   pnpm stellar:volume -- --check   # code 1 si les fichiers livrés ne sont plus ceux qu'on écrirait
 *   pnpm stellar:volume -- --refresh # interroge de nouveau les archives
 *
 * SOURCE PRINCIPALE : le GCNS (Gaia Collaboration, Smart et al. 2021, A&A 649, A6), construit sur Gaia
 * EDR3 précisément pour les 100 pc. Il ne prend PAS l'inverse de la parallaxe : chaque objet a une
 * distribution de probabilité de sa distance (médiane `dist_50`, centiles 16 et 84), et une
 * probabilité que son astrométrie soit fiable. On garde les objets dont la MÉDIANE est à 100 pc ou
 * moins (le catalogue en contient d'autres, dont seul le premier centile y entre). Lu au service TAP
 * de GAVO (Heidelberg), qui le publie (`gcns.main`) ; l'archive de l'ESA et le TAP de VizieR ne
 * répondaient pas le 2026-11-27 (mesuré : page HTML à la place de résultats, et délai dépassé).
 *
 * CE QUE LE GCNS N'A PAS : les étoiles trop brillantes pour Gaia (Véga, Arcturus…). Ses auteurs les
 * listent (`gcns.missing_10mas` : parallaxe publiée > 10 mas, absente d'EDR3). Pour celles qu'on
 * retrouve dans HYG v4.4 (Hipparcos), on prend la ligne HYG (magnitude V, B−V, mouvement, vitesse
 * radiale, distance 1/parallaxe d'Hipparcos : précise pour ces étoiles, et dite telle). Les autres
 * gardent la seule position et la parallaxe de SIMBAD : ni magnitude, ni couleur, ni mouvement.
 * Les 61 étoiles du voisinage à 5 pc (`neighbours.json`) sont déjà dans la vue : on retire du volume
 * celles qui y sont, par identifiant Gaia DR3 quand le voisinage en porte un ; sinon (étoile restée à
 * HYG, ε Eridani, τ Ceti) par position ramenée à J2000 (< 30″) ET distance (écart < 20 %).
 *
 * NOMS : HYG (nom propre, Bayer, Gliese, HD, HIP), rapproché du GCNS par la position Gaia ramenée à
 * J2000 et la distance (écart < 25 %). Hôtes d'exoplanètes : jointure EXACTE sur `gaia_dr3_id` de la
 * table `pscomppars` de la NASA Exoplanet Archive.
 *
 * FORMAT (lu par `core/stellarVolume.ts`) : coquilles binaires par distance (25, 50, 100 pc), 16 octets
 * par étoile, position ET vitesse ÉQUATORIALES (ICRS) à J2016,0 : le client les tourne dans le repère
 * galactique avec le même code que le voisinage à 5 pc (`core/stellarSpace`), donc les deux vues sont
 * cohérentes par construction. Les détails (identifiant Gaia, parallaxe, centiles de distance, RUWE,
 * probabilités) sont dans des paquets binaires de 4 096 étoiles, chargés à la sélection.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseCsv, propagate } from './generate-neighbours.mjs';
import { sameIgnoringReadDates } from './drift-compare.mjs';
import { gunzipSync } from 'node:zlib';

const CACHE = '.cache/stellar-volume';
const OUT = 'public/assets/sky/volume';
const GAVO = 'https://dc.zah.uni-heidelberg.de/tap/sync';
const NASA = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
const HYG_CACHE = '.cache/star-catalogue/hyg_v44.csv.gz';
const NEIGHBOURS = 'public/assets/sky/neighbours.json';

/** Les coquilles : rayon extérieur (pc). La vue charge la suivante quand le champ s'élargit. */
export const SHELLS_PC = [25, 50, 100];
export const MAX_DISTANCE_PC = 100;
/** Octets par étoile dans une coquille, et par étoile dans un paquet de détails. */
export const RECORD_BYTES = 16;
export const DETAIL_BYTES = 24;
export const DETAIL_BUCKET = 4096;
/** Quantification : position (pc × 300, ±109 pc, pas 0,0033 pc), vitesse (km/s × 20, pas 0,05 km/s). */
export const POSITION_SCALE = 300;
export const VELOCITY_SCALE = 20;
/** Époque des positions et des vitesses (Gaia EDR3 / DR3). */
export const EPOCH_YEAR = 2016;
/** Constante astrométrique : km/s pour 1 seconde d'arc par an à 1 pc. */
const K_ASTRO = 4.740470446;

export const FLAGS = {
  radialVelocity: 1,
  whiteDwarf: 2,
  exoplanetHost: 4,
  hyg: 8,
  simbadOnly: 16,
  colourBV: 32,
  named: 64,
};
/** Seuil de la probabilité de naine blanche du GCNS (`wd_prob`) pour le drapeau. */
const WD_THRESHOLD = 0.5;

const GCNS_COLUMNS = [
  'source_id',
  'ra',
  'dec',
  'parallax',
  'parallax_error',
  'pmra',
  'pmdec',
  'phot_g_mean_mag',
  'phot_bp_mean_mag',
  'phot_rp_mean_mag',
  'ruwe',
  'adoptedrv',
  'adoptedrv_error',
  'gcns_prob',
  'wd_prob',
  'dist_16',
  'dist_50',
  'dist_84',
  'xcoord_50',
  'ycoord_50',
  'zcoord_50',
];
/** Tranches de lecture (kpc, `dist_50`) : quatre requêtes plutôt qu'une longue sur un service public. */
const SLICES_KPC = [
  [0, 0.025],
  [0.025, 0.05],
  [0.05, 0.075],
  [0.075, 0.1],
];

const ACKNOWLEDGEMENT =
  'This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.';
const NASA_ACK =
  'This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program.';

/**
 * Témoins PHYSIQUES (ordre de grandeur que n'importe quel ouvrage donne, tolérance large) : ils ne
 * fixent aucune valeur, ils font échouer bruyamment une unité, un tri ou une jointure qui dérive.
 */
export const WITNESSES = [
  { name: 'Vega', pc: [7.4, 7.9] },
  { name: 'Arcturus', pc: [10.9, 11.6] },
  { name: 'Altair', pc: [5.0, 5.3] },
  { name: 'Fomalhaut', pc: [7.4, 7.9] },
  { name: 'Pollux', pc: [10.0, 10.7] },
  { name: 'Aldebaran', pc: [19.5, 21] },
];

const num = (s) => (s === '' || s === undefined ? NaN : Number(s));

async function tap(url, params, file, refresh) {
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  if (!res.ok || !/^[a-z_"]+,/.test(text))
    throw new Error(
      `${url} : réponse inattendue (${res.status}, ${res.headers.get('content-type')}) : ${text.slice(0, 120)}`
    );
  writeFileSync(file, text);
  writeFileSync(`${file}.retrieved`, new Date().toISOString().slice(0, 10));
  return text;
}

function retrievedOf(file) {
  return existsSync(`${file}.retrieved`)
    ? readFileSync(`${file}.retrieved`, 'utf8').trim()
    : '2026-11-27';
}

function table(text) {
  const [header, ...rows] = parseCsv(text);
  const col = Object.fromEntries(header.map((name, i) => [name, i]));
  return { col, rows };
}

/** Vecteur unitaire et base locale (α, δ) d'une direction équatoriale. */
function basis(raDeg, decDeg) {
  const a = (raDeg * Math.PI) / 180;
  const d = (decDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cd = Math.cos(d);
  const sd = Math.sin(d);
  return {
    r: [cd * ca, cd * sa, sd],
    ea: [-sa, ca, 0],
    ed: [-sd * ca, -sd * sa, cd],
  };
}

/**
 * Position (pc) et vitesse (km/s) ÉQUATORIALES d'une étoile. `pmRa` est déjà × cos δ (convention de
 * Gaia et de HYG). Une vitesse radiale absente vaut zéro et l'étoile porte le drapeau contraire :
 * le mouvement est alors tangentiel seulement, comme dans le voisinage à 5 pc.
 */
export function stateOf(raDeg, decDeg, distPc, pmRa, pmDec, rvKms) {
  const { r, ea, ed } = basis(raDeg, decDeg);
  const vRa = (K_ASTRO * pmRa * distPc) / 1000;
  const vDec = (K_ASTRO * pmDec * distPc) / 1000;
  const vr = Number.isFinite(rvKms) ? rvKms : 0;
  return {
    position: r.map((c) => c * distPc),
    velocity: [0, 1, 2].map((i) => vr * r[i] + vRa * ea[i] + vDec * ed[i]),
  };
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Une étoile, en 16 octets (petit-boutiste) : voir `core/stellarVolume.ts`. */
export function encodeRecord(view, offset, s) {
  for (let i = 0; i < 3; i++) {
    view.setInt16(
      offset + 2 * i,
      clampInt(s.position[i] * POSITION_SCALE, -32767, 32767),
      true
    );
    view.setInt16(
      offset + 6 + 2 * i,
      clampInt((s.velocity?.[i] ?? 0) * VELOCITY_SCALE, -32767, 32767),
      true
    );
  }
  view.setUint8(
    offset + 12,
    Number.isFinite(s.mag) ? clampInt(s.mag * 10, 0, 254) : 255
  );
  view.setInt8(
    offset + 13,
    Number.isFinite(s.colour) ? clampInt(s.colour * 25, -127, 127) : -128
  );
  view.setUint8(offset + 14, s.flags);
  view.setUint8(
    offset + 15,
    Number.isFinite(s.relErr) ? clampInt(s.relErr * 1000, 0, 254) : 255
  );
}

/** Les détails d'une étoile, en 24 octets : voir `core/stellarVolume.ts`. */
export function encodeDetail(view, offset, s) {
  view.setBigInt64(offset, BigInt(s.sourceId ?? 0), true);
  view.setFloat32(
    offset + 8,
    Number.isFinite(s.parallax) ? s.parallax : NaN,
    true
  );
  const u16 = (o, v, scale) =>
    view.setUint16(
      offset + o,
      Number.isFinite(v) ? clampInt(v * scale, 0, 65534) : 65535,
      true
    );
  u16(12, s.parallaxError, 10000);
  u16(14, s.distLow, 1000);
  u16(16, s.distHigh, 1000);
  u16(18, s.ruwe, 1000);
  view.setUint8(
    offset + 20,
    Number.isFinite(s.wdProb) ? clampInt(s.wdProb * 200, 0, 254) : 255
  );
  view.setUint8(
    offset + 21,
    Number.isFinite(s.gcnsProb) ? clampInt(s.gcnsProb * 200, 0, 254) : 255
  );
  u16(22, s.rvError, 100);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Index spatial grossier (ra, dec en cases de 0,05°) pour les rapprochements par position. */
function skyIndex(stars) {
  const cell = (ra, dec) =>
    `${Math.floor(ra / 0.05)}:${Math.floor(dec / 0.05)}`;
  const map = new Map();
  stars.forEach((s, i) => {
    const k = cell(s.ra2000, s.dec2000);
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(i);
  });
  return {
    near(ra, dec) {
      const out = [];
      const cx = Math.floor(ra / 0.05);
      const cy = Math.floor(dec / 0.05);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const list = map.get(`${cx + dx}:${cy + dy}`);
          if (list) out.push(...list);
        }
      return out;
    },
  };
}

function separationDeg(ra1, dec1, ra2, dec2) {
  const d2r = Math.PI / 180;
  const x =
    Math.sin(dec1 * d2r) * Math.sin(dec2 * d2r) +
    Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * Math.cos((ra1 - ra2) * d2r);
  return Math.acos(Math.min(1, x)) / d2r;
}

/** Nom HYG lisible : nom propre, sinon Bayer + constellation, sinon Gliese, HD, HIP. */
function hygName(r, col) {
  const proper = r[col.proper];
  if (proper) return proper;
  const bayer = r[col.bayer];
  const con = r[col.con];
  if (bayer && con) return `${bayer} ${con}`;
  const flam = r[col.flam];
  if (flam && con) return `${flam} ${con}`;
  if (r[col.gl]) return r[col.gl];
  if (r[col.hd]) return `HD ${r[col.hd]}`;
  if (r[col.hip]) return `HIP ${r[col.hip]}`;
  return null;
}

export async function build({ refresh = false } = {}) {
  mkdirSync(CACHE, { recursive: true });
  // ---- GCNS, en quatre tranches
  const gcns = [];
  for (const [lo, hi] of SLICES_KPC) {
    const file = `${CACHE}/gcns-${lo}-${hi}.csv`;
    const text = await tap(
      GAVO,
      {
        REQUEST: 'doQuery',
        LANG: 'ADQL',
        FORMAT: 'csv',
        MAXREC: '1000000',
        QUERY: `SELECT ${GCNS_COLUMNS.join(', ')} FROM gcns.main WHERE dist_50 > ${lo} AND dist_50 <= ${hi}`,
      },
      file,
      refresh
    );
    const { col, rows } = table(text);
    for (const r of rows) gcns.push({ r, col });
  }
  const gcnsRetrieved = retrievedOf(`${CACHE}/gcns-0-0.025.csv`);
  const missingFile = `${CACHE}/missing-10mas.csv`;
  const missing = table(
    await tap(
      GAVO,
      {
        REQUEST: 'doQuery',
        LANG: 'ADQL',
        FORMAT: 'csv',
        MAXREC: '100000',
        QUERY:
          'SELECT main_id, ra, dec, plx_value, plx_bibcode, otype FROM gcns.missing_10mas',
      },
      missingFile,
      refresh
    )
  );
  const hostsFile = `${CACHE}/exoplanet-hosts.csv`;
  const hosts = table(
    await tap(
      NASA,
      {
        query:
          'select hostname, gaia_dr3_id, sy_pnum, sy_dist from pscomppars where sy_dist<=110 and gaia_dr3_id is not null',
        format: 'csv',
      },
      hostsFile,
      refresh
    )
  );

  // ---- voisinage déjà livré : retiré du volume par identifiant Gaia
  const neighbours = JSON.parse(readFileSync(NEIGHBOURS, 'utf8'));
  const gaiaField = neighbours.fields.indexOf('gaiaSourceId');
  const inNeighbourhood = new Set(
    neighbours.stars.map((s) => s[gaiaField]).filter(Boolean)
  );
  const nf = Object.fromEntries(neighbours.fields.map((f, i) => [f, i]));
  const hygNeighbours = neighbours.stars
    .filter((s) => !s[gaiaField])
    .map((s) => ({ ra: s[nf.raDeg], dec: s[nf.decDeg], dist: s[nf.distPc] }));
  const isHygNeighbour = (ra2000, dec2000, dist) =>
    hygNeighbours.some(
      (h) =>
        separationDeg(h.ra, h.dec, ra2000, dec2000) < 30 / 3600 &&
        Math.abs(h.dist - dist) / h.dist < 0.2
    );

  // ---- hôtes d'exoplanètes, par identifiant Gaia DR3 exact
  // Une ligne de `pscomppars` = une planète. Le nombre de planètes d'un HÔTE est donc le nombre de ses
  // lignes ; `sy_pnum` compte celles du SYSTÈME (55 Cnc : 7 = 5 autour de 55 Cnc A + 2 autour de 55 Cnc B).
  const hostById = new Map();
  for (const r of hosts.rows) {
    const id = r[hosts.col.gaia_dr3_id].replace(/^Gaia DR3 /, '');
    if (!/^\d+$/.test(id)) continue;
    const known = hostById.get(id);
    if (known) known.planets++;
    else hostById.set(id, { host: r[hosts.col.hostname], planets: 1 });
  }

  const stars = [];
  let removedNeighbours = 0;
  for (const { r, col } of gcns) {
    const sourceId = r[col.source_id];
    if (inNeighbourhood.has(sourceId)) {
      removedNeighbours++;
      continue;
    }
    const d50 = num(r[col.dist_50]) * 1000;
    if (!(d50 > 0 && d50 <= MAX_DISTANCE_PC)) continue;
    const d16 = num(r[col.dist_16]) * 1000;
    const d84 = num(r[col.dist_84]) * 1000;
    const ra = num(r[col.ra]);
    const dec = num(r[col.dec]);
    const pmRa = num(r[col.pmra]);
    const pmDec = num(r[col.pmdec]);
    const rv = num(r[col.adoptedrv]);
    const state = stateOf(ra, dec, d50, pmRa, pmDec, rv);
    const bp = num(r[col.phot_bp_mean_mag]);
    const rp = num(r[col.phot_rp_mean_mag]);
    const wdProb = num(r[col.wd_prob]);
    const host = hostById.get(sourceId);
    const back = propagate(ra, dec, pmRa, pmDec, 2000 - EPOCH_YEAR);
    if (isHygNeighbour(back.raDeg, back.decDeg, d50)) {
      removedNeighbours++;
      continue;
    }
    stars.push({
      origin: 'gcns',
      sourceId,
      ra2000: back.raDeg,
      dec2000: back.decDeg,
      distPc: d50,
      position: state.position,
      velocity: state.velocity,
      mag: num(r[col.phot_g_mean_mag]),
      colour: bp - rp,
      relErr: (d84 - d16) / 2 / d50,
      flags:
        (Number.isFinite(rv) ? FLAGS.radialVelocity : 0) |
        (wdProb > WD_THRESHOLD ? FLAGS.whiteDwarf : 0) |
        (host ? FLAGS.exoplanetHost : 0),
      parallax: num(r[col.parallax]),
      parallaxError: num(r[col.parallax_error]),
      distLow: d50 - d16,
      distHigh: d84 - d50,
      ruwe: num(r[col.ruwe]),
      wdProb,
      gcnsProb: num(r[col.gcns_prob]),
      rvError: num(r[col.adoptedrv_error]),
      host,
      gcnsXyz: [
        num(r[col.xcoord_50]),
        num(r[col.ycoord_50]),
        num(r[col.zcoord_50]),
      ],
      name: null,
    });
  }

  // ---- HYG : noms, et étoiles très brillantes absentes d'EDR3
  const hygText = gunzipSync(readFileSync(HYG_CACHE)).toString('utf8');
  const hyg = table(hygText);
  const hc = hyg.col;
  const index = skyIndex(stars);
  const hygRows = hyg.rows.filter((r) => {
    const d = Number(r[hc.dist]);
    return d > 0 && d <= MAX_DISTANCE_PC * 1.25 && r[hc.id] !== '0';
  });
  const named = new Set();
  const hygUnmatched = [];
  for (const r of hygRows) {
    const ra = Number(r[hc.rarad]) * (180 / Math.PI);
    const dec = Number(r[hc.decrad]) * (180 / Math.PI);
    const dist = Number(r[hc.dist]);
    const name = hygName(r, hc);
    let best = -1;
    let bestSep = 3 / 3600;
    for (const i of index.near(ra, dec)) {
      const s = stars[i];
      const sep = separationDeg(ra, dec, s.ra2000, s.dec2000);
      if (sep < bestSep && Math.abs(s.distPc - dist) / dist < 0.25) {
        best = i;
        bestSep = sep;
      }
    }
    if (best >= 0) {
      if (name && !named.has(best)) {
        stars[best].name = name;
        named.add(best);
      }
    } else hygUnmatched.push({ r, ra, dec, dist, name });
  }

  // ---- les absentes d'EDR3 listées par le GCNS : ligne HYG si on la retrouve, sinon SIMBAD seul
  let fromHyg = 0;
  let fromSimbad = 0;
  for (const m of missing.rows) {
    const plx = num(m[missing.col.plx_value]);
    if (!(plx >= 1000 / MAX_DISTANCE_PC)) continue;
    const ra = num(m[missing.col.ra]);
    const dec = num(m[missing.col.dec]);
    const dist = 1000 / plx;
    if (isHygNeighbour(ra, dec, dist)) {
      removedNeighbours++;
      continue;
    }
    const match = hygUnmatched.find(
      (h) =>
        separationDeg(ra, dec, h.ra, h.dec) < 30 / 3600 &&
        Math.abs(h.dist - dist) / dist < 0.25
    );
    if (match) {
      const r = match.r;
      const pmRa = Number(r[hc.pmra]);
      const pmDec = Number(r[hc.pmdec]);
      const rvRaw = r[hc.rv];
      // HYG écrit 0 pour une vitesse radiale inconnue : un zéro n'est pas une mesure.
      const rv = rvRaw !== '' && Number(rvRaw) !== 0 ? Number(rvRaw) : NaN;
      const at2016 = propagate(
        match.ra,
        match.dec,
        pmRa,
        pmDec,
        EPOCH_YEAR - 2000
      );
      const state = stateOf(
        at2016.raDeg,
        at2016.decDeg,
        match.dist,
        pmRa,
        pmDec,
        rv
      );
      const bv = num(r[hc.ci]);
      stars.push({
        origin: 'hyg',
        sourceId: null,
        ra2000: match.ra,
        dec2000: match.dec,
        distPc: match.dist,
        position: state.position,
        velocity: state.velocity,
        mag: num(r[hc.mag]),
        colour: bv,
        relErr: NaN,
        flags:
          FLAGS.hyg |
          FLAGS.colourBV |
          (Number.isFinite(rv) ? FLAGS.radialVelocity : 0),
        parallax: 1000 / match.dist,
        name: match.name ?? m[missing.col.main_id],
        simbad: m[missing.col.main_id],
        spectral: r[hc.spect] || null,
      });
      fromHyg++;
    } else {
      const state = stateOf(ra, dec, dist, 0, 0, NaN);
      stars.push({
        origin: 'simbad',
        sourceId: null,
        ra2000: ra,
        dec2000: dec,
        distPc: dist,
        position: state.position,
        velocity: null,
        mag: NaN,
        colour: NaN,
        relErr: NaN,
        flags: FLAGS.simbadOnly,
        parallax: plx,
        name: m[missing.col.main_id],
        simbad: m[missing.col.main_id],
        otype: m[missing.col.otype],
      });
      fromSimbad++;
    }
  }

  // ---- ordre : par distance, puis coquilles. Une ligne HYG peut porter une distance d'Hipparcos au-delà
  // de 100 pc alors que la parallaxe de SIMBAD la plaçait dedans : la distance retenue fait foi.
  const beyond = stars.filter((s) => !(s.distPc <= MAX_DISTANCE_PC)).length;
  for (let i = stars.length - 1; i >= 0; i--)
    if (!(stars[i].distPc <= MAX_DISTANCE_PC)) {
      if (stars[i].origin === 'hyg') fromHyg--;
      else if (stars[i].origin === 'simbad') fromSimbad--;
      stars.splice(i, 1);
    }
  stars.sort((a, b) => a.distPc - b.distPc);
  for (const s of stars) {
    if (s.name || s.host) s.flags |= FLAGS.named;
  }
  const shells = [];
  let start = 0;
  for (const maxPc of SHELLS_PC) {
    let end = start;
    while (end < stars.length && stars[end].distPc <= maxPc) end++;
    const buf = Buffer.alloc((end - start) * RECORD_BYTES);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = start; i < end; i++)
      encodeRecord(view, (i - start) * RECORD_BYTES, stars[i]);
    shells.push({ maxPc, start, count: end - start, buf });
    start = end;
  }
  const details = [];
  for (let b = 0; b * DETAIL_BUCKET < stars.length; b++) {
    const from = b * DETAIL_BUCKET;
    const to = Math.min(stars.length, from + DETAIL_BUCKET);
    const buf = Buffer.alloc((to - from) * DETAIL_BYTES);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = from; i < to; i++)
      encodeDetail(view, (i - from) * DETAIL_BYTES, stars[i]);
    details.push(buf);
  }
  // Les noms (et l'hôte d'exoplanètes) : un fichier, pour la recherche ; indice global → entrée.
  const names = {};
  // Entrée : [nom], ou [nom, hôte, planètes] pour un hôte d'exoplanètes, ou [nom, hôte ou null, planètes,
  // type spectral] quand la source publie un type (lignes HYG : le GCNS n'en publie aucun).
  stars.forEach((s, i) => {
    if (!(s.flags & FLAGS.named)) return;
    const base = s.host
      ? [s.name ?? s.host.host, s.host.host, s.host.planets]
      : [s.name];
    names[i] = s.spectral
      ? [
          base[0],
          s.host ? s.host.host : null,
          s.host ? s.host.planets : 0,
          s.spectral,
        ]
      : base;
  });

  // ---- témoins : étoiles nommées (physiques) et repère galactique du GCNS (indépendant)
  const byName = (n) => stars.findIndex((s) => s.name === n);
  for (const w of WITNESSES) {
    const i = byName(w.name);
    if (i < 0) throw new Error(`témoin absent du volume : ${w.name}`);
    const d = stars[i].distPc;
    if (d < w.pc[0] || d > w.pc[1])
      throw new Error(
        `témoin ${w.name} à ${d.toFixed(2)} pc, hors de [${w.pc}]`
      );
  }
  const gcnsWitnesses = [];
  for (const pc of [3, 12, 24, 37, 49, 61, 74, 88, 99]) {
    const i = stars.findIndex((s) => s.origin === 'gcns' && s.distPc >= pc);
    const s = stars[i];
    gcnsWitnesses.push({
      index: i,
      sourceId: s.sourceId,
      distPc: Number(s.distPc.toFixed(4)),
      galacticXyzPc: s.gcnsXyz.map((v) => Number(v.toFixed(4))),
    });
  }

  const count = (pred) => stars.filter(pred).length;
  const manifest = {
    $comment:
      'Écrit par `pnpm stellar:volume` (scripts/generate-stellar-volume.mjs). Ne pas éditer à la main. Format : core/stellarVolume.ts.',
    source: {
      gcns: {
        name: 'Gaia Catalogue of Nearby Stars (GCNS), Gaia Early Data Release 3',
        citation:
          'Gaia Collaboration, Smart R. L. et al. 2021, A&A 649, A6, doi:10.1051/0004-6361/202039498',
        service: `${GAVO} (gcns.main, gcns.missing_10mas)`,
        retrieved: gcnsRetrieved,
        selection:
          'dist_50 (median of the distance posterior) <= 100 pc; the GCNS also lists objects whose 1st percentile only is inside 100 pc, not kept here',
        acknowledgement: ACKNOWLEDGEMENT,
      },
      hyg: {
        name: 'HYG v4.4 (CC BY-SA 4.0), Hipparcos parallaxes',
        use: 'names of GCNS stars (position and distance match); rows for the stars listed by gcns.missing_10mas',
      },
      simbad: {
        name: 'SIMBAD position and parallax, as listed in gcns.missing_10mas',
        use: 'objects missing from EDR3 not found in HYG: position and parallax only',
      },
      exoplanets: {
        name: 'NASA Exoplanet Archive, pscomppars (gaia_dr3_id)',
        service: NASA,
        retrieved: retrievedOf(hostsFile),
        acknowledgement: NASA_ACK,
      },
    },
    epochYear: EPOCH_YEAR,
    frame:
      'ICRS equatorial, Sun at the origin, 1 unit = 1 pc; the client rotates to galactic (core/stellarSpace)',
    recordBytes: RECORD_BYTES,
    detailBytes: DETAIL_BYTES,
    detailBucket: DETAIL_BUCKET,
    positionScale: POSITION_SCALE,
    velocityScale: VELOCITY_SCALE,
    flags: FLAGS,
    count: stars.length,
    counts: {
      gcns: count((s) => s.origin === 'gcns'),
      hyg: fromHyg,
      simbad: fromSimbad,
      removedNeighbours,
      beyond100pcAfterHyg: beyond,
      named: count((s) => s.flags & FLAGS.named),
      radialVelocity: count((s) => s.flags & FLAGS.radialVelocity),
      whiteDwarf: count((s) => s.flags & FLAGS.whiteDwarf),
      exoplanetHosts: count((s) => s.flags & FLAGS.exoplanetHost),
    },
    shells: shells.map((s) => ({
      maxPc: s.maxPc,
      file: `stars-${s.maxPc}.bin`,
      start: s.start,
      count: s.count,
      bytes: s.buf.length,
      sha256: sha256(s.buf),
    })),
    details: details.map((buf, b) => ({
      file: `details/${String(b).padStart(3, '0')}.bin`,
      bytes: buf.length,
      sha256: sha256(buf),
    })),
    names: 'names.json',
    witnesses: { physical: WITNESSES, gcnsGalactic: gcnsWitnesses },
  };
  const files = new Map();
  files.set('manifest.json', `${JSON.stringify(manifest, null, 1)}\n`);
  files.set('names.json', `${JSON.stringify(names)}\n`);
  for (const s of shells) files.set(`stars-${s.maxPc}.bin`, s.buf);
  details.forEach((buf, b) =>
    files.set(`details/${String(b).padStart(3, '0')}.bin`, buf)
  );
  return { files, manifest };
}

async function main() {
  const args = process.argv.slice(2);
  const { files, manifest } = await build({
    refresh: args.includes('--refresh'),
  });
  if (args.includes('--check')) {
    const drift = [];
    for (const [name, content] of files) {
      const path = `${OUT}/${name}`;
      if (!existsSync(path)) {
        drift.push(name);
        continue;
      }
      const shipped = readFileSync(path);
      const same =
        typeof content === 'string'
          ? sameIgnoringReadDates(shipped.toString('utf8'), content)
          : Buffer.compare(shipped, content) === 0;
      if (!same) drift.push(name);
    }
    if (drift.length) {
      console.error(
        `volume stellaire dérivé : ${drift.slice(0, 8).join(', ')}`
      );
      process.exit(1);
    }
    console.log(`volume stellaire à jour : ${files.size} fichiers`);
    return;
  }
  mkdirSync(`${OUT}/details`, { recursive: true });
  for (const [name, content] of files) writeFileSync(`${OUT}/${name}`, content);
  console.log(
    `${manifest.count} étoiles (GCNS ${manifest.counts.gcns}, HYG ${manifest.counts.hyg}, SIMBAD ${manifest.counts.simbad}, voisinage retiré ${manifest.counts.removedNeighbours}) ; coquilles ${manifest.shells.map((s) => `${s.maxPc} pc ${s.count}`).join(', ')} ; ${files.size} fichiers`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
