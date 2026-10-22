#!/usr/bin/env node
/* global console, process */
/**
 * LES PÉRIHÉLIES, MESURÉS SUR LA TRAJECTOIRE (pages `/perihelia/`, lot 69, 2026-10-22).
 *
 * CE QUI EST MESURÉ. Pour Parker Solar Probe et Solar Orbiter, chaque minimum LOCAL de la distance
 * au centre du Soleil, lu dans Horizons (CENTER 500@10, écliptique J2000, UT) : à l'heure sur la
 * fenêtre que le manifeste d'éphémérides livre pour la sonde, puis à la minute, puis à la
 * seconde. Un minimum est local s'il est le plus petit de sa demi-fenêtre de `HALF_WINDOW_DAYS`
 * jours de chaque côté : les plus courtes orbites héliocentriques de ces deux sondes durent 88 et
 * plus de 150 jours, donc deux périhélies ne tombent jamais dans la même fenêtre, et les
 * ondulations d'un survol de Vénus ou de la Terre (quelques heures) n'en fabriquent pas.
 *
 * TÉMOINS, lus à la source avant d'écrire une ligne (NASA Science, « NASA's Parker Solar Probe
 * Makes History With Closest Pass to Sun », et son suivi) : le 2024-12-24 Parker est passé à
 * 3,8 millions de milles AU-DESSUS DE LA SURFACE à environ 430 000 mph, et a ÉGALÉ ce record les
 * 2025-03-22 et 2025-06-19. `src/seo/perihelionPages.test.ts` les confronte au relevé livré.
 *
 * LES BORNES. La fenêtre va du début du fichier livré à sa fin, plafonnée à `PREDICT_DAYS` jours
 * après la date de lecture de la réponse : au-delà, une prédiction n'est plus une information.
 * Un périhélie postérieur à la date de lecture est une PRÉDICTION, publiée comme telle (même
 * règle que les survols). Un minimum au BORD de la fenêtre n'est pas un périhélie (la trajectoire
 * ne montre pas qu'elle remonte) et n'est pas listé.
 *
 * Écrit `src/seo/perihelia.json` (dossier jamais livré au client, `src/buildOnly.ts`). `--offline`
 * refuse le réseau (cache `.cache/perihelia/`), `--check` n'écrit rien et sort en code 1 si le
 * fichier livré a dérivé.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  horizonsRelative,
  norm,
  OutsideCoverage,
} from './horizons-relative.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'perihelia');
const OUT = join(ROOT, 'src/seo/perihelia.json');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2440587.5;
/** Tranche d'une lecture au pas d'une heure : 1 440 lignes. */
const CHUNK_MS = 60 * DAY;
const HALF_WINDOW_DAYS = 20;
const PREDICT_DAYS = 400;
/** Autour d'un minimum horaire : ±2 h à la minute, puis ±2 min à la seconde. */
const COARSE_HALF_MS = 2 * HOUR;
const FINE_HALF_MS = 2 * 60_000;

const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
const CHECK = argv.includes('--check');

const PROBES = ['parker-solar-probe', 'solar-orbiter'];

const { targets, centers } = JSON.parse(
  readFileSync(join(ROOT, 'scripts/validation-targets.json'), 'utf8')
);
const manifest = JSON.parse(
  readFileSync(join(ROOT, 'public/assets/ephemerides/manifest.json'), 'utf8')
);
const sunRadiusKm = JSON.parse(
  readFileSync(join(ROOT, 'src/registry/entities/sun.json'), 'utf8')
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

const perihelia = [];
const bounds = [];
for (const probe of PROBES) {
  const file = manifest.bodies[probe];
  const startMs = msOfJd(file.startJdTdb);
  const endMs = msOfJd(
    file.startJdTdb + file.stepDays * (file.sampleCount - 1)
  );

  // Une première lecture d'un jour pour fixer la date de lecture, puis la fenêtre plafonnée.
  const probeRows = [];
  let retrieved = null;
  let solution = null;
  let cappedEnd = endMs;
  for (let from = startMs; from < cappedEnd; from += CHUNK_MS) {
    let chunk;
    try {
      chunk = await relative(
        probe,
        'sun',
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
    probeRows.push(...(probeRows.length ? chunk.rows.slice(1) : chunk.rows));
    if (retrieved)
      cappedEnd = Math.min(
        endMs,
        Date.parse(`${retrieved}T00:00:00Z`) + PREDICT_DAYS * DAY
      );
  }
  if (probeRows.length === 0)
    throw new Error(`${probe} : aucune ligne lue chez Horizons`);
  bounds.push({
    probe,
    from: iso(probeRows[0].at),
    to: iso(probeRows.at(-1).at),
    retrieved,
  });

  for (const i of localMinima(probeRows)) {
    const coarse = await relative(
      probe,
      'sun',
      probeRows[i].at - COARSE_HALF_MS,
      probeRows[i].at + COARSE_HALF_MS,
      '240'
    );
    const minute = lowestRow(coarse.rows);
    const fine = await relative(
      probe,
      'sun',
      minute.at - FINE_HALF_MS,
      minute.at + FINE_HALF_MS,
      '240'
    );
    const at = lowestRow(fine.rows);
    const distanceKm = norm(at.p);
    perihelia.push({
      probe,
      at: iso(at.at),
      distanceKm: Math.round(distanceKm * 1000) / 1000,
      altitudeKm: Math.round((distanceKm - sunRadiusKm) * 1000) / 1000,
      speedKmS: Math.round(norm(at.v) * 1e6) / 1e6,
      solution: fine.solution ?? solution,
      retrieved: [coarse.retrieved, fine.retrieved].sort().at(-1),
    });
  }
}

perihelia.sort((a, b) => a.at.localeCompare(b.at));
const output = `${JSON.stringify(
  {
    $comment:
      'Écrit par `pnpm perihelia:generate` (scripts/generate-perihelia.mjs), jamais à la main. Chaque minimum local de la distance au centre du Soleil de Parker Solar Probe et de Solar Orbiter, lu dans Horizons à l’heure, à la minute puis à la seconde ; altitude = distance au centre moins le rayon solaire de la fiche du Soleil ; un périhélie postérieur à sa date de lecture est une prédiction. `bounds` : la fenêtre réellement lue pour chaque sonde.',
    source:
      'NASA/JPL Horizons, CENTER 500@10, ECLIPTIC J2000, VEC_CORR NONE, UT ; rayon du Soleil de la fiche de Galaxy',
    sunRadiusKm,
    halfWindowDays: HALF_WINDOW_DAYS,
    bounds,
    perihelia,
  },
  null,
  2
)}\n`;

if (CHECK) {
  const shipped = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (shipped !== output) {
    console.error(`${OUT} a dérivé : relancer pnpm perihelia:generate`);
    process.exit(1);
  }
  console.log(`${perihelia.length} périhélies, à jour`);
} else {
  writeFileSync(OUT, output);
  for (const p of perihelia)
    console.log(
      `${p.at}  ${p.probe}  ${p.distanceKm} km  alt ${p.altitudeKm} km  ${p.speedKmS} km/s`
    );
}
