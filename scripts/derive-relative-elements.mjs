#!/usr/bin/env node
/* global console, process */
/**
 * Dérive les éléments képlériens relatifs des satellites DEPUIS les binaires Horizons
 * committés, et les imprime prêts à coller dans le catalogue.
 *
 * Pourquoi ce script existe. `relativeOrbitalElements` est le repli utilisé quand un fichier
 * Horizons est absent, hors couverture ou invalidé — notamment si les assets ne se chargent
 * pas, auquel cas le repli sert AUX DATES COURANTES. Ces éléments avaient été saisis à la
 * main depuis des sources hétérogènes, et quatre d'entre eux étaient dans le mauvais repère :
 * Charon et Encelade à i = 0 (écliptique, alors que leur orbite est dans le plan équatorial
 * de leur planète), Phobos et Deimos à 1-2° (équatorial de Mars). Le repli les aurait donc
 * placés dans un plan orbital visiblement faux — une panne de CDN aurait suffi à le montrer.
 *
 * Le binaire, lui, porte des ÉTATS exacts (position + vitesse) en écliptique J2000, c'est-à-
 * dire exactement le repère qu'attend `kepler.ts`. On en extrait donc les éléments
 * osculateurs à une époque de référence : une seule source, vérifiable, et rien à saisir.
 *
 * Ce sont des éléments OSCULATEURS : ils décrivent la conique tangente à l'instant choisi,
 * sans les perturbations qui font ensuite précesser le nœud. C'est la nature même d'un repli
 * képlérien, et la précision se dégrade en s'éloignant de l'époque — `src/core/
 * relativeElements.test.ts` mesure cette dégradation et la borne.
 *
 *   node scripts/derive-relative-elements.mjs [--epoch 2026-01-01T00:00:00Z]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EPHEMERIDES_DIR = 'public/assets/ephemerides';
const COMPONENTS_PER_SAMPLE = 6;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2440587.5;
const DEG = 180 / Math.PI;

const epochArg = process.argv.indexOf('--epoch');
const EPOCH = new Date(
  epochArg !== -1 ? process.argv[epochArg + 1] : '2026-01-01T00:00:00Z'
);

/**
 * μ = G·M en UA³/jour². Masses des planètes en kg, reprises du catalogue (`realData.massKg`)
 * — la masse du satellite lui-même et celle de ce qui orbite à l'intérieur de son orbite
 * comptent aussi (cf. `src/config/gravity.ts`), Charon pesant 12,2 % de Pluton.
 */
const METRES_PER_AU = 1.495_978_707e11;
const G = (6.674_3e-11 / METRES_PER_AU ** 3) * 86_400 ** 2;

const PARENT_MASS_KG = {
  mars: 6.417e23,
  jupiter: 1.898e27,
  saturn: 5.683e26,
  uranus: 8.681e25,
  neptune: 1.024e26,
  // Pluton + Charon : le système est un binaire, ses satellites orbitent le barycentre.
  pluto: 1.303e22 + 1.586e21,
};

const manifest = JSON.parse(
  readFileSync(join(EPHEMERIDES_DIR, 'manifest.json'), 'utf-8')
);

/** État (position UA, vitesse UA/jour) d'un corps à une date, lu sur son binaire. */
function stateAt(name, date) {
  const entry = manifest.bodies[name];
  if (!entry) return null;
  const samples = new Float64Array(
    readFileSync(join(EPHEMERIDES_DIR, entry.file)).buffer.slice(0)
  );
  // Le manifeste date en TDB ; l'écart TDB-UTC (~70 s) est très en dessous du pas de 4 jours
  // et ne déplace pas l'échantillon retenu de façon significative pour un repli.
  const jd = date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
  const index = Math.round((jd - entry.startJdTdb) / entry.stepDays);
  if (index < 0 || index >= entry.sampleCount) return null;
  const i = index * COMPONENTS_PER_SAMPLE;
  const sampleDate = new Date(
    (entry.startJdTdb + index * entry.stepDays - UNIX_EPOCH_JD) * MS_PER_DAY
  );
  return {
    center: entry.center,
    date: sampleDate,
    r: [samples[i], samples[i + 1], samples[i + 2]],
    v: [samples[i + 3], samples[i + 4], samples[i + 5]],
  };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const TWO_PI = 2 * Math.PI;
const wrap = (x) => ((x % TWO_PI) + TWO_PI) % TWO_PI;

/** Éléments osculateurs classiques d'un état, dans le repère de cet état. */
function elementsFromState(r, v, mu) {
  const rLen = norm(r);
  const v2 = dot(v, v);
  const h = cross(r, v);
  const a = 1 / (2 / rLen - v2 / mu);

  // Vecteur excentricité : pointe vers le périastre, de norme e.
  const eVec = [0, 1, 2].map(
    (k) => ((v2 - mu / rLen) * r[k] - dot(r, v) * v[k]) / mu
  );
  const e = norm(eVec);

  const inclination = Math.acos(h[2] / norm(h));
  // Ligne des nœuds = ẑ × h.
  const node = [-h[1], h[0], 0];
  const nodeLen = norm(node);
  const ascendingNode = nodeLen > 0 ? wrap(Math.atan2(node[1], node[0])) : 0;

  // Argument du périastre, mesuré depuis le nœud ascendant dans le plan orbital.
  let argPeriapsis = 0;
  if (nodeLen > 0 && e > 0) {
    argPeriapsis = Math.acos(
      Math.min(1, Math.max(-1, dot(node, eVec) / (nodeLen * e)))
    );
    if (eVec[2] < 0) argPeriapsis = TWO_PI - argPeriapsis;
  }

  // Anomalie vraie -> excentrique -> moyenne.
  let trueAnomaly;
  if (e > 0) {
    trueAnomaly = Math.acos(
      Math.min(1, Math.max(-1, dot(eVec, r) / (e * rLen)))
    );
    if (dot(r, v) < 0) trueAnomaly = TWO_PI - trueAnomaly;
  } else {
    // Orbite circulaire : le périastre n'est pas défini, seule la position angulaire dans le
    // plan compte. On la porte entièrement par l'anomalie, argPeriapsis restant à 0.
    const cosU = dot(node, r) / (nodeLen * rLen);
    trueAnomaly = wrap(
      Math.acos(Math.min(1, Math.max(-1, cosU))) * (r[2] < 0 ? -1 : 1)
    );
  }
  const eccentricAnomaly =
    2 *
    Math.atan2(
      Math.sqrt(1 - e) * Math.sin(trueAnomaly / 2),
      Math.sqrt(1 + e) * Math.cos(trueAnomaly / 2)
    );
  const meanAnomaly = wrap(eccentricAnomaly - e * Math.sin(eccentricAnomaly));

  return {
    a,
    e,
    inclination,
    ascendingNode,
    argPeriapsis,
    meanAnomaly,
    periodDays: TWO_PI * Math.sqrt(a ** 3 / mu),
  };
}

const asJson = process.argv.includes('--json');
/**
 * Mode ELEMENTS MOYENS. Les elements osculateurs supposent un centre fixe ; c'est faux pour un
 * satellite qui orbite un barycentre deporte. Dans le systeme de Pluton, Charon pese 12,2 % du
 * couple et deplace Pluton de ~2 100 km : l'etat instantane des quatre petites lunes decrit
 * alors une conique qui n'existe pas (Styx : periode osculatrice 47 j pour 20,2 j reels).
 *
 * Ce mode mesure donc les grandeurs MOYENNES sur une fenetre longue, ou le ballant se compense :
 * plan orbital = direction moyenne du moment cinetique, demi-grand axe = rayon moyen, phase =
 * angle dans ce plan a l'epoque. La periode, elle, vient du catalogue a l'execution.
 *
 *   node scripts/derive-relative-elements.mjs --mean styx nix kerberos hydra
 */
const asMean = process.argv.includes('--mean');
const MEAN_WINDOW_DAYS = 400;
const jsonOut = {};

/** Elements MOYENS d'un corps, mesures sur une fenetre longue (cf. `--mean`). */
function meanElementsFromWindow(name) {
  const first = stateAt(name, EPOCH);
  if (!first) return null;

  let hSum = [0, 0, 0];
  let radiusSum = 0;
  let count = 0;
  for (
    let day = 0;
    day < MEAN_WINDOW_DAYS;
    day += manifest.bodies[name].stepDays
  ) {
    const st = stateAt(name, new Date(EPOCH.getTime() + day * MS_PER_DAY));
    if (!st) break;
    const h = cross(st.r, st.v);
    const hLen = norm(h);
    hSum = hSum.map((x, k) => x + h[k] / hLen);
    radiusSum += norm(st.r);
    count++;
  }
  if (count === 0) return null;

  const hHat = hSum.map((x) => x / norm(hSum));
  const a = radiusSum / count;
  const inclination = Math.acos(hHat[2]);
  const node = [-hHat[1], hHat[0], 0];
  const nodeLen = norm(node);
  const nodeHat = node.map((x) => x / nodeLen);

  // Argument de latitude a l'epoque : le perigee n'etant pas defini pour une orbite prise
  // circulaire, toute la phase est portee par l'anomalie moyenne.
  const r0 = first.r;
  const r0Len = norm(r0);
  const argLatitude = wrap(
    Math.atan2(dot(cross(hHat, nodeHat), r0) / r0Len, dot(nodeHat, r0) / r0Len)
  );

  return {
    a,
    e: 0,
    inclination,
    ascendingNode: wrap(Math.atan2(node[1], node[0])),
    argPeriapsis: 0,
    meanAnomaly: argLatitude,
    periodDays: NaN, // vient du catalogue : la periode osculatrice n'a pas de sens ici
    date: first.date,
    samples: count,
  };
}

/** Noms passes en argument : restreint la sortie a ces corps. Vide = tous les satellites. */
const requested = new Set(
  process.argv.slice(2).filter((arg, i, all) => {
    if (arg.startsWith('--')) return false;
    return all[i - 1] !== '--epoch'; // la valeur d'--epoch n'est pas un nom de corps
  })
);

const satellites = Object.entries(manifest.bodies)
  .filter(([, entry]) => entry.center && entry.center !== 'sun')
  .map(([name]) => name)
  .filter((name) => requested.size === 0 || requested.has(name))
  .sort();

if (!asJson) {
  console.log(`// Époque de référence : ${EPOCH.toISOString()}`);
  console.log(
    `// Source : ${EPHEMERIDES_DIR}/*.bin (états exacts, écliptique J2000)`
  );
  console.log(
    `// Généré par scripts/derive-relative-elements.mjs — ne pas éditer à la main.\n`
  );
}

for (const name of satellites) {
  const state = stateAt(name, EPOCH);
  if (!state) {
    console.log(`// ${name}: hors couverture`);
    continue;
  }
  const mass = PARENT_MASS_KG[state.center];
  if (mass === undefined) {
    console.log(`// ${name}: masse inconnue pour le centre "${state.center}"`);
    continue;
  }
  const el = asMean
    ? meanElementsFromWindow(name)
    : elementsFromState(state.r, state.v, G * mass);
  if (!el) {
    console.log(`// ${name}: fenetre insuffisante`);
    continue;
  }
  if (asJson) {
    jsonOut[name] = {
      center: state.center,
      epoch: state.date.toISOString(),
      periodDays: el.periodDays,
      semiMajorAxisAU: el.a,
      eccentricity: el.e,
      inclinationDeg: el.inclination * DEG,
      ascendingNodeDeg: el.ascendingNode * DEG,
      argPeriapsisDeg: el.argPeriapsis * DEG,
      meanAnomalyDeg: el.meanAnomaly * DEG,
    };
    continue;
  }
  console.log(
    asMean
      ? `// ${name} (autour de ${state.center}) — elements MOYENS sur ${MEAN_WINDOW_DAYS} j (${el.samples} echantillons)`
      : `// ${name} (autour de ${state.center}) — période ${el.periodDays.toFixed(4)} j`
  );
  console.log(`relativeOrbitalElements: {`);
  console.log(`  semiMajorAxisAU: ${el.a.toPrecision(10)},`);
  console.log(`  eccentricity: ${el.e.toPrecision(6)},`);
  console.log(`  inclinationRad: ${(el.inclination * DEG).toFixed(4)} * D2R,`);
  console.log(
    `  ascendingNodeRad: ${(el.ascendingNode * DEG).toFixed(4)} * D2R,`
  );
  console.log(
    `  argPerihelionRad: ${(el.argPeriapsis * DEG).toFixed(4)} * D2R,`
  );
  console.log(
    `  meanAnomalyAtEpochRad: ${(el.meanAnomaly * DEG).toFixed(4)} * D2R,`
  );
  console.log(`  epoch: new Date('${state.date.toISOString()}'),`);
  console.log(`},\n`);
}

if (asJson) console.log(JSON.stringify(jsonOut, null, 2));
