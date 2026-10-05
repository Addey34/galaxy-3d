#!/usr/bin/env node
/* global URL, URLSearchParams, fetch, process */
/**
 * LA POSITION COMPOSÉE DE DIMORPHOS, LUE À HORIZONS (2026-10-05).
 *
 * Écrit `src/config/compositeReferenceVectors.json` : des vecteurs héliocentriques de
 * Dimorphos (écliptique J2000, centre du Soleil `500@10`, UA) servis par Horizons, que
 * `src/config/compositeReference.test.ts` confronte à la position que l'application COMPOSE
 * (Didymos héliocentrique + Dimorphos relatif, depuis les binaires livrés). Aucun nombre n'y
 * est saisi.
 *
 * Deux séries :
 *   - le jour de l'impact de DART, heure par heure : c'est l'intervalle où la vitesse saute
 *     (cf. `impulses` au manifeste) et le seul où l'écart dépassait le diamètre au pas d'un jour ;
 *   - tous les 60 jours sur l'intervalle où Didymos est lu sur son primaire.
 *
 * Les instants sont demandés en UT et jamais à minuit d'un 1er janvier ou d'un 1er juillet :
 * à une seconde intercalaire, l'UT d'Horizons et la date JavaScript diffèrent d'une seconde,
 * soit 30 km à la vitesse de Didymos (mesuré : les cinq seuls écarts de 15 à 34 km d'une
 * mesure toutes les 12 h tombaient exactement sur les cinq secondes intercalaires de 2001-2025).
 *
 *   node scripts/capture-composite-reference.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const OUT = new URL(
  '../src/config/compositeReferenceVectors.json',
  import.meta.url
);
const TARGET = '120065803';

const manifest = JSON.parse(
  readFileSync(
    new URL('../public/assets/ephemerides/manifest.json', import.meta.url),
    'utf8'
  )
);
const { primary } = manifest.bodies.didymos;
if (!primary)
  throw new Error('didymos : aucun intervalle `primary` au manifeste');
const isoOfJd = (jd) =>
  new Date((jd - 2_440_587.5) * 86_400_000).toISOString().slice(0, 10);

async function vectors(start, stop, step) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${TARGET}'`,
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
  if (!/Target body name: Dimorphos/.test(result))
    throw new Error('Horizons n’a pas résolu Dimorphos');
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

const impactDay = await vectors('2022-09-26 00:00', '2022-09-27 23:00', '1 h');
// Midi : jamais une seconde intercalaire. Premier et dernier jour pleins DANS l'intervalle.
const span = await vectors(
  `${isoOfJd(primary.fromJdTdb + 1)} 12:00`,
  `${isoOfJd(primary.toJdTdb - 1)} 12:00`,
  '60 d'
);

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      source: `NASA/JPL Horizons, COMMAND ${TARGET}, CENTER 500@10, ECLIPTIC J2000, UT`,
      generatedBy: 'node scripts/capture-composite-reference.mjs',
      impactDay,
      span,
    },
    null,
    1
  )}\n`
);
process.stdout.write(
  `${impactDay.length} + ${span.length} vecteurs → ${OUT.pathname}\n`
);
