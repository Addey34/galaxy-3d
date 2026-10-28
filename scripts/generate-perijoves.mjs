#!/usr/bin/env node
/* global console, process */
/**
 * LES PÉRIJOVES DE JUNO, MESURÉS SUR LA TRAJECTOIRE (pages `/perijoves/`, 2026-10-28).
 *
 * CE QUI EST MESURÉ. Chaque minimum LOCAL de la distance de Juno au centre de Jupiter, lu dans
 * Horizons (CENTER 500@599, écliptique J2000, UT) : à l'heure sur la fenêtre que le manifeste
 * d'éphémérides livre pour la sonde, puis à la minute, puis à la seconde. Un minimum est local
 * s'il est le plus petit de sa demi-fenêtre de `HALF_WINDOW_DAYS` jours de chaque côté : la plus
 * courte orbite de Juno dure plus de 30 jours, donc deux périjoves ne tombent jamais dans la même
 * fenêtre. Même méthode que les périhélies (`generate-perihelia.mjs`).
 *
 * LA NUMÉROTATION. La NASA numérote les périjoves PJ0 (l'insertion en orbite, 2016-07-05, déjà
 * mesurée par `pnpm orbits:generate`) puis PJ1, PJ2… Le minimum de bord de fenêtre n'est jamais
 * listé : l'insertion tombe au bord, donc le premier minimum listé EST PJ1 et le rang vaut le
 * numéro. Ce n'est pas supposé : `scripts/juno-perijove-witnesses.json` porte les dates UTC de
 * PJ1 à PJ76 lues dans le tableau de la NASA, et le générateur ÉCHOUE si l'un de ces numéros ne
 * tombe pas à un jour près (le tableau donne des jours) sur le minimum mesuré. Au-delà de PJ76,
 * le tableau de la NASA s'arrête : le numéro prolonge la série, il n'est pas confirmé par elle.
 *
 * LES BORNES. Comme pour les périhélies : fenêtre plafonnée à `PREDICT_DAYS` jours après la date de
 * lecture, un périjove postérieur à cette date est une PRÉDICTION, un minimum de bord n'est pas
 * listé.
 *
 * Écrit `src/seo/perijoves.json` (dossier jamais livré au client, `src/buildOnly.ts`). `--offline`
 * refuse le réseau (cache `.cache/perijoves/`), `--check` n'écrit rien et sort en code 1 si le
 * fichier livré a dérivé.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameWithinShippedWindow } from './perihelia-compare.mjs';
import {
  horizonsRelative,
  norm,
  OutsideCoverage,
} from './horizons-relative.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'perijoves');
const OUT = join(ROOT, 'src/seo/perijoves.json');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2440587.5;
/** Tranche d'une lecture au pas d'une heure : 1 440 lignes. */
const CHUNK_MS = 60 * DAY;
const HALF_WINDOW_DAYS = 15;
const PREDICT_DAYS = 400;
/** Autour d'un minimum horaire : ±2 h à la minute, puis ±2 min à la seconde. */
const COARSE_HALF_MS = 2 * HOUR;
const FINE_HALF_MS = 2 * 60_000;
/** Le tableau de la NASA donne des jours : un jour d'écart est la précision de ce témoin. */
const WITNESS_TOLERANCE_MS = DAY;

const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
const CHECK = argv.includes('--check');

const PROBE = 'juno';
const BODY = 'jupiter';
/** Le fichier d'éphémérides centré sur Jupiter, qui borne la fenêtre. */
const FILE = 'juno--jupiter-2024-10-22';

const { targets, centers } = JSON.parse(
  readFileSync(join(ROOT, 'scripts/validation-targets.json'), 'utf8')
);
const manifest = JSON.parse(
  readFileSync(join(ROOT, 'public/assets/ephemerides/manifest.json'), 'utf8')
);
const witnessFile = JSON.parse(
  readFileSync(join(ROOT, 'scripts/juno-perijove-witnesses.json'), 'utf8')
);
const jupiterRadiusKm = JSON.parse(
  readFileSync(join(ROOT, 'src/registry/entities/jupiter.json'), 'utf8')
).facts.radiusKm.value;

const { relative } = horizonsRelative({
  cacheDir: CACHE_DIR,
  offline: OFFLINE,
  targets,
  centers,
});

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const msOfJd = (jd) => Math.round((jd - UNIX_EPOCH_JD) * MS_PER_DAY);

/** Les minima locaux d'une série horaire, hors bords, et le plus petit de chaque demi-fenêtre. */
function localMinima(rows) {
  const half = HALF_WINDOW_DAYS * 24;
  const found = [];
  for (let i = half; i < rows.length - half; i++) {
    const r = norm(rows[i].p);
    let lowest = true;
    for (let j = i - half; j <= i + half && lowest; j++)
      if (j !== i && norm(rows[j].p) < r) lowest = false;
    if (lowest) found.push(i);
  }
  return found;
}

const lowestRow = (rows) =>
  rows.reduce((best, row) => (norm(row.p) < norm(best.p) ? row : best));

const file = manifest.bodies[FILE];
const startMs = msOfJd(file.startJdTdb);
const endMs = msOfJd(file.startJdTdb + file.stepDays * (file.sampleCount - 1));

const rows = [];
let retrieved = null;
let solution = null;
let cappedEnd = endMs;
for (let from = startMs; from < cappedEnd; from += CHUNK_MS) {
  let chunk;
  try {
    chunk = await relative(
      PROBE,
      BODY,
      from,
      Math.min(from + CHUNK_MS, cappedEnd),
      '1h'
    );
  } catch (error) {
    if (!(error instanceof OutsideCoverage)) throw error;
    break;
  }
  retrieved = [retrieved, chunk.retrieved].filter(Boolean).sort().at(-1);
  solution ??= chunk.solution ?? null;
  rows.push(...(rows.length ? chunk.rows.slice(1) : chunk.rows));
  if (retrieved)
    cappedEnd = Math.min(
      endMs,
      Date.parse(`${retrieved}T00:00:00Z`) + PREDICT_DAYS * DAY
    );
}
if (rows.length === 0)
  throw new Error(`${PROBE} : aucune ligne lue chez Horizons`);
const bounds = [
  { probe: PROBE, from: iso(rows[0].at), to: iso(rows.at(-1).at), retrieved },
];

const perijoves = [];
for (const [index, i] of localMinima(rows).entries()) {
  const coarse = await relative(
    PROBE,
    BODY,
    rows[i].at - COARSE_HALF_MS,
    rows[i].at + COARSE_HALF_MS,
    '240'
  );
  const minute = lowestRow(coarse.rows);
  const fine = await relative(
    PROBE,
    BODY,
    minute.at - FINE_HALF_MS,
    minute.at + FINE_HALF_MS,
    '240'
  );
  const at = lowestRow(fine.rows);
  const distanceKm = norm(at.p);
  perijoves.push({
    probe: PROBE,
    pj: index + 1,
    at: iso(at.at),
    distanceKm: Math.round(distanceKm * 1000) / 1000,
    altitudeKm: Math.round((distanceKm - jupiterRadiusKm) * 1000) / 1000,
    speedKmS: Math.round(norm(at.v) * 1e6) / 1e6,
    solution: fine.solution ?? solution,
    retrieved: [coarse.retrieved, fine.retrieved].sort().at(-1),
  });
}

// Les témoins de la NASA : chaque numéro publié doit tomber sur le minimum mesuré qui le porte.
for (const [number, day] of Object.entries(witnessFile.perijoves)) {
  const found = perijoves.find((p) => p.pj === Number(number));
  const gap = found
    ? Math.abs(Date.parse(found.at) - Date.parse(`${day}T12:00:00Z`))
    : Infinity;
  if (gap > WITNESS_TOLERANCE_MS + 12 * HOUR)
    throw new Error(
      `PJ${number} : la NASA publie ${day}, le minimum de rang ${number} mesuré est ${found?.at ?? 'absent'} (numérotation ou série à revoir)`
    );
}

const output = `${JSON.stringify(
  {
    $comment:
      'Écrit par `pnpm perijoves:generate` (scripts/generate-perijoves.mjs), jamais à la main. Chaque minimum local de la distance de Juno au centre de Jupiter, lu dans Horizons à l’heure, à la minute puis à la seconde ; `pj` est le numéro de la NASA (PJ1 à PJ76 confrontés à son tableau par scripts/juno-perijove-witnesses.json, au-delà il prolonge la série) ; altitude = distance au centre moins le rayon équatorial de la fiche de Jupiter ; un périjove postérieur à sa date de lecture est une prédiction. `bounds` : la fenêtre réellement lue.',
    source:
      'NASA/JPL Horizons, CENTER 500@599, ECLIPTIC J2000, VEC_CORR NONE, UT ; rayon de Jupiter de la fiche de Galaxy ; numérotation : NASA Science, Juno Orbits',
    jupiterRadiusKm,
    halfWindowDays: HALF_WINDOW_DAYS,
    witnessedUpTo: Math.max(...Object.keys(witnessFile.perijoves).map(Number)),
    bounds,
    perijoves,
  },
  null,
  2
)}\n`;

if (CHECK) {
  const shipped = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (!sameWithinShippedWindow(shipped, output, 'perijoves')) {
    console.error(`${OUT} a dérivé : relancer pnpm perijoves:generate`);
    process.exit(1);
  }
  console.log(`${perijoves.length} périjoves, à jour`);
} else {
  writeFileSync(OUT, output);
  for (const p of perijoves)
    console.log(
      `PJ${p.pj}  ${p.at}  ${p.distanceKm} km  alt ${p.altitudeKm} km  ${p.speedKmS} km/s`
    );
}
