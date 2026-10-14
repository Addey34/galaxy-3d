#!/usr/bin/env node
/* global console, process */
/**
 * LES MISES EN ORBITE, MESURÉES SUR LA TRAJECTOIRE (pages `/orbit-insertions/`, lot 49,
 * 2026-10-14).
 *
 * CE QUI EST MESURÉ. L'instant où une sonde devient LIÉE à un corps : son énergie orbitale
 * spécifique relative au corps, v²/2 − GM/r, passe du positif au négatif. C'est une grandeur
 * physique lue sur la trajectoire, et non une date recopiée d'un communiqué. Témoins mesurés
 * avant d'écrire une ligne, contre les dates publiées des mises en orbite : Juno à 02:57 TDB le
 * 2016-07-05 (combustion de 02:30 à 03:05 environ, heure de la sonde), Cassini à 02:38 TDB le
 * 2004-07-01 (combustion de 01:12 à 02:48), Mars Express à 03:19 le 2003-12-25, ExoMars TGO à
 * 15:18 le 2016-10-19, OSIRIS-REx autour de Bennu le 2018-12-31 (Orbital A), Rosetta autour de
 * 67P le 2014-09-10. Toutes dans leur combustion, ou le jour publié.
 *
 * DEUX RÈGLES, TOUTES DEUX DÉCIDÉES PAR UNE MESURE :
 *   - le passage doit avoir lieu DANS LA SPHÈRE D'INFLUENCE (les fenêtres de
 *     `src/config/flybyEncounters.json`, Laplace pour une planète, Hill pour un petit corps).
 *     Hors d'elle le signe ne veut rien dire : BepiColombo est « liée » à Mercure dès le
 *     2026-10-07, à 314 000 km, quand la sphère de Laplace en fait environ 112 000 ;
 *   - seul le PREMIER passage compte. Autour d'un petit corps l'énergie change de signe à chaque
 *     opération de proximité (des dizaines de fois autour de Bennu en 2019) ; le premier est la
 *     mise en orbite que la mission annonce, les suivants ne sont pas des événements.
 *
 * LE TÉMOIN DE CHAQUE MESURE : la manœuvre la plus proche que `pnpm ephemeris:flybys` a DÉTECTÉE
 * sur la même trajectoire (`impulses`, JD TDB), par une autre méthode (le résidu à deux corps).
 * L'écart est publié, signé, en minutes. Une capture sans manœuvre proche est balistique, et la
 * page le dit au lieu de l'inventer.
 *
 * LA PRÉCISION DE L'INSTANT dépend de la masse du corps : près d'un petit corps l'énergie
 * traverse zéro à quelques cm/s, et une masse un peu différente déplace l'instant. Quand la
 * fiche publie l'incertitude de GM, l'instant est recalculé aux deux bornes et l'écart publié.
 *
 * CE QUI N'A PAS DE PAGE, AVEC SA RAISON :
 *   - `boundAtEntry` : la sonde entre DÉJÀ liée dans la sphère (capture balistique, aucun instant
 *     de passage à publier) ;
 *   - `coverage` : la trajectoire publiée s'arrête avant que la sonde soit liée ;
 *   - `unresolved` : le plan déclare la trajectoire servie non résolue (Hayabusa2 à Ryugu).
 * Un départ de la Terre n'est pas examiné (même règle que les survols). Une paire qui n'est
 * jamais liée est un survol et n'est pas listée ici.
 *
 * Écrit `src/seo/orbitInsertions.json`. `--offline` (cache `.cache/orbit-insertions/`), `--check`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  horizonsRelative,
  norm,
  specificEnergy,
} from './horizons-relative.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'orbit-insertions');
const OUT = join(ROOT, 'src/seo/orbitInsertions.json');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Tranche d'une lecture au pas d'une heure : 1 440 lignes, loin des 90 024 d'Horizons. */
const CHUNK_MS = 60 * DAY;
/** Même règle que les survols : un plus proche à moins d'une heure du début est un départ. */
const FIRST_SAMPLE_MS = HOUR;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2440587.5;

const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
const CHECK = argv.includes('--check');

const plan = JSON.parse(
  readFileSync(join(ROOT, 'src/config/flybyEncounters.json'), 'utf8')
);
const { targets, centers } = JSON.parse(
  readFileSync(join(ROOT, 'scripts/validation-targets.json'), 'utf8')
);
const fiche = (id) =>
  JSON.parse(
    readFileSync(join(ROOT, `src/registry/entities/${id}.json`), 'utf8')
  );

// ─────────────────────────── le catalogue, l'échelle de temps ───────────────────────────

const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': join(ROOT, 'src') } },
  root: ROOT,
});
const { CELESTIAL_CONFIG } = await loader.ssrLoadModule(
  '/src/config/bodies.ts'
);
const { flattenBodies } = await loader.ssrLoadModule('/src/config/catalog.ts');
const { jdTdbFromDate } = await loader.ssrLoadModule('/src/core/timeScale.ts');
await loader.close();
const catalogue = new Map(flattenBodies(CELESTIAL_CONFIG));

/** L'instant UTC (ms) dont le JD TDB vaut `jd`, par l'échelle de temps de l'application. */
function msOfTdbJd(jd) {
  let ms = (jd - UNIX_EPOCH_JD) * MS_PER_DAY;
  for (let i = 0; i < 4; i++)
    ms -= (jdTdbFromDate(new Date(ms)) - jd) * MS_PER_DAY;
  return Math.round(ms / 1000) * 1000;
}

/**
 * L'incertitude RELATIVE de la masse, quand la fiche la publie sous la forme où elle publie la
 * valeur (`$gm`) ; `null` sinon, et la page dit alors qu'aucune incertitude n'est publiée.
 */
function massRelativeUncertainty(id) {
  const fact = fiche(id).facts?.massKg;
  const value = fact?.value?.$gm;
  const sigma = fact?.uncertainty?.$gm;
  return typeof value === 'number' && typeof sigma === 'number'
    ? sigma / value
    : null;
}

const { relative } = horizonsRelative({
  cacheDir: CACHE_DIR,
  offline: OFFLINE,
  targets,
  centers,
  fallbackToDifference: true,
});

/** Les manœuvres détectées sur une rencontre, à toute profondeur de son entrée de plan. */
function impulsesOf(encounter) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object')
      for (const [key, value] of Object.entries(node))
        if (key === 'impulses' && Array.isArray(value)) found.push(...value);
        else walk(value);
  };
  walk(encounter);
  return found.map(msOfTdbJd);
}

const firstBound = (rows, massKg) =>
  rows.findIndex((row) => specificEnergy(row, massKg) < 0);

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

// ─────────────────────────── la mesure ───────────────────────────

/** Les rencontres par paire sonde/corps, dans l'ordre du temps. */
const pairs = new Map();
for (const enc of plan.encounters) {
  const key = `${enc.probe}/${enc.planet}`;
  if (!pairs.has(key)) pairs.set(key, []);
  pairs.get(key).push(enc);
}

const insertions = [];
const excluded = [];
for (const encounters of pairs.values()) {
  encounters.sort((a, b) => a.from.localeCompare(b.from));
  const { probe, planet: body } = encounters[0];
  const massKg = catalogue.get(body)?.realData?.massKg;
  if (!(massKg > 0)) throw new Error(`aucune masse au catalogue pour ${body}`);
  let found = null;
  let reason = null;
  for (const enc of encounters) {
    if (enc.unresolved) {
      reason ??= 'unresolved';
      continue;
    }
    if (Date.parse(enc.closestAt) - Date.parse(enc.from) < FIRST_SAMPLE_MS)
      continue;
    const fromMs = Date.parse(enc.from);
    const toMs = Date.parse(enc.to);
    let previous = null;
    for (let start = fromMs; start < toMs && !found; start += CHUNK_MS) {
      const chunk = await relative(
        probe,
        body,
        start,
        Math.min(start + CHUNK_MS, toMs),
        '1h'
      );
      const rows = previous ? [previous, ...chunk.rows] : chunk.rows;
      const k = firstBound(rows, massKg);
      if (k === 0 && !previous) {
        reason ??= 'boundAtEntry';
        break;
      }
      if (k > 0) found = { before: rows[k - 1], after: rows[k] };
      previous = chunk.rows.at(-1);
    }
    if (found) break;
    // Une fenêtre qui se ferme sur une sonde qui S'APPROCHE encore n'est pas une sortie de la
    // sphère : c'est la trajectoire publiée qui s'arrête (Hera à 30 km de Didymos, JUICE en
    // route vers Jupiter). Une sonde qui s'éloigne en sort, et c'est un survol.
    if (!found && previous && dot(previous.p, previous.v) < 0)
      reason ??= 'coverage';
  }
  if (!found) {
    if (reason) excluded.push({ probe, body, reason });
    continue;
  }

  // L'heure du passage, puis la minute, puis la seconde.
  const minutes = await relative(
    probe,
    body,
    found.before.at,
    found.after.at,
    '60'
  );
  const m = firstBound(minutes.rows, massKg);
  if (m <= 0)
    throw new Error(`${probe} / ${body} : passage introuvable à la minute`);
  const seconds = await relative(
    probe,
    body,
    minutes.rows[m - 1].at,
    minutes.rows[m].at,
    '60'
  );
  const s = firstBound(seconds.rows, massKg);
  if (s <= 0)
    throw new Error(`${probe} / ${body} : passage introuvable à la seconde`);
  const at = seconds.rows[s];

  // La sensibilité à la masse, à la résolution qui encadre encore le passage.
  const sigma = massRelativeUncertainty(body);
  let massSensitivitySeconds = null;
  if (sigma !== null) {
    const shifts = [];
    for (const factor of [1 - sigma, 1 + sigma]) {
      let shifted = null;
      for (const table of [seconds.rows, minutes.rows]) {
        const j = firstBound(table, massKg * factor);
        if (j > 0) {
          shifted = table[j].at;
          break;
        }
      }
      if (shifted === null)
        throw new Error(
          `${probe} / ${body} : l'incertitude de masse déplace le passage de plus d'une heure`
        );
      shifts.push(Math.abs(shifted - at.at) / 1000);
    }
    massSensitivitySeconds = Math.max(...shifts);
  }

  const manoeuvres = impulsesOf(encounters);
  const nearest = manoeuvres.length
    ? manoeuvres.reduce((best, t) =>
        Math.abs(t - at.at) < Math.abs(best - at.at) ? t : best
      )
    : null;

  insertions.push({
    probe,
    body,
    at: iso(at.at),
    distanceKm: Math.round(norm(at.p) * 1000) / 1000,
    // Au µm/s : près de Bennu la vitesse est de 6 cm/s, et l'écart à la libération se lit là.
    speedKmS: Math.round(norm(at.v) * 1e8) / 1e8,
    manoeuvre:
      nearest === null
        ? null
        : {
            at: iso(nearest),
            minutesFromInsertion: Math.round((nearest - at.at) / 60_000),
          },
    massRelativeUncertainty: sigma,
    massSensitivitySeconds,
    solution: seconds.solution ?? null,
    measuredFrom: seconds.measuredFrom,
    retrieved: [minutes.retrieved, seconds.retrieved].sort().at(-1),
  });
}

insertions.sort((a, b) => a.at.localeCompare(b.at));
excluded.sort((a, b) =>
  `${a.probe}/${a.body}`.localeCompare(`${b.probe}/${b.body}`)
);
const output = `${JSON.stringify(
  {
    $comment:
      'Écrit par `pnpm orbits:generate` (scripts/generate-orbit-insertions.mjs), jamais à la main. Premier instant où chaque sonde devient liée à un corps (énergie orbitale spécifique négative) DANS sa sphère d’influence, mesuré à la seconde contre Horizons, avec la manœuvre détectée la plus proche (`impulses` de `src/config/flybyEncounters.json`) et, quand la fiche publie l’incertitude de GM, le déplacement de l’instant qu’elle entraîne. `excluded` : boundAtEntry, la sonde entre déjà liée dans la sphère (capture balistique) ; coverage, la trajectoire publiée s’arrête avant ; unresolved, trajectoire servie non résolue.',
    source:
      'NASA/JPL Horizons, CENTER 500@<corps> (différence de deux vecteurs héliocentriques quand le corps n’est pas un centre), ECLIPTIC J2000, VEC_CORR NONE, UT ; masses du catalogue de Galaxy',
    insertions,
    excluded,
  },
  null,
  2
)}\n`;

if (CHECK) {
  const shipped = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (shipped !== output) {
    console.error(`${OUT} a dérivé : relancer pnpm orbits:generate`);
    process.exit(1);
  }
  console.log(`${insertions.length} mises en orbite, à jour`);
} else {
  writeFileSync(OUT, output);
  for (const i of insertions)
    console.log(
      `${i.at}  ${i.probe} / ${i.body}  ${i.distanceKm} km  ${i.speedKmS} km/s  manœuvre ${i.manoeuvre ? `${i.manoeuvre.minutesFromInsertion} min` : 'aucune'}  masse ±${i.massSensitivitySeconds ?? '—'} s`
    );
  for (const e of excluded)
    console.log(`écarté  ${e.probe} / ${e.body}  ${e.reason}`);
}
