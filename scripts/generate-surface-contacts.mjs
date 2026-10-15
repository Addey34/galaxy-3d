#!/usr/bin/env node
/* global console, process */
/**
 * LES CONTACTS D'UNE SONDE AVEC UN CORPS, MESURÉS SUR LA TRAJECTOIRE (pages `/contacts/`,
 * lot 49, pas 3, 2026-10-15).
 *
 * CE QUI EST MESURÉ. Deux signatures, lues dans la trajectoire que sert Horizons et nulle part
 * ailleurs :
 *   - LE REPOS (petit corps) : la distance au centre CESSE DE VARIER. La trajectoire porte alors
 *     la sonde avec la surface qui tourne : vitesse radiale nulle à 2 mm/s près, pendant au moins
 *     trois secondes. Mesuré avant d'écrire une ligne : Rosetta sur 67P (2,0254 km du centre à
 *     10:39:34 UT le 2016-09-30, puis la distance ne bouge plus jusqu'à la fin de la trajectoire)
 *     et OSIRIS-REx sur Bennu (0,22425 km le 2020-10-20 de 21:50:11 à 21:50:17, puis la sonde
 *     repart). Le premier est une fin (`rest`), le second un contact bref (`touch`) ;
 *   - LE NIVEAU DE 1 BAR (planète géante, sans surface solide) : la sonde passe sous
 *     l'ellipsoïde de référence, rayons du noyau PCK de l'UAI et latitude planétocentrique au
 *     pôle de l'UAI à la date (`entry`). PIÈGE mesuré : Horizons PROLONGE l'arc de Cassini à
 *     travers Saturne jusqu'à 23 000 km du centre ; le minimum de distance n'est donc pas
 *     l'événement, le passage du niveau l'est.
 *
 * LES TÉMOINS, d'une autre nature que le critère :
 *   - au repos, la vitesse de la sonde est celle d'un point de la surface : elle ne dépasse pas
 *     ω·r, ω étant la période de rotation de la FICHE du corps (`rotationSpeedKmS` publié) ;
 *   - au niveau de 1 bar, la vitesse relative à la planète en rotation (période et pôle du PCK)
 *     est petite devant la vitesse maximale atteinte juste avant (`peak`) : la trajectoire a
 *     RALENTI dans l'atmosphère, ce n'est pas une chute libre qui traverse une sphère.
 *
 * DÉTECTION, pour chaque rencontre du plan `src/config/flybyEncounters.json` (un départ, plus
 * proche à moins d'une heure du début, n'est pas examiné) : seules celles dont la distance la
 * plus proche du plan passe sous deux fois le plus grand rayon du corps sont lues (rayon du PCK,
 * sinon rayon du catalogue fois l'élongation mesurée du modèle de forme). Une rencontre que le
 * plan déclare non résolue est écartée avec sa raison (`unresolved`, Hayabusa2 à Ryugu).
 *
 * Écrit `src/seo/surfaceContacts.json`. `--offline` (cache `.cache/surface-contacts/`), `--check`.
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
const CACHE_DIR = join(ROOT, '.cache', 'surface-contacts');
const OUT = join(ROOT, 'src/seo/surfaceContacts.json');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Vitesse radiale tenue pour nulle : 2 mm/s (OSIRIS-REx posée : 0,8 à 1,1 mm/s). */
const REST_KMS = 2e-6;
/** Un repos dure au moins trois secondes : un demi-tour de manœuvre en passe moins d'une. */
const REST_SECONDS = 3;

const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
const CHECK = argv.includes('--check');

const plan = JSON.parse(
  readFileSync(join(ROOT, 'src/config/flybyEncounters.json'), 'utf8')
);
const { targets, centers } = JSON.parse(
  readFileSync(join(ROOT, 'scripts/validation-targets.json'), 'utf8')
);
const snapshot = JSON.parse(
  readFileSync(join(ROOT, 'src/config/factSources.snapshot.json'), 'utf8')
);
const fiche = (id) =>
  JSON.parse(
    readFileSync(join(ROOT, `src/registry/entities/${id}.json`), 'utf8')
  );

// ─────────────────────────── le catalogue, le pôle ───────────────────────────

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
const { spinAngularMomentum, equatorialToEcliptic, centuriesFromJ2000 } =
  await loader.ssrLoadModule('/src/core/iauPole.ts');
await loader.close();
const catalogue = new Map(flattenBodies(CELESTIAL_CONFIG));
const naif = snapshot.naifRotation;

/** Planète géante : la fiche du NSSDCA ne publie de sa pression « de surface » qu'une borne. */
const isGiant = (id) =>
  snapshot.nssdca.bodies[id]?.surfacePressure?.lowerBound === true;

/** Le plus grand rayon du corps, en km : PCK, sinon catalogue fois l'élongation du modèle. */
function largestRadiusKm(id) {
  const radii = naif.bodies[id]?.radiiKm;
  if (radii) return Math.max(...radii);
  const radius = catalogue.get(id)?.realData?.radiusKm;
  if (!(radius > 0)) return null;
  return radius * (fiche(id).elements?.model?.extentRatio ?? 1);
}

/** Période de rotation de la fiche, en heures (`null` si elle n'en publie pas). */
const rotationHours = (id) => {
  const value = fiche(id).facts?.rotationPeriod?.value;
  return typeof value === 'number' ? value : null;
};

const { relative } = horizonsRelative({
  cacheDir: CACHE_DIR,
  offline: OFFLINE,
  targets,
  centers,
  fallbackToDifference: true,
});

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const radialSpeed = (row) => dot(row.p, row.v) / norm(row.p);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Lecture tolérante à la fin de couverture : la fenêtre se raccourcit par pas d'une heure. */
async function readUntilCovered(probe, body, fromMs, toMs, step) {
  for (let end = toMs; end > fromMs; end -= HOUR) {
    try {
      return await relative(probe, body, fromMs, end, step);
    } catch (error) {
      if (!(error instanceof OutsideCoverage)) throw error;
    }
  }
  throw new Error(`${probe} / ${body} : rien de servi après ${iso(fromMs)}`);
}

/** Lecture à la seconde entre deux instants (Horizons : pas « N » = N intervalles). */
const seconds = (probe, body, fromMs, toMs) =>
  relative(
    probe,
    body,
    fromMs,
    toMs,
    String(Math.round((toMs - fromMs) / 1000))
  );

/** Premier indice d'une suite d'au moins `REST_SECONDS` échantillons immobiles, ou −1. */
function firstRest(rows) {
  for (let i = 0; i + REST_SECONDS <= rows.length; i++)
    if (
      rows
        .slice(i, i + REST_SECONDS)
        .every((r) => Math.abs(radialSpeed(r)) < REST_KMS)
    )
      return i;
  return -1;
}

// ─────────────────────────── le repos sur un petit corps ───────────────────────────

async function restOn(probe, body, enc, largest) {
  const fromMs = Date.parse(enc.from);
  const toMs = Date.parse(enc.to);
  const closest = Date.parse(enc.closestAt);
  // La minute : deux jours avant le plus proche du plan, plus tôt si la sonde y est déjà posée
  // (au repos, le « plus proche » du plan tombe n'importe où dans la pose).
  let start = Math.max(fromMs, closest - 2 * DAY);
  const end = Math.min(toMs, closest + 2 * HOUR);
  let minutes = await relative(probe, body, start, end, '1m');
  while (start > fromMs && Math.abs(radialSpeed(minutes.rows[0])) < REST_KMS) {
    start = Math.max(fromMs, start - 2 * DAY);
    minutes = await relative(probe, body, start, end, '1m');
  }
  const rows = minutes.rows;
  const candidates = new Set();
  const firstStill = rows.findIndex(
    (r, i) =>
      i + 1 < rows.length &&
      Math.abs(radialSpeed(r)) < REST_KMS &&
      Math.abs(radialSpeed(rows[i + 1])) < REST_KMS
  );
  if (firstStill >= 0) candidates.add(rows[firstStill].at);
  candidates.add(rows.reduce((a, r) => (norm(r.p) < norm(a.p) ? r : a)).at);
  for (const at of [...candidates].sort((a, b) => a - b)) {
    const table = await seconds(probe, body, at - 90_000, at + 90_000);
    const k = firstRest(table.rows);
    if (k < 0) continue;
    const contact = table.rows[k];
    if (norm(contact.p) > largest) continue;
    // Jusqu'où le repos dure : à la seconde dans la table, puis à la minute jusqu'à la fin de
    // la rencontre si la table s'achève encore au repos.
    let last = k;
    while (
      last + 1 < table.rows.length &&
      Math.abs(radialSpeed(table.rows[last + 1])) < REST_KMS
    )
      last++;
    let kind = 'touch';
    let leftAt = table.rows[last].at;
    if (last === table.rows.length - 1) {
      const after = await relative(probe, body, contact.at, toMs, '10m');
      const moving = after.rows.find(
        (r) => Math.abs(radialSpeed(r)) >= REST_KMS
      );
      if (moving)
        throw new Error(
          `${probe} / ${body} : un repos de plus de 90 s qui s'achève avant la fin (${iso(moving.at)}), forme non traitée`
        );
      kind = 'rest';
      leftAt = null;
    }
    const hours = rotationHours(body);
    const distanceKm = norm(contact.p);
    return {
      probe,
      body,
      kind,
      at: iso(contact.at),
      sceneAt: iso(contact.at),
      restSeconds: leftAt === null ? null : (leftAt - contact.at) / 1000,
      distanceKm: round(distanceKm, 5),
      speedKmS: round(norm(contact.v), 8),
      rotationSpeedKmS:
        hours === null
          ? null
          : round((2 * Math.PI * distanceKm) / (hours * 3600), 8),
      solution: table.solution ?? null,
      measuredFrom: table.measuredFrom,
      retrieved: [minutes.retrieved, table.retrieved].sort().at(-1),
    };
  }
  return null;
}

// ─────────────────────────── le niveau de 1 bar d'une géante ───────────────────────────

async function entryInto(probe, body, enc) {
  const [a, , c] = naif.bodies[body].radiiKm;
  const rotation = naif.bodies[body].rotation;
  const angles = naif.systems[naif.bodies[body].system] ?? [];
  const closest = Date.parse(enc.closestAt);
  const minutes = await readUntilCovered(
    probe,
    body,
    closest - 3 * HOUR,
    closest + HOUR,
    '1m'
  );
  const geometry = (row) => {
    const t = centuriesFromJ2000(new Date(row.at));
    const spin = equatorialToEcliptic(spinAngularMomentum(rotation, angles, t));
    const r = norm(row.p);
    const sinLat = dot(row.p, spin) / r;
    const cosLat = Math.sqrt(1 - sinLat * sinLat);
    const surface = 1 / Math.hypot(cosLat / a, sinLat / c);
    const omega = (Math.abs(rotation.pmRateDegPerDay) * Math.PI) / 180 / 86_400;
    const carried = cross(
      spin.map((x) => x * omega),
      row.p
    );
    return {
      altitudeKm: r - surface,
      latitudeDeg: (Math.asin(sinLat) * 180) / Math.PI,
      relativeKmS: norm(row.v.map((x, i) => x - carried[i])),
    };
  };
  const k = minutes.rows.findIndex((row) => geometry(row).altitudeKm <= 0);
  if (k <= 0) return null;
  const table = await seconds(
    probe,
    body,
    minutes.rows[k - 1].at,
    minutes.rows[k].at
  );
  const s = table.rows.findIndex((row) => geometry(row).altitudeKm <= 0);
  const crossing = table.rows[s];
  const at = geometry(crossing);
  const before = minutes.rows.slice(0, k);
  const peak = before.reduce((best, row) =>
    geometry(row).relativeKmS > geometry(best).relativeKmS ? row : best
  );
  return {
    probe,
    body,
    kind: 'entry',
    at: iso(crossing.at),
    // La sonde n'est plus dessinée sous le niveau : la scène s'ouvre une minute avant.
    sceneAt: iso(crossing.at - MINUTE),
    distanceKm: round(norm(crossing.p), 3),
    latitudeDeg: round(at.latitudeDeg, 3),
    relativeSpeedKmS: round(at.relativeKmS, 5),
    peak: {
      at: iso(peak.at),
      relativeSpeedKmS: round(geometry(peak).relativeKmS, 5),
      altitudeKm: round(geometry(peak).altitudeKm, 1),
    },
    solution: table.solution ?? null,
    measuredFrom: table.measuredFrom,
    retrieved: [minutes.retrieved, table.retrieved].sort().at(-1),
  };
}

// ─────────────────────────── la mesure ───────────────────────────

const contacts = [];
const excluded = [];
for (const enc of plan.encounters) {
  const { probe, planet: body } = enc;
  if (Date.parse(enc.closestAt) - Date.parse(enc.from) < HOUR) continue;
  if (enc.unresolved) {
    if (!excluded.some((e) => e.probe === probe && e.body === body))
      excluded.push({ probe, body, reason: 'unresolved' });
    continue;
  }
  const largest = largestRadiusKm(body);
  if (largest === null) throw new Error(`aucun rayon pour ${body}`);
  if (enc.closestKm > 2 * largest) continue;
  const found = isGiant(body)
    ? await entryInto(probe, body, enc)
    : await restOn(probe, body, enc, largest);
  if (found) contacts.push(found);
}

contacts.sort((a, b) => a.at.localeCompare(b.at));
excluded.sort((a, b) =>
  `${a.probe}/${a.body}`.localeCompare(`${b.probe}/${b.body}`)
);
const output = `${JSON.stringify(
  {
    $comment:
      'Écrit par `pnpm contacts:generate` (scripts/generate-surface-contacts.mjs), jamais à la main. Contacts d’une sonde avec un corps lus sur la trajectoire servie par Horizons, à la seconde : `rest`, la distance au centre cesse de varier jusqu’à la fin de la trajectoire ; `touch`, elle cesse de varier quelques secondes puis la sonde repart ; `entry`, la sonde passe sous le niveau de 1 bar d’une planète géante (ellipsoïde du noyau PCK, pôle de l’UAI). Témoins : `rotationSpeedKmS`, vitesse d’un point de la surface à cette distance par la période de la fiche ; `peak`, la plus grande vitesse relative à la planète en rotation avant le passage. `excluded` : unresolved, trajectoire servie non résolue près du corps.',
    source:
      'NASA/JPL Horizons, CENTER 500@<corps> (différence de deux vecteurs héliocentriques quand le corps n’est pas un centre), ECLIPTIC J2000, VEC_CORR NONE, UT ; rayons et pôles du noyau PCK de l’UAI (relevé des faits) ; périodes de rotation des fiches de Galaxy',
    contacts,
    excluded,
  },
  null,
  2
)}\n`;

if (CHECK) {
  const shipped = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (shipped !== output) {
    console.error(`${OUT} a dérivé : relancer pnpm contacts:generate`);
    process.exit(1);
  }
  console.log(`${contacts.length} contacts, à jour`);
} else {
  writeFileSync(OUT, output);
  for (const c of contacts)
    console.log(
      `${c.at}  ${c.kind}  ${c.probe} / ${c.body}  ${c.distanceKm} km  ${c.kind === 'entry' ? `${c.relativeSpeedKmS} km/s relatif, pic ${c.peak.relativeSpeedKmS} à ${c.peak.at}` : `${c.speedKmS} km/s ≤ ${c.rotationSpeedKmS} ; repos ${c.restSeconds ?? '∞'} s`}`
    );
  for (const e of excluded)
    console.log(`écarté  ${e.probe} / ${e.body}  ${e.reason}`);
}
