#!/usr/bin/env node
/* global console, fetch, process, URLSearchParams */
/**
 * LES ÉTOILES VOISINES DU SOLEIL : toutes celles que le catalogue HYG v4.4 place à 5 parsecs ou
 * moins, avec la meilleure mesure disponible de leur distance et de leur mouvement.
 *
 *   pnpm neighbours:generate            # lit le cache .cache/neighbours/ sinon interroge Gaia
 *   pnpm neighbours:generate -- --check # code 1 si le fichier livré n'est plus celui qu'on écrirait
 *   pnpm neighbours:generate -- --refresh # interroge de nouveau l'archive Gaia
 *
 * POURQUOI DEUX SOURCES. HYG (Hipparcos + Gliese) est le catalogue du ciel déjà livré (`stars.json`),
 * mais il a deux défauts MESURÉS sur ce périmètre : (1) un mouvement propre plafonné à 9 999,99
 * mas/an (l'étoile de Barnard, 10 362 mas/an réels, y est à 9 999,99) ; (2) des parallaxes
 * d'Hipparcos que Gaia a affinées (Proxima à 1,2959 pc dans HYG contre 1,302 pc dans Gaia DR3).
 * Pour chaque étoile, on cherche donc sa contrepartie dans Gaia DR3 (archive de l'ESA, TAP) et on
 * l'adopte SI elle est sûre : parallaxe à plus de 20 sigmas, RUWE < 1,4, et distance cohérente à 20 %
 * avec celle de HYG (c'est la même étoile). Sinon la ligne reste celle de HYG, et le fichier le dit
 * (`origin`). Une étoile trop brillante pour Gaia (Sirius A, α Cen A/B) reste donc à HYG, sans
 * incertitude publiée : la fiche écrit « non publiée », elle n'invente rien.
 *
 * POSITION. Gaia DR3 date ses positions de J2016,0 ; `core/starCatalogue.ts` part de J2000,0. La
 * position Gaia est ramenée à J2000,0 par le mouvement propre publié (rectiligne, exact à mieux
 * que le milliarcseconde sur 16 ans pour ces étoiles). La distance est 1/parallaxe, SANS correction
 * de point zéro (−0,017 mas pour Gaia DR3 : 0,002 % à 750 mas, sous l'incertitude affichée).
 *
 * REMERCIEMENT EXIGÉ par l'ESA (lu le 2026-11-22 sur la page « Credit and citation instructions »
 * de la documentation de Gaia DR3) : texte verbatim dans `source.gaia.acknowledgement`.
 */
import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HYG_CACHE = '.cache/star-catalogue/hyg_v44.csv.gz';
const GAIA_CACHE = '.cache/neighbours/gaia.json';
const OUT = 'public/assets/sky/neighbours.json';
const TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';
export const MAX_DISTANCE_PC = 5;
const GAIA_EPOCH = 2016;
const HYG_PM_CAP = 9999.99;
const RUWE_MAX = 1.4;
const PARALLAX_SNR_MIN = 20;
const HYG_AGREEMENT = 0.2;
/**
 * Cône de recherche autour de la position HYG propagée à 2016 : large, car les positions des étoiles
 * de Gliese seules peuvent être décalées de plus d'une minute d'arc (GJ 3618 : contrepartie Gaia
 * trouvée à 0,3° d'un cône de 0,02°). L'identification repose sur la parallaxe ET le mouvement propre.
 */
const CONE_DEG = 0.1;
/** Écart de mouvement propre toléré entre HYG et Gaia : 10 % du mouvement, au moins 250 mas/an. */
const PM_AGREEMENT = 0.1;
const PM_FLOOR_MAS = 250;
/** |G de Gaia − V de HYG| maximal : une naine rouge a V − G jusqu'à ~3, une naine blanche ~0. */
const MAG_AGREEMENT = 4;

const ACKNOWLEDGEMENT =
  'This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.';

/**
 * Témoins PHYSIQUES, écrits sans source de données : ce que n'importe quel ouvrage d'astronomie
 * donne de ces étoiles, avec une tolérance large. Ils ne servent pas à fixer une valeur mais à
 * échouer bruyamment si un tri, une unité ou une jointure dérive.
 */
const WITNESSES = [
  { name: 'Proxima Centauri', ly: [4.2, 4.3] },
  { name: "Barnard's Star", ly: [5.9, 6.0] },
  { name: 'Sirius', ly: [8.5, 8.7] },
];
/** Proxima est la plus proche ; α Cen A et B (même distance dans HYG) suivent, dans un ordre quelconque. */
const NEAREST_FIRST = 'Proxima Centauri';
const ALPHA_CEN = ['Rigil Kentaurus', 'Toliman'];

const LY_PER_PC = 3.261563777;

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Les lignes HYG à `MAX_DISTANCE_PC` ou moins, la plus proche d'abord. */
export function readHygNeighbours(gz) {
  const text = gunzipSync(gz).toString('utf8');
  const [header, ...rows] = parseCsv(text);
  const col = Object.fromEntries(header.map((name, i) => [name, i]));
  const out = [];
  for (const r of rows) {
    const dist = Number(r[col.dist]);
    if (!(dist > 0 && dist <= MAX_DISTANCE_PC)) continue;
    out.push({
      id: r[col.id],
      hip: r[col.hip] || null,
      gl: r[col.gl] || null,
      proper: r[col.proper] || null,
      bf: r[col.bf] || null,
      spect: r[col.spect] || null,
      raDeg: Number(r[col.rarad]) * (180 / Math.PI),
      decDeg: Number(r[col.decrad]) * (180 / Math.PI),
      distPc: dist,
      pmRa: Number(r[col.pmra]),
      pmDec: Number(r[col.pmdec]),
      rv: Number(r[col.rv]),
      vmag: Number(r[col.mag]),
    });
  }
  return out.sort((a, b) => a.distPc - b.distPc);
}

/** Le nom affiché : nom propre, sinon désignation de Gliese, sinon Hipparcos, sinon l'identifiant HYG. */
export function displayName(s) {
  return s.proper ?? s.gl ?? (s.hip ? `HIP ${s.hip}` : `HYG ${s.id}`);
}

/** Position J2000 → J2016,0 par le mouvement propre (mas/an, pmRa déjà × cos δ). */
export function propagate(raDeg, decDeg, pmRa, pmDec, years) {
  const cosDec = Math.cos((decDeg * Math.PI) / 180);
  return {
    raDeg: raDeg + (pmRa * years) / 3.6e6 / cosDec,
    decDeg: decDeg + (pmDec * years) / 3.6e6,
  };
}

async function queryGaia(star) {
  const censored =
    Math.abs(star.pmRa) >= HYG_PM_CAP || Math.abs(star.pmDec) >= HYG_PM_CAP;
  // La position attendue en 2016 ; un mouvement plafonné ne la donne pas : cône large.
  const at2016 = censored
    ? { raDeg: star.raDeg, decDeg: star.decDeg }
    : propagate(
        star.raDeg,
        star.decDeg,
        star.pmRa,
        star.pmDec,
        GAIA_EPOCH - 2000
      );
  const radius = censored ? 0.15 : CONE_DEG;
  const plxHyg = 1000 / star.distPc;
  const adql =
    'SELECT TOP 40 source_id,ra,dec,parallax,parallax_error,pmra,pmdec,radial_velocity,ruwe,phot_g_mean_mag ' +
    'FROM gaiadr3.gaia_source ' +
    `WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${at2016.raDeg.toFixed(6)},${at2016.decDeg.toFixed(6)},${radius})) ` +
    `AND parallax IS NOT NULL AND parallax > ${(plxHyg * 0.5).toFixed(2)} ORDER BY parallax DESC`;
  const res = await fetch(TAP, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'csv',
      QUERY: adql,
    }),
  });
  if (!res.ok)
    throw new Error(`Gaia TAP HTTP ${res.status} pour HYG ${star.id}`);
  const [head, ...lines] = parseCsv(await res.text());
  if (!head || head[0] !== 'source_id')
    throw new Error(`Gaia TAP : réponse inattendue pour HYG ${star.id}`);
  return lines.map((l) => ({
    sourceId: l[0],
    ra: Number(l[1]),
    dec: Number(l[2]),
    parallax: Number(l[3]),
    parallaxError: Number(l[4]),
    pmRa: l[5] === '' ? null : Number(l[5]),
    pmDec: l[6] === '' ? null : Number(l[6]),
    rv: l[7] === '' ? null : Number(l[7]),
    ruwe: l[8] === '' ? null : Number(l[8]),
    gMag: l[9] === '' ? null : Number(l[9]),
  }));
}

function censoredPm(star) {
  return (
    Math.abs(star.pmRa) >= HYG_PM_CAP || Math.abs(star.pmDec) >= HYG_PM_CAP
  );
}

/** La contrepartie sûre de Gaia, ou null (et la raison). Pur, testé par `neighbours.test.ts`. */
export function chooseGaia(star, candidates, taken = new Set()) {
  const plxHyg = 1000 / star.distPc;
  let best = null;
  for (const c of candidates) {
    if (taken.has(c.sourceId)) continue;
    const gap = Math.abs(c.parallax - plxHyg) / plxHyg;
    if (gap > HYG_AGREEMENT) continue;
    // Même étoile = même parallaxe ET même mouvement (sauf mouvement plafonné de HYG, inutilisable).
    if (!censoredPm(star) && c.pmRa !== null && c.pmDec !== null) {
      const total = Math.hypot(star.pmRa, star.pmDec);
      const gapPm = Math.hypot(c.pmRa - star.pmRa, c.pmDec - star.pmDec);
      if (gapPm > Math.max(PM_FLOOR_MAS, PM_AGREEMENT * total)) continue;
    }
    // Même étoile = même éclat : écarte la composante d'un système multiple prise pour l'autre.
    if (c.gMag === null || Math.abs(c.gMag - star.vmag) > MAG_AGREEMENT)
      continue;
    // Parmi les candidats cohérents, le plus BRILLANT : `chooseGaia` est appelé de la composante la
    // plus brillante de HYG à la plus faible, donc A prend la plus brillante, B la suivante.
    if (!best || c.gMag < best.c.gMag) best = { c, gap };
  }
  if (!best)
    return { gaia: null, reason: 'aucune contrepartie Gaia cohérente' };
  const c = best.c;
  if (c.ruwe === null || c.ruwe >= RUWE_MAX)
    return { gaia: null, reason: `RUWE ${c.ruwe} (≥ ${RUWE_MAX})` };
  if (c.parallax / c.parallaxError < PARALLAX_SNR_MIN)
    return { gaia: null, reason: 'parallaxe à moins de 20 sigmas' };
  if (c.pmRa === null || c.pmDec === null)
    return { gaia: null, reason: 'mouvement propre absent' };
  return { gaia: c, reason: null };
}

/** Une ligne du fichier livré (dans l'ordre de `FIELDS`). */
export function buildRow(star, gaia) {
  const hygRv = star.rv !== 0 && Number.isFinite(star.rv) ? star.rv : null;
  if (gaia) {
    const distPc = 1000 / gaia.parallax;
    const back = propagate(
      gaia.ra,
      gaia.dec,
      gaia.pmRa,
      gaia.pmDec,
      2000 - GAIA_EPOCH
    );
    return [
      displayName(star),
      otherIds(star),
      star.spect,
      round(back.raDeg, 6),
      round(back.decDeg, 6),
      round(distPc, 5),
      round((distPc * gaia.parallaxError) / gaia.parallax, 5),
      star.vmag,
      round(gaia.pmRa, 2),
      round(gaia.pmDec, 2),
      gaia.rv ?? hygRv,
      'gaia-dr3',
      gaia.sourceId,
    ];
  }
  return [
    displayName(star),
    otherIds(star),
    star.spect,
    round(star.raDeg, 6),
    round(star.decDeg, 6),
    star.distPc,
    null,
    star.vmag,
    star.pmRa,
    star.pmDec,
    hygRv,
    'hyg-v44',
    null,
  ];
}

/** Les autres désignations (Gliese, Hipparcos), pour la recherche et la fiche. */
function otherIds(star) {
  const ids = [star.gl, star.hip ? `HIP ${star.hip}` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' · ') : null;
}

const round = (v, digits) => Number(v.toFixed(digits));

export const FIELDS = [
  'name',
  'ids',
  'spectral',
  'raDeg',
  'decDeg',
  'distPc',
  'distErrPc',
  'vmag',
  'pmRaMas',
  'pmDecMas',
  'rvKms',
  'origin',
  'gaiaSourceId',
];

async function main() {
  const args = process.argv.slice(2);
  if (!existsSync(HYG_CACHE))
    throw new Error(`${HYG_CACHE} absent : lancer d'abord pnpm stars:generate`);
  const hyg = readHygNeighbours(readFileSync(HYG_CACHE));
  let cache = {};
  if (existsSync(GAIA_CACHE) && !args.includes('--refresh'))
    cache = JSON.parse(readFileSync(GAIA_CACHE, 'utf8'));
  let queried = 0;
  for (const star of hyg) {
    if (cache[star.id]) continue;
    cache[star.id] = await queryGaia(star);
    queried += 1;
  }
  if (queried > 0) {
    mkdirSync('.cache/neighbours', { recursive: true });
    writeFileSync(GAIA_CACHE, JSON.stringify(cache));
  }

  const taken = new Set();
  const rows = [];
  const notes = [];
  for (const star of [...hyg].sort((a, b) => a.vmag - b.vmag)) {
    const { gaia, reason } = chooseGaia(star, cache[star.id], taken);
    if (gaia) taken.add(gaia.sourceId);
    else if (
      Math.abs(star.pmRa) >= HYG_PM_CAP ||
      Math.abs(star.pmDec) >= HYG_PM_CAP
    ) {
      // Un mouvement plafonné sans contrepartie Gaia : la valeur est fausse, la ligne est écartée.
      notes.push(
        `${displayName(star)} : écartée (mouvement propre HYG plafonné, ${reason})`
      );
      continue;
    }
    rows.push({ row: buildRow(star, gaia), reason });
  }

  // Triées par la distance ADOPTÉE (Gaia quand elle est sûre), pas par celle de HYG.
  rows.sort((x, y) => x.row[5] - y.row[5]);

  // Témoins : échec bruyant si une jointure, une unité ou un tri dérive.
  const byName = new Map(rows.map((r) => [r.row[0], r.row]));
  for (const w of WITNESSES) {
    const row = byName.get(w.name);
    if (!row) throw new Error(`témoin absent : ${w.name}`);
    const ly = row[5] * LY_PER_PC;
    if (ly < w.ly[0] || ly > w.ly[1])
      throw new Error(
        `témoin ${w.name} : ${ly.toFixed(3)} al hors de ${w.ly.join('–')}`
      );
  }
  if (rows[0]?.row[0] !== NEAREST_FIRST)
    throw new Error(
      `la plus proche devrait être ${NEAREST_FIRST}, obtenu ${rows[0]?.row[0]}`
    );
  const next = [rows[1]?.row[0], rows[2]?.row[0]].sort();
  if (next.join() !== [...ALPHA_CEN].sort().join())
    throw new Error(
      `rangs 2 et 3 : attendu α Cen A et B, obtenu ${next.join(', ')}`
    );
  // Le défaut de HYG que ce fichier corrige : Barnard doit venir de Gaia, au-delà du plafond de HYG.
  const barnard = byName.get("Barnard's Star");
  if (barnard[11] !== 'gaia-dr3' || !(Math.abs(barnard[9]) > HYG_PM_CAP))
    throw new Error('Barnard : mouvement propre non corrigé par Gaia');

  const file = {
    source: {
      neighbours: {
        description:
          'Étoiles à 5 pc ou moins selon HYG v4.4, distance et mouvement de Gaia DR3 quand la mesure est sûre',
        maxDistancePc: MAX_DISTANCE_PC,
        gaiaEpoch: GAIA_EPOCH,
        selection: {
          ruweBelow: RUWE_MAX,
          parallaxSnrAbove: PARALLAX_SNR_MIN,
          hygAgreement: HYG_AGREEMENT,
        },
      },
      gaia: {
        id: 'gaia-dr3',
        name: 'Gaia Data Release 3 (ESA)',
        url: 'https://www.cosmos.esa.int/gaia',
        archive: 'https://gea.esac.esa.int/archive/',
        citationDoi: '10.1051/0004-6361/202243940',
        acknowledgement: ACKNOWLEDGEMENT,
        acknowledgementUrl:
          'https://gea.esac.esa.int/archive/documentation/GDR3/Miscellaneous/sec_credit_and_citation_instructions/',
      },
      hyg: {
        id: 'hyg-v44',
        name: 'HYG database v4.4 (Hipparcos, Yale Bright Star, Gliese)',
        url: 'https://codeberg.org/astronexus/hyg',
        license: 'CC-BY-SA-4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      },
    },
    fields: FIELDS,
    count: rows.length,
    stars: rows.map((r) => r.row),
  };
  const text = `${JSON.stringify(file)}\n`;
  console.log(
    `${rows.length} étoiles ; Gaia : ${rows.filter((r) => r.row[11] === 'gaia-dr3').length}, HYG seul : ${rows.filter((r) => r.row[11] === 'hyg-v44').length}`
  );
  for (const r of rows.filter((x) => x.row[11] === 'hyg-v44'))
    console.log(`  HYG seul : ${r.row[0]} (${r.reason})`);
  for (const n of notes) console.log(`  ${n}`);
  if (args.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== text) {
      console.error(`${OUT} n'est plus celui que ce script écrirait`);
      process.exit(1);
    }
    console.log('à jour');
    return;
  }
  writeFileSync(OUT, text);
  console.log(`écrit ${OUT} (${Buffer.byteLength(text)} o)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
