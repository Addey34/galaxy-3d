#!/usr/bin/env node
/* global console, process */
/**
 * LES SURVOLS, MESURÉS À LA SECONDE (pages `/flybys/`, 2026-10-12).
 *
 * POURQUOI CET OUTIL EXISTE. `pnpm ephemeris:flybys` DÉTECTE les rencontres et les mesure au
 * pas de 10 min, ce qui suffit à juger un segment mais pas à PUBLIER un point le plus proche :
 * Voyager 2 y passe au plus près de Neptune à 03:43 et 33 889 km, quand la sonde, à 27 km/s,
 * était 13 min plus tard à 29 240 km. Une page qui affiche une distance d'approche doit la
 * mesurer, pas la relire dans un échantillonnage fait pour autre chose.
 *
 * DEUX TIRAGES par rencontre, relatifs au CENTRE du corps (la Terre à son centre, 399, et non
 * au barycentre que la scène dessine : une distance d'approche publiée se compte du centre) :
 *   1. ±6 h au pas d'une minute autour du plus proche du plan ;
 *   2. ±90 s au pas d'une seconde autour du minimum trouvé.
 * Un petit corps qu'Horizons ne sert pas comme centre (Lutetia) se mesure par DIFFÉRENCE des
 * deux vecteurs héliocentriques, comme `measure-flybys.mjs` le fait déjà.
 *
 * CE QUI N'EST PAS UN SURVOL, DÉRIVÉ ET NON LISTÉ :
 *   - `departure` : le plan trouve le plus proche au PREMIER instant de la rencontre, c'est-à-dire
 *     que la rencontre commence avec la trajectoire elle-même. C'est le départ de la Terre, et
 *     sa fenêtre de six heures peut contenir le point bas de l'injection, que la règle du bord
 *     ne voit pas : ExoMars TGO y « survolait » la Terre à 7 127 km, quelques heures après son
 *     lancement (trouvé par `src/seo/flybyPages.test.ts` le 2026-10-12, la mesure fine tombant
 *     à 4 h 19 de celle du plan).
 *   - `edge` : le minimum tombe au BORD de la fenêtre. C'est un départ (la sonde s'éloigne de
 *     la Terre dès le premier échantillon du fichier) ou une arrivée que la couverture coupe ;
 *     aucune des deux n'a de point le plus proche.
 *   - `bound` : au minimum, l'énergie relative est NÉGATIVE (masse lue au catalogue) : c'est un
 *     périapse d'une phase en orbite (Juno, Cassini), pas une rencontre.
 *   - `unresolved` : le plan déclare la trajectoire servie non résolue (Hayabusa2 à Ryugu).
 *   - `phase` : l'instant tombe dans une phase `satelliteOf` que la fiche de la sonde DÉCLARE
 *     autour de ce corps (Rosetta à 67P, OSIRIS-REx à Bennu). Ce sont des opérations de
 *     proximité à quelques cm/s : l'énergie y est positive parce que la masse du corps est
 *     infime, et la mesure seule les aurait comptées comme des survols (constaté au premier
 *     tirage, 2026-10-12 : « 67P à 8 km, 0 km/s »).
 *
 * Écrit `src/seo/flybyEvents.json` (dossier jamais livré au client, `src/buildOnly.ts`). Chaque
 * survol porte la date de lecture de SA réponse (`scripts/fact-source-cache.mjs`), et un survol
 * postérieur à cette date est une PRÉDICTION, publiée comme telle.
 *
 * `--offline` refuse le réseau (cache `.cache/flyby-events/`), `--check` n'écrit rien et sort en
 * code 1 si le fichier livré a dérivé.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G_KM3,
  horizonsRelative,
  norm,
  OutsideCoverage,
} from './horizons-relative.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'flyby-events');
const OUT = join(ROOT, 'src/seo/flybyEvents.json');
const COARSE_HALF_MINUTES = 360;
const FINE_HALF_SECONDS = 90;

const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
const CHECK = argv.includes('--check');

const plan = JSON.parse(
  readFileSync(join(ROOT, 'src/config/flybyEncounters.json'), 'utf8')
);
/** Les phases où une sonde est déclarée en orbite autour d'un corps, lues dans sa fiche. */
const phasesOf = (probe) =>
  JSON.parse(
    readFileSync(join(ROOT, `src/registry/spacecraft/${probe}.json`), 'utf8')
  ).satelliteOf ?? [];
const { targets, centers } = JSON.parse(
  readFileSync(join(ROOT, 'scripts/validation-targets.json'), 'utf8')
);

// ─────────────────────────── le catalogue (masses, genres) ───────────────────────────

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
await loader.close();
const catalogue = new Map(flattenBodies(CELESTIAL_CONFIG));

// ─────────────────────────── Horizons, avec cache daté ───────────────────────────

const { relative: relativeOf } = horizonsRelative({
  cacheDir: CACHE_DIR,
  offline: OFFLINE,
  targets,
  centers,
});
const relative = (enc, fromMs, toMs, step) =>
  relativeOf(enc.probe, enc.planet, fromMs, toMs, step);

const nearest = (rows) =>
  rows.reduce((best, r, k) => (norm(r.p) < norm(rows[best].p) ? k : best), 0);

// ─────────────────────────── la mesure ───────────────────────────

/** Un minimum du plan à moins d'un pas du début de sa rencontre est son PREMIER échantillon. */
const FIRST_SAMPLE_MS = 60 * 60_000;

const events = [];
const excluded = [];
for (const enc of plan.encounters) {
  const key = { probe: enc.probe, body: enc.planet, planAt: enc.closestAt };
  if (enc.unresolved) {
    excluded.push({ ...key, reason: 'unresolved' });
    continue;
  }
  const planMs = Date.parse(enc.closestAt);
  if (planMs - Date.parse(enc.from) < FIRST_SAMPLE_MS) {
    excluded.push({ ...key, reason: 'departure' });
    continue;
  }
  if (
    phasesOf(enc.probe).some(
      (phase) =>
        phase.body === enc.planet &&
        Date.parse(phase.from) <= planMs &&
        planMs < Date.parse(phase.to)
    )
  ) {
    excluded.push({ ...key, reason: 'phase' });
    continue;
  }
  let coarse;
  try {
    coarse = await relative(
      enc,
      planMs - COARSE_HALF_MINUTES * 60_000,
      planMs + COARSE_HALF_MINUTES * 60_000,
      '1m'
    );
  } catch (error) {
    if (!(error instanceof OutsideCoverage)) throw error;
    excluded.push({ ...key, reason: 'edge' });
    continue;
  }
  const k = nearest(coarse.rows);
  if (k === 0 || k === coarse.rows.length - 1) {
    excluded.push({ ...key, reason: 'edge' });
    continue;
  }
  const at = coarse.rows[k].at;
  const fine = await relative(
    enc,
    at - FINE_HALF_SECONDS * 1000,
    at + FINE_HALF_SECONDS * 1000,
    String(2 * FINE_HALF_SECONDS)
  );
  const j = nearest(fine.rows);
  if (j === 0 || j === fine.rows.length - 1)
    throw new Error(
      `${enc.probe} / ${enc.planet} : minimum fin au bord de sa fenêtre`
    );
  const best = fine.rows[j];
  const r = norm(best.p);
  const speed = norm(best.v);
  const massKg = catalogue.get(enc.planet)?.realData?.massKg;
  if (!(massKg > 0))
    throw new Error(`aucune masse au catalogue pour ${enc.planet}`);
  const energy = (speed * speed) / 2 - (G_KM3 * massKg) / r;
  if (energy <= 0) {
    excluded.push({ ...key, reason: 'bound' });
    continue;
  }
  events.push({
    probe: enc.probe,
    body: enc.planet,
    closestAt: new Date(best.at).toISOString().replace('.000Z', 'Z'),
    closestKm: Math.round(r),
    speedKmS: Math.round(speed * 100) / 100,
    solution: fine.solution ?? null,
    measuredFrom: fine.measuredFrom,
    retrieved: [coarse.retrieved, fine.retrieved].sort().at(-1),
  });
}

events.sort((a, b) => a.closestAt.localeCompare(b.closestAt));
const output = `${JSON.stringify(
  {
    $comment:
      'Écrit par `pnpm flybys:generate` (scripts/generate-flyby-events.mjs), jamais à la main. Point le plus proche de chaque survol que `src/config/flybyEncounters.json` détecte, mesuré à la seconde contre Horizons, relatif au CENTRE du corps. `excluded` : ce que la mesure écarte, avec sa raison (departure : la rencontre commence avec la trajectoire, c’est un départ ; edge : minimum au bord de la fenêtre, ou fenêtre hors de la couverture ; bound : périapse d’une orbite ; unresolved : trajectoire servie non résolue ; phase : opérations de proximité dans une phase `satelliteOf` déclarée).',
    source:
      'NASA/JPL Horizons, CENTER 500@<corps> (différence de deux vecteurs héliocentriques quand le corps n’est pas un centre), ECLIPTIC J2000, VEC_CORR NONE, UT',
    events,
    excluded,
  },
  null,
  2
)}\n`;

if (CHECK) {
  const shipped = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (shipped !== output) {
    console.error(`${OUT} a dérivé : relancer pnpm flybys:generate`);
    process.exit(1);
  }
  console.log(`${events.length} survols, à jour`);
} else {
  writeFileSync(OUT, output);
  console.log(
    `${events.length} survols écrits ; écartés : ${excluded.length} (${[
      'departure',
      'edge',
      'bound',
      'phase',
      'unresolved',
    ]
      .map((r) => `${r} ${excluded.filter((e) => e.reason === r).length}`)
      .join(', ')})`
  );
}
