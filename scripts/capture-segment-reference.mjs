#!/usr/bin/env node
/* global URL, URLSearchParams, fetch, process */
/**
 * BEPICOLOMBO AUTOUR DE MERCURE, LU À HORIZONS (2026-10-06).
 *
 * Écrit `src/config/segmentReferenceVectors.json` : des vecteurs héliocentriques de
 * BepiColombo (écliptique J2000, centre du Soleil `500@10`, UA) servis par Horizons, que
 * `src/config/segmentReference.test.ts` confronte à la position que l'application COMPOSE sur
 * la phase où elle tourne autour de Mercure (Mercure héliocentrique + le segment relatif,
 * propagé à deux corps entre des ancres de 12 h). Aucun nombre n'y est saisi.
 *
 * Deux séries :
 *   - autour de CHAQUE manœuvre publiée au manifeste (`impulses` du segment), de 6 h avant à
 *     6 h après, toutes les 30 min : c'est là que l'interpolation peut casser ;
 *   - tous les 2 jours à 07:13 UT sur toute la couverture du segment, heure quelconque pour
 *     ne pas tomber sur les ancres.
 *
 * La trajectoire de BepiColombo est PRÉDITE au-delà de l'ajustement de l'ESA : après une
 * régénération du binaire, recapturer, sinon le test compare deux prédictions différentes.
 *
 *   node scripts/capture-segment-reference.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const OUT = new URL(
  '../src/config/segmentReferenceVectors.json',
  import.meta.url
);
const SEGMENT = 'bepicolombo-mercury';

const manifest = JSON.parse(
  readFileSync(
    new URL('../public/assets/ephemerides/manifest.json', import.meta.url),
    'utf8'
  )
);
const entry = manifest.bodies[SEGMENT];
if (!entry?.impulses?.length)
  throw new Error(`${SEGMENT} : aucune manœuvre au manifeste`);
const isoOfJd = (jd) =>
  new Date((jd - 2_440_587.5) * 86_400_000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');

async function vectors(start, stop, step) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${entry.target}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@10'",
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${step}'`,
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'J2000',
    OUT_UNITS: 'AU-D',
    VEC_TABLE: '1',
    VEC_CORR: 'NONE',
    CSV_FORMAT: 'YES',
    TIME_TYPE: 'UT',
  });
  const response = await fetch(`${API_URL}?${params}`, {
    headers: { 'User-Agent': 'Galaxy-Ephemeris-Generator/1.0' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { result } = await response.json();
  if (!/Target body name: BepiColombo/.test(result))
    throw new Error('Horizons n’a pas résolu BepiColombo');
  if (!/Reference frame : Ecliptic of J2000/.test(result))
    throw new Error('repère inattendu');
  const table = result.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!table) throw new Error('aucune ligne de vecteurs');
  return table
    .trim()
    .split('\n')
    .map((line) => {
      const cells = line.split(',').map((cell) => cell.trim());
      const jd = Number(cells[0]);
      return {
        date: new Date(
          Math.round((jd - 2_440_587.5) * 86_400_000)
        ).toISOString(),
        au: cells.slice(2, 5).map(Number),
      };
    });
}

const manoeuvres = [];
for (const jd of entry.impulses)
  manoeuvres.push(
    ...(await vectors(isoOfJd(jd - 0.25), isoOfJd(jd + 0.25), '30 m'))
  );
const first = entry.startJdTdb;
const last = entry.startJdTdb + (entry.sampleCount - 1) * entry.stepDays;
const span = await vectors(
  `${isoOfJd(first + 1).slice(0, 10)} 07:13`,
  `${isoOfJd(last - 1).slice(0, 10)} 07:13`,
  '2 d'
);

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      source: `NASA/JPL Horizons, COMMAND ${entry.target}, CENTER 500@10, ECLIPTIC J2000, UT`,
      generatedBy: 'node scripts/capture-segment-reference.mjs',
      segmentFile: entry.file,
      manoeuvres,
      span,
    },
    null,
    1
  )}\n`
);
process.stdout.write(
  `${manoeuvres.length} + ${span.length} vecteurs → ${OUT.pathname}\n`
);
