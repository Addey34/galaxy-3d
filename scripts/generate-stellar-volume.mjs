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
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  combine as combineNeighbours,
  parseCsv,
  propagate,
} from './generate-neighbours.mjs';
import { sameIgnoringReadDates } from './drift-compare.mjs';
import { gunzipSync } from 'node:zlib';

const CACHE = '.cache/stellar-volume';
const OUT = 'public/assets/sky/volume';
const GAVO = 'https://dc.zah.uni-heidelberg.de/tap/sync';
const NASA = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
const HYG_CACHE = '.cache/star-catalogue/hyg_v44.csv.gz';
const NEIGHBOURS_DIR = 'public/assets/sky/neighbours';

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

/**
 * Drapeaux d'une étoile. Dans `gcns/`, seuls `radialVelocity` et `whiteDwarf` (valeurs du GCNS) ; les
 * autres sont posés par l'assemblage du client (`core/stellarVolumeAssembly.ts`). L'ancien bit `named`
 * (64), qu'aucun code ne lisait, a disparu avec la séparation des fichiers.
 */
export const FLAGS = {
  radialVelocity: 1,
  whiteDwarf: 2,
  exoplanetHost: 4,
  hyg: 8,
  simbadOnly: 16,
  colourBV: 32,
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
 * LES DROITS, UN FOURNISSEUR PAR DOSSIER (GAL-UNIVERSE-008, séparation des données, lus le 2026-11-27) :
 *   - GCNS (gcns.main, gcns.missing_10mas) : « Gaia Catalogue of Nearby Stars © 2023 by Richard Smart is
 *     licensed under CC BY-NC 4.0 » (pages des tables au centre de données GAVO) ; construit sur Gaia EDR3,
 *     dont l'ESA distribue les données sous CC BY-NC 3.0 IGO (conditions des archives scientifiques de l'ESA).
 *   - SIMBAD (valeurs de gcns.missing_10mas) : conditions générales du CDS (mises à jour le 2026-01-07) :
 *     licence ouverte, ODbL ou CC BY selon le jeu, citation « CDS/SIMBAD » exigée.
 *   - HYG v4.4 : CC BY-SA 4.0 (« Versions since v4.0 are licensed as above », dépôt Codeberg).
 *   - NASA Exoplanet Archive : aucune licence déclarée, remerciement demandé.
 * Les textes complets sont dans le NOTICE.txt de chaque dossier ; aucun fichier ne mêle deux dossiers.
 */
const SHARED_NOTE =
  'Galaxy (https://galaxy.adrianguichard.dev) is a free educational visualisation. The software is under its own licence (PolyForm Noncommercial 1.0.0); the data in this folder are NOT covered by it and keep the licence stated here.';
export const NOTICES = {
  gcns: {
    dir: 'gcns',
    short: {
      id: 'gcns',
      name: 'Gaia Catalogue of Nearby Stars (GCNS), Gaia EDR3',
      license: 'CC-BY-NC-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
      rightsHolder:
        'Gaia Catalogue of Nearby Stars © 2023 by Richard Smart, distributed by the GAVO Data Center; built on Gaia EDR3 data of ESA/Gaia/DPAC (ESA: CC BY-NC 3.0 IGO)',
    },
    text: [
      'Gaia Catalogue of Nearby Stars (GCNS), Gaia Early Data Release 3',
      '',
      'Files: stars-25.bin, stars-50.bin, stars-100.bin, details/NNN.bin',
      'Source: https://dc.g-vo.org/tableinfo/gcns.main (TAP https://dc.zah.uni-heidelberg.de/tap/sync, table gcns.main)',
      'Rights: Gaia Catalogue of Nearby Stars © 2023 by Richard Smart is licensed under CC BY-NC 4.0',
      'Licence: https://creativecommons.org/licenses/by-nc/4.0/',
      'Underlying data: Gaia EDR3, European Space Agency (ESA) mission Gaia, processed by the Gaia DPAC; ESA distributes Gaia archive data under CC BY-NC 3.0 IGO (https://creativecommons.org/licenses/by-nc/3.0/igo/), credit "ESA/Gaia/DPAC".',
      'Citation: Gaia Collaboration, Smart R. L. et al. 2021, A&A 649, A6, doi:10.1051/0004-6361/202039498',
      'This work is based in part on services provided by the GAVO data center.',
      '',
      'Acknowledgement requested by ESA:',
      'This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.',
      '',
      'Changes made by Galaxy: rows of gcns.main with dist_50 <= 0.1 kpc only; position and velocity computed from ra, dec, dist_50, pmra, pmdec and adoptedrv (equatorial, epoch J2016.0) and quantised (pc x 300, km/s x 20); G magnitude x 10; BP-RP x 25; flags for a published radial velocity and wd_prob > 0.5; details (source_id, parallax, distance percentiles, RUWE, probabilities) quantised. No value from any other catalogue is in these files. Binary layout: src/core/stellarVolume.ts in the Galaxy repository.',
      'No warranty: the data are provided as is, as by the licensor.',
      '',
      SHARED_NOTE,
    ],
  },
  gcnsMissing: {
    dir: 'gcns-missing',
    short: {
      id: 'gcns-missing',
      name: 'GCNS list of objects missing from Gaia EDR3 (gcns.missing_10mas), values from SIMBAD',
      license: 'CC-BY-NC-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
      rightsHolder:
        'GCNS © 2023 by Richard Smart, distributed by the GAVO Data Center (CC BY-NC 4.0); positions, parallaxes, identifiers and object types from SIMBAD, CDS, Strasbourg (cite CDS/SIMBAD)',
    },
    text: [
      'GCNS list of possibly nearby objects missing from Gaia EDR3 (gcns.missing_10mas)',
      '',
      'File: missing.json',
      'Source: https://dc.g-vo.org/tableinfo/gcns.missing_10mas (TAP https://dc.zah.uni-heidelberg.de/tap/sync)',
      'Rights: Gaia Catalogue of Nearby Stars © 2023 by Richard Smart is licensed under CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/)',
      'The columns main_id, ra, dec, plx_value and otype are, per the table description, taken from SIMBAD, operated at CDS, Strasbourg, France. The CDS terms (https://cds.unistra.fr/legals/, updated 2026-01-07) require citing the service: CDS/SIMBAD. Reference: Wenger et al. 2000, A&AS 143, 9.',
      'Citation: Gaia Collaboration, Smart R. L. et al. 2021, A&A 649, A6, doi:10.1051/0004-6361/202039498',
      '',
      'Changes made by Galaxy: columns main_id, ra, dec and plx_value copied as published, in table order (otype and plx_bibcode, not used, are left out). No value from any other catalogue.',
      'No warranty: the data are provided as is.',
      '',
      SHARED_NOTE,
    ],
  },
  hyg: {
    dir: 'hyg',
    short: {
      id: 'hyg-v44',
      name: 'HYG database v4.4 (Hipparcos, Yale Bright Star, Gliese)',
      license: 'CC-BY-SA-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      rightsHolder: 'HYG database by David Nash (astronexus)',
    },
    text: [
      'HYG database v4.4 (Hipparcos, Yale Bright Star, Gliese catalogues)',
      '',
      'Files: complement.json, names.json',
      'Source: https://codeberg.org/astronexus/hyg (data/hyg/CURRENT/hyg_v44.csv.gz)',
      'Creator: David Nash (astronexus), HYG database',
      'Licence: Creative Commons Attribution-ShareAlike 4.0 International, https://creativecommons.org/licenses/by-sa/4.0/ (the HYG README: "Versions since v4.0 are licensed as above (CC-BY-SA 4.0)")',
      '',
      'Changes made by Galaxy: complement.json keeps the HYG rows of the stars that the GCNS lists as missing from Gaia EDR3 (columns id, a display name, spect, ra and dec converted from radians to degrees, dist, mag, ci, pmra, pmdec, rv with 0 written as null); names.json keeps id and a display name (proper, else Bayer or Flamsteed with the constellation, else gl, HD or HIP) of the HYG rows that Galaxy identified with a star of the GCNS. The choice of rows used positions and distances from the GCNS, but no value of another catalogue is in these files.',
      'These files are an adaptation of HYG v4.4 and are shared under the same licence, CC BY-SA 4.0.',
      'No warranty: the data are provided as is.',
      '',
      SHARED_NOTE,
    ],
  },
  nasa: {
    dir: 'nasa',
    short: {
      id: 'nasa-exoplanet-archive',
      name: 'NASA Exoplanet Archive, Planetary Systems Composite Parameters (pscomppars)',
      license: 'no licence stated; acknowledgement requested',
      licenseUrl:
        'https://exoplanetarchive.ipac.caltech.edu/docs/acknowledge.html',
      rightsHolder:
        'NASA Exoplanet Archive, operated by the California Institute of Technology under contract with NASA',
    },
    text: [
      'NASA Exoplanet Archive, Planetary Systems Composite Parameters (pscomppars)',
      '',
      'File: hosts.json',
      'Source: https://exoplanetarchive.ipac.caltech.edu/TAP/sync (columns hostname, gaia_dr3_id)',
      'Terms: the archive states no licence; its acknowledgement page (https://exoplanetarchive.ipac.caltech.edu/docs/acknowledge.html) asks for this acknowledgement and for Christiansen et al. 2025 (PSJ) to be cited:',
      'This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program.',
      '',
      'Changes made by Galaxy: one row per host with a Gaia DR3 identifier and a system distance <= 110 pc; the number of planets of a host is the number of its rows (pscomppars has one row per planet). No value from any other catalogue.',
      '',
      SHARED_NOTE,
    ],
  },
};
const NOTICE_FILES = Object.fromEntries(
  Object.values(NOTICES).map((n) => [n.dir, `${n.text.join('\n')}\n`])
);
/** Les tables de correspondance : travail de Galaxy, identifiants seulement. */
const CROSSMATCH_RIGHTS = {
  rights:
    'Written by Galaxy. Contains only identifiers (row numbers of the GCNS files and of gcns-missing/missing.json, HYG ids, row numbers of nasa/hosts.json) and the checksums of the files it links: no value of any catalogue. Method: scripts/generate-stellar-volume.mjs (positional match at J2000, distance agreement).',
};

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
    if (!s) return; // doublon du voisinage : jamais candidat
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

  // ---- voisinage à 5 pc, rapproché depuis ses DEUX fichiers de fournisseur (comme le fait le client)
  const nbHyg = JSON.parse(
    readFileSync(`${NEIGHBOURS_DIR}/hyg-v44.json`, 'utf8')
  );
  const nbGaia = JSON.parse(
    readFileSync(`${NEIGHBOURS_DIR}/gaia-dr3.json`, 'utf8')
  );
  const neighbourRows = combineNeighbours(nbHyg.stars, nbGaia.stars).rows.map(
    (r) => r.row
  );
  const inNeighbourhood = new Set(
    neighbourRows.map((s) => s[12]).filter(Boolean)
  );
  const hygNeighbours = neighbourRows
    .filter((s) => !s[12])
    .map((s) => ({ ra: s[3], dec: s[4], dist: s[5] }));
  const isHygNeighbour = (ra2000, dec2000, dist) =>
    hygNeighbours.some(
      (h) =>
        separationDeg(h.ra, h.dec, ra2000, dec2000) < 30 / 3600 &&
        Math.abs(h.dist - dist) / h.dist < 0.2
    );

  // ---- hôtes d'exoplanètes : une ligne de `pscomppars` = une planète ; le nombre de planètes d'un HÔTE
  // est le nombre de ses lignes (`sy_pnum` compte celles du SYSTÈME : 55 Cnc 7 = 5 + 2 autour de B).
  const hostRows = [];
  const hostRowById = new Map();
  for (const r of hosts.rows) {
    const id = r[hosts.col.gaia_dr3_id].replace(/^Gaia DR3 /, '');
    if (!/^\d+$/.test(id)) continue;
    const known = hostRowById.get(id);
    if (known !== undefined) hostRows[known][2]++;
    else {
      hostRowById.set(id, hostRows.length);
      hostRows.push([id, r[hosts.col.hostname], 1]);
    }
  }

  // ---- le GCNS seul : toutes ses étoiles à 100 pc (médiane), par distance ; rien d'un autre catalogue
  const gcnsStars = [];
  for (const { r, col } of gcns) {
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
    const wdProb = num(r[col.wd_prob]);
    const back = propagate(ra, dec, pmRa, pmDec, 2000 - EPOCH_YEAR);
    gcnsStars.push({
      sourceId: r[col.source_id],
      ra2000: back.raDeg,
      dec2000: back.decDeg,
      distPc: d50,
      position: state.position,
      velocity: state.velocity,
      mag: num(r[col.phot_g_mean_mag]),
      colour: num(r[col.phot_bp_mean_mag]) - num(r[col.phot_rp_mean_mag]),
      relErr: (d84 - d16) / 2 / d50,
      flags:
        (Number.isFinite(rv) ? FLAGS.radialVelocity : 0) |
        (wdProb > WD_THRESHOLD ? FLAGS.whiteDwarf : 0),
      parallax: num(r[col.parallax]),
      parallaxError: num(r[col.parallax_error]),
      distLow: d50 - d16,
      distHigh: d84 - d50,
      ruwe: num(r[col.ruwe]),
      wdProb,
      gcnsProb: num(r[col.gcns_prob]),
      rvError: num(r[col.adoptedrv_error]),
      gcnsXyz: [
        num(r[col.xcoord_50]),
        num(r[col.ycoord_50]),
        num(r[col.zcoord_50]),
      ],
    });
  }
  gcnsStars.sort((a, b) => a.distPc - b.distPc);

  // ---- correspondances (identifiants seulement) : doublons du voisinage, hôtes
  const hiddenGcns = [];
  gcnsStars.forEach((s, i) => {
    if (
      inNeighbourhood.has(s.sourceId) ||
      isHygNeighbour(s.ra2000, s.dec2000, s.distPc)
    )
      hiddenGcns.push(i);
  });
  const hidden = new Set(hiddenGcns);
  const hostGcns = [];
  gcnsStars.forEach((s, i) => {
    const row = hostRowById.get(s.sourceId);
    if (row !== undefined) hostGcns.push([i, row]);
  });

  // ---- HYG → GCNS (noms) : position Gaia ramenée à J2000 à moins de 3″, distance à 25 %
  const hygText = gunzipSync(readFileSync(HYG_CACHE)).toString('utf8');
  const hyg = table(hygText);
  const hc = hyg.col;
  const candidates = gcnsStars.map((s, i) => (hidden.has(i) ? null : s));
  const index = skyIndex(candidates);
  const hygRows = hyg.rows.filter((r) => {
    const d = Number(r[hc.dist]);
    return d > 0 && d <= MAX_DISTANCE_PC * 1.25 && r[hc.id] !== '0';
  });
  const named = new Set();
  const namePairs = [];
  const hygNames = new Map();
  const hygUnmatched = [];
  for (const r of hygRows) {
    const ra = Number(r[hc.rarad]) * (180 / Math.PI);
    const dec = Number(r[hc.decrad]) * (180 / Math.PI);
    const dist = Number(r[hc.dist]);
    const name = hygName(r, hc);
    let best = -1;
    let bestSep = 3 / 3600;
    for (const i of index.near(ra, dec)) {
      const s = gcnsStars[i];
      const sep = separationDeg(ra, dec, s.ra2000, s.dec2000);
      if (sep < bestSep && Math.abs(s.distPc - dist) / dist < 0.25) {
        best = i;
        bestSep = sep;
      }
    }
    if (best >= 0) {
      if (name && !named.has(best)) {
        named.add(best);
        namePairs.push([best, Number(r[hc.id])]);
        hygNames.set(Number(r[hc.id]), name);
      }
    } else hygUnmatched.push({ r, ra, dec, dist, name });
  }

  // ---- absentes d'EDR3 (liste du GCNS, valeurs de SIMBAD) → ligne HYG : 30″, distance à 25 %
  const missingRows = [];
  const hiddenMissing = [];
  const missingHyg = [];
  const complementRows = new Map();
  missing.rows.forEach((m, mi) => {
    const plx = num(m[missing.col.plx_value]);
    const ra = num(m[missing.col.ra]);
    const dec = num(m[missing.col.dec]);
    // Les colonnes que le client lit, et elles seules (type d'objet et référence de la parallaxe restent
    // dans la table publiée, citée par la notice).
    missingRows.push([m[missing.col.main_id], ra, dec, plx]);
    if (!(plx >= 1000 / MAX_DISTANCE_PC)) return;
    const dist = 1000 / plx;
    if (isHygNeighbour(ra, dec, dist)) {
      hiddenMissing.push(mi);
      return;
    }
    const match = hygUnmatched.find(
      (h) =>
        separationDeg(ra, dec, h.ra, h.dec) < 30 / 3600 &&
        Math.abs(h.dist - dist) / dist < 0.25
    );
    if (!match) return;
    const r = match.r;
    const id = Number(r[hc.id]);
    missingHyg.push([mi, id]);
    const rvRaw = r[hc.rv];
    complementRows.set(id, [
      id,
      match.name,
      r[hc.spect] || null,
      match.ra,
      match.dec,
      match.dist,
      r[hc.mag] === '' ? null : num(r[hc.mag]),
      r[hc.ci] === '' ? null : num(r[hc.ci]),
      Number(r[hc.pmra]),
      Number(r[hc.pmdec]),
      // HYG écrit 0 pour une vitesse radiale inconnue : un zéro n'est pas une mesure.
      rvRaw !== '' && Number(rvRaw) !== 0 ? Number(rvRaw) : null,
    ]);
  });

  // ---- fichiers du GCNS : coquilles et détails, valeurs du GCNS seules
  const shells = [];
  let start = 0;
  for (const maxPc of SHELLS_PC) {
    let end = start;
    while (end < gcnsStars.length && gcnsStars[end].distPc <= maxPc) end++;
    const buf = Buffer.alloc((end - start) * RECORD_BYTES);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = start; i < end; i++)
      encodeRecord(view, (i - start) * RECORD_BYTES, gcnsStars[i]);
    shells.push({ maxPc, start, count: end - start, buf });
    start = end;
  }
  const details = [];
  for (let b = 0; b * DETAIL_BUCKET < gcnsStars.length; b++) {
    const from = b * DETAIL_BUCKET;
    const to = Math.min(gcnsStars.length, from + DETAIL_BUCKET);
    const buf = Buffer.alloc((to - from) * DETAIL_BYTES);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = from; i < to; i++)
      encodeDetail(view, (i - from) * DETAIL_BYTES, gcnsStars[i]);
    details.push(buf);
  }

  // ---- témoins : distances physiques (noms de HYG) et repère galactique du GCNS (rang dans le GCNS)
  const distanceOfName = (n) => {
    for (const row of complementRows.values()) if (row[1] === n) return row[5];
    for (const [g, h] of namePairs)
      if (hygNames.get(h) === n) return gcnsStars[g].distPc;
    return null;
  };
  for (const w of WITNESSES) {
    const d = distanceOfName(w.name);
    if (d === null) throw new Error(`témoin absent du volume : ${w.name}`);
    if (d < w.pc[0] || d > w.pc[1])
      throw new Error(
        `témoin ${w.name} à ${d.toFixed(2)} pc, hors de [${w.pc}]`
      );
  }
  const gcnsWitnesses = [];
  for (const pc of [3, 12, 24, 37, 49, 61, 74, 88, 99]) {
    // Une étoile que la vue montre : jamais un doublon du voisinage, caché par l'assemblage.
    const i = gcnsStars.findIndex((s, k) => s.distPc >= pc && !hidden.has(k));
    const s = gcnsStars[i];
    gcnsWitnesses.push({
      index: i,
      sourceId: s.sourceId,
      distPc: Number(s.distPc.toFixed(4)),
      galacticXyzPc: s.gcnsXyz.map((v) => Number(v.toFixed(4))),
    });
  }

  // ---- ce que l'assemblage du client doit produire (tenu par les tests) : calculé, jamais recopié
  const hiddenSet = new Set(hiddenGcns);
  const perShell = shells.map((sh) => {
    let n = 0;
    for (let i = sh.start; i < sh.start + sh.count; i++)
      if (!hiddenSet.has(i)) n++;
    return n;
  });
  const hiddenMissingSet = new Set(hiddenMissing);
  const hygOfMissing = new Map(missingHyg);
  let fromHyg = 0;
  let fromSimbad = 0;
  let rvComplement = 0;
  missingRows.forEach((m, mi) => {
    if (!(m[3] >= 1000 / MAX_DISTANCE_PC) || hiddenMissingSet.has(mi)) return;
    const h = hygOfMissing.has(mi)
      ? complementRows.get(hygOfMissing.get(mi))
      : null;
    const dist = h ? h[5] : 1000 / m[3];
    if (!(dist <= MAX_DISTANCE_PC)) return;
    if (h) {
      fromHyg++;
      if (h[10] !== null) rvComplement++;
    } else fromSimbad++;
    perShell[SHELLS_PC.findIndex((pc) => dist <= pc)]++;
  });
  const EXPECTED = {
    count: perShell.reduce((a, b) => a + b, 0),
    perShell,
    counts: {
      gcns: gcnsStars.length - hiddenGcns.length,
      hyg: fromHyg,
      simbad: fromSimbad,
      exoplanetHosts: hostGcns.filter(([g]) => !hiddenSet.has(g)).length,
      whiteDwarf: gcnsStars.filter(
        (st, k) => !hiddenSet.has(k) && st.flags & FLAGS.whiteDwarf
      ).length,
      radialVelocity:
        gcnsStars.filter(
          (st, k) => !hiddenSet.has(k) && st.flags & FLAGS.radialVelocity
        ).length + rvComplement,
      hiddenNeighbours: hiddenGcns.length + hiddenMissing.length,
      namedByHyg: namePairs.filter(([g]) => !hiddenSet.has(g)).length,
    },
  };

  // ---- les fichiers, un dossier par fournisseur
  const files = new Map();
  const entry = (file, content) => {
    const buf = typeof content === 'string' ? Buffer.from(content) : content;
    files.set(file, content);
    return { file, bytes: buf.length, sha256: sha256(buf) };
  };
  const json = (o) => `${JSON.stringify(o)}\n`;
  const shellEntries = shells.map((s) => ({
    maxPc: s.maxPc,
    count: s.count,
    ...entry(`gcns/stars-${s.maxPc}.bin`, s.buf),
  }));
  const detailEntries = details.map((buf, b) =>
    entry(`gcns/details/${String(b).padStart(3, '0')}.bin`, buf)
  );
  const providerSha = (entries) =>
    sha256(Buffer.from(entries.map((e) => e.sha256).join('\n')));
  const gcnsSha = providerSha([...shellEntries, ...detailEntries]);

  const missingEntry = entry(
    'gcns-missing/missing.json',
    json({
      provider: NOTICES.gcnsMissing.short,
      fields: ['mainId', 'raDeg', 'decDeg', 'parallaxMas'],
      rows: missingRows,
    })
  );
  const complementEntry = entry(
    'hyg/complement.json',
    json({
      provider: NOTICES.hyg.short,
      fields: [
        'hygId',
        'name',
        'spectral',
        'raDeg',
        'decDeg',
        'distPc',
        'vmag',
        'bv',
        'pmRaMas',
        'pmDecMas',
        'rvKms',
      ],
      rows: [...complementRows.values()].sort((a, b) => a[0] - b[0]),
    })
  );
  const namesEntry = entry(
    'hyg/names.json',
    json({
      provider: NOTICES.hyg.short,
      fields: ['hygId', 'name'],
      rows: [...hygNames].sort((a, b) => a[0] - b[0]),
    })
  );
  const nasaEntry = entry(
    'nasa/hosts.json',
    json({
      provider: { ...NOTICES.nasa.short, retrieved: retrievedOf(hostsFile) },
      fields: ['gaiaDr3Id', 'host', 'planets'],
      rows: hostRows,
    })
  );
  const hygSha = providerSha([complementEntry, namesEntry]);
  const binds = {
    gcns: gcnsSha,
    gcnsMissing: missingEntry.sha256,
    hyg: hygSha,
    nasa: nasaEntry.sha256,
  };
  const crossmatchEntry = entry(
    'crossmatch.json',
    json({
      ...CROSSMATCH_RIGHTS,
      binds,
      hiddenGcns,
      hiddenMissing,
      missingHyg,
      hostGcns,
    })
  );
  const crossmatchNamesEntry = entry(
    'crossmatch-names.json',
    json({
      ...CROSSMATCH_RIGHTS,
      binds: { gcns: gcnsSha, hyg: hygSha },
      pairs: namePairs,
    })
  );
  for (const [dir, notice] of Object.entries(NOTICE_FILES))
    files.set(`${dir}/NOTICE.txt`, notice);

  const rights = (id) => ({
    name: NOTICES[id].short.name,
    license: NOTICES[id].short.license,
    licenseUrl: NOTICES[id].short.licenseUrl,
    rightsHolder: NOTICES[id].short.rightsHolder,
    notice: `${NOTICES[id].dir}/NOTICE.txt`,
  });
  const volumeIndex = {
    $comment:
      'Écrit par `pnpm stellar:volume` (scripts/generate-stellar-volume.mjs). Ne pas éditer à la main. Index de Galaxy : un dossier par fournisseur, chacun sous SA licence ; assemblage à l’exécution par core/stellarVolumeAssembly.ts.',
    rights:
      'This index and the crossmatch files are written by Galaxy and contain only identifiers, file names, checksums and counts: no value of any catalogue. Each provider folder carries its own NOTICE.txt and licence.',
    format: {
      epochYear: EPOCH_YEAR,
      recordBytes: RECORD_BYTES,
      detailBytes: DETAIL_BYTES,
      detailBucket: DETAIL_BUCKET,
      positionScale: POSITION_SCALE,
      velocityScale: VELOCITY_SCALE,
      flags: FLAGS,
      maxDistancePc: MAX_DISTANCE_PC,
      frame:
        'ICRS equatorial, Sun at the origin, 1 unit = 1 pc; the client rotates to galactic (core/stellarSpace)',
    },
    providers: {
      gcns: {
        ...rights('gcns'),
        sha256: gcnsSha,
        shells: shellEntries,
        details: detailEntries,
      },
      gcnsMissing: {
        ...rights('gcnsMissing'),
        ...missingEntry,
      },
      hyg: {
        ...rights('hyg'),
        sha256: hygSha,
        complement: complementEntry,
        names: namesEntry,
      },
      nasa: { ...rights('nasa'), ...nasaEntry },
    },
    crossmatch: { structure: crossmatchEntry, names: crossmatchNamesEntry },
    expected: EXPECTED,
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
      exoplanets: {
        name: 'NASA Exoplanet Archive, pscomppars (gaia_dr3_id)',
        service: NASA,
        retrieved: retrievedOf(hostsFile),
        acknowledgement: NASA_ACK,
      },
    },
    witnesses: { physical: WITNESSES, gcnsGalactic: gcnsWitnesses },
  };
  files.set('index.json', `${JSON.stringify(volumeIndex, null, 1)}\n`);
  return {
    files,
    summary: {
      gcns: gcnsStars.length,
      hiddenGcns: hiddenGcns.length,
      hiddenMissing: hiddenMissing.length,
      missingHyg: missingHyg.length,
      names: namePairs.length,
      hosts: hostGcns.length,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const { files, summary } = await build({
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
  for (const [name, content] of files) {
    mkdirSync(dirname(`${OUT}/${name}`), { recursive: true });
    writeFileSync(`${OUT}/${name}`, content);
  }
  console.log(
    `GCNS ${summary.gcns} (dont ${summary.hiddenGcns} doublons du voisinage), absentes HYG ${summary.missingHyg}, absentes cachées ${summary.hiddenMissing}, noms ${summary.names}, hôtes ${summary.hosts} ; ${files.size} fichiers`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
