/* global Buffer, URLSearchParams, fetch, process */
/** Génère les vecteurs binaires NASA/JPL Horizons consommés par l'application. */
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = resolve(ROOT, 'public/assets/ephemerides');
const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const START_TIME = '1900-01-01';
const STOP_TIME = '2101-01-01';
const STEP_DAYS = 4;
/**
 * Pas plus fin pour les sondes dont la trajectoire a des événements rapides que 4 jours ne
 * résolvent pas : périhélie de Parker (190 km/s), périjoves de Juno et orbites saturniennes de
 * Cassini, arrivée de BepiColombo à Mercure, mise en route de JWST. Mesuré contre Horizons
 * (`pnpm ephemeris:validate`) avant le changement : erreur max 4,3e5 km (Parker), 1,56e6
 * (Juno), 4,1e5 (Cassini), 1,5e5 (BepiColombo), 1,5e4 (JWST). Ces fichiers pèsent 36 à
 * 85 Ko à 4 jours : le pas ciblé coûte peu, un pas global aurait quadruplé 29 Mo.
 */
const PROBE_EVENT_STEP_DAYS = 1;
const CENTER_IDS = {
  sun: '10',
  mars: '499',
  jupiter: '599',
  saturn: '699',
  uranus: '799',
  neptune: '899',
  pluto: '999',
};
// IMPORTANT — le point-virgule final sur COMMAND force Horizons à chercher dans la base des
// PETITS corps (astéroïdes/comètes) plutôt que dans la table des corps majeurs/satellites.
// C'est correct et nécessaire pour désambiguïser un numéro de petit corps (ex. Cérès = astéroïde
// 1 — sans ';' Horizons pourrait matcher autre chose). C'est en revanche une erreur silencieuse
// pour un ID de planète/satellite majeur (ex. 699 = Saturne) : '699;' matche l'astéroïde 699 Hela
// au lieu de Saturne — un bug réel qui a affecté cette liste (voir fetchBody : la vérification
// du nom de cible sert de garde-fou définitif contre toute régression de ce type).
const BODIES = [
  // Coupés à l'époque depuis le lot 11b (cf. `requestSplitAtSolutionEpoch`) : leurs fichiers
  // précédents, d'une seule requête 1900-2101, s'écartaient de 0,5 à 1 km de plus de la
  // référence corrigée que ceux des quatorze corps coupés.
  {
    name: 'ceres',
    target: '1;',
    expectedName: 'ceres',
    center: 'sun',
    splitAtSolutionEpoch: true,
  },
  {
    name: 'eris',
    target: '136199;',
    expectedName: 'eris',
    center: 'sun',
    splitAtSolutionEpoch: true,
  },
  {
    name: 'haumea',
    target: '136108;',
    expectedName: 'haumea',
    center: 'sun',
    splitAtSolutionEpoch: true,
  },
  {
    name: 'makemake',
    target: '136472;',
    expectedName: 'makemake',
    center: 'sun',
    splitAtSolutionEpoch: true,
  },
  // Lot 11 : les corps que seuls leurs éléments képlériens plaçaient (erreur moyenne sur
  // 1900-2100 de 1,4e4 km pour Sedna à 1,7e8 km pour Bennu). Mêmes COMMAND que
  // `scripts/validation-targets.json` : le binaire et sa validation lisent la même solution.
  //
  // Le pas n'est PAS celui des autres fichiers partout : c'est le plus grossier dont
  // l'interpolation, par le chemin même du service, reste sous 20 km d'écart MAXIMAL à des
  // vecteurs Horizons au pas d'un jour sur toute la plage (l'écart maximal déjà accepté du
  // fichier de Cérès, 19,6 km), et jamais plus fin que les 4 jours de tous les autres fichiers.
  // Mesuré par décimation de ces vecteurs d'un jour, écart moyen / maximal en km :
  //
  //   corps                    4 j            8 j           16 j          64 j
  //   Orcus, Quaoar, Gonggong,  0,002/0,006    0,004/0,017   0,043/0,215   5,2/19,3
  //   Sedna (identiques : c'est le ballant du Soleil autour du barycentre qui domine)
  //   Hygie                     0,025/0,077    0,336/1,2     5,0/19,3      572/8 160
  //   Ida                       0,034/0,068    0,456/1,06    6,8/17        486/3 910
  //   Vesta                     0,095/0,244    1,3/3,9       24/173
  //   Pallas                    0,074/0,361    1,0/5,8       15/92
  //   Psyché                    0,039/0,125    0,52/2,0      7,8/32
  //   Éros                      1,8/7,8        4,0/47
  //   Itokawa                   3,8/103        6,4/3 700
  //   Ryugu                     4,2/58         5,5/5 000
  //   Bennu                     5,9/1 150      8,2/13 400
  //   Halley                    0,6/485        8,1/6 670
  //
  // Les cinq derniers restent à 4 jours sans tenir les 20 km : leur écart maximal vient des
  // passages près de la Terre (Bennu, Itokawa, Ryugu) ou du périhélie (Halley), et il est de
  // cinq ordres de grandeur sous l'erreur des éléments qu'il remplace. Poids total 6,4 Mo, contre
  // 12,3 Mo au pas uniforme de 4 jours.
  //
  // `splitAtSolutionEpoch` : cf. `requestSplitAtSolutionEpoch`. Posé sur les quatorze, pas
  // seulement sur Itokawa et Ryugu où l'écart a été mesuré : partir de l'époque n'est jamais
  // moins juste, et c'est la seule manière de ne pas découvrir le prochain corps chaotique au
  // hasard d'une validation.
  {
    name: 'vesta',
    target: '4;',
    expectedName: 'vesta',
    center: 'sun',
    splitAtSolutionEpoch: true,
    stepDays: 8,
  },
  {
    name: 'pallas',
    target: '2;',
    expectedName: 'pallas',
    center: 'sun',
    splitAtSolutionEpoch: true,
    stepDays: 8,
  },
  {
    name: 'hygiea',
    target: '10;',
    expectedName: 'hygiea',
    center: 'sun',
    splitAtSolutionEpoch: true,
    stepDays: 16,
  },
  {
    name: 'psyche',
    target: '16;',
    expectedName: 'psyche',
    center: 'sun',
    splitAtSolutionEpoch: true,
    stepDays: 8,
  },
  {
    name: 'ida',
    target: '243;',
    expectedName: 'ida',
    center: 'sun',
    splitAtSolutionEpoch: true,
    stepDays: 16,
  },
  {
    name: 'eros',
    target: '433;',
    expectedName: 'eros',
    center: 'sun',
    splitAtSolutionEpoch: true,
  },
  {
    name: 'itokawa',
    target: '25143;',
    expectedName: 'itokawa',
    center: 'sun',
    splitAtSolutionEpoch: true,
  },
  {
    name: 'ryugu',
    target: '162173;',
    expectedName: 'ryugu',
    center: 'sun',
    splitAtSolutionEpoch: true,
  },
  {
    name: 'bennu',
    target: '101955;',
    expectedName: 'bennu',
    center: 'sun',
    // PAS de coupure : Horizons ne l'intègre pas, il le lit dans le fichier de trajectoire de la
    // mission OSIRIS-REx (en-tête « {source: ORX_merged_DE424} », sans ligne EPOCH), et la
    // requête longue coïncide avec une requête par liste de dates à 0,0 km (mesuré, lot 11).
    // Lu dans la réponse : « No ephemeris for target "101955 Bennu" prior to 1900-JAN-02 ».
    startTime: '1900-01-03',
  },
  // Numéro d'enregistrement de la solution de Horizons, le même que `validation-targets.json`.
  {
    name: 'halley',
    target: '90000030;',
    expectedName: 'halley',
    center: 'sun',
    splitAtSolutionEpoch: true,
  },
  {
    name: 'orcus',
    target: '90482;',
    expectedName: 'orcus',
    center: 'sun',
    splitAtSolutionEpoch: true,
    stepDays: 64,
  },
  {
    name: 'quaoar',
    target: '50000;',
    expectedName: 'quaoar',
    center: 'sun',
    splitAtSolutionEpoch: true,
    stepDays: 64,
  },
  {
    name: 'gonggong',
    target: '225088;',
    expectedName: 'gonggong',
    center: 'sun',
    splitAtSolutionEpoch: true,
    stepDays: 64,
  },
  {
    name: 'sedna',
    target: '90377;',
    expectedName: 'sedna',
    center: 'sun',
    splitAtSolutionEpoch: true,
    stepDays: 64,
  },
  // Jupiter et Uranus (lot 2b) : astronomy-engine y faisait 23 000 et 111 000 km d'erreur
  // moyenne contre Horizons sur 1900-2100, héritée telle quelle par toutes leurs lunes.
  { name: 'jupiter', target: '599', expectedName: 'jupiter', center: 'sun' },
  { name: 'uranus', target: '799', expectedName: 'uranus', center: 'sun' },
  { name: 'saturn', target: '699', expectedName: 'saturn', center: 'sun' },
  {
    name: 'enceladus',
    target: '602',
    expectedName: 'enceladus',
    center: 'saturn',
  },
  { name: 'rhea', target: '605', expectedName: 'rhea', center: 'saturn' },
  { name: 'titan', target: '606', expectedName: 'titan', center: 'saturn' },
  {
    name: 'iapetus',
    target: '608',
    expectedName: 'iapetus',
    center: 'saturn',
  },
  { name: 'mars', target: '499', expectedName: 'mars', center: 'sun' },
  { name: 'phobos', target: '401', expectedName: 'phobos', center: 'mars' },
  { name: 'deimos', target: '402', expectedName: 'deimos', center: 'mars' },
  { name: 'neptune', target: '899', expectedName: 'neptune', center: 'sun' },
  {
    name: 'triton',
    target: '801',
    expectedName: 'triton',
    center: 'neptune',
  },
  { name: 'pluto', target: '999', expectedName: 'pluto', center: 'sun' },
  { name: 'charon', target: '901', expectedName: 'charon', center: 'pluto' },
  {
    name: 'mimas',
    target: '601',
    expectedName: 'mimas',
    center: 'saturn',
  },
  {
    name: 'tethys',
    target: '603',
    expectedName: 'tethys',
    center: 'saturn',
  },
  { name: 'dione', target: '604', expectedName: 'dione', center: 'saturn' },
  {
    name: 'hyperion',
    target: '607',
    expectedName: 'hyperion',
    center: 'saturn',
  },
  {
    name: 'miranda',
    target: '705',
    expectedName: 'miranda',
    center: 'uranus',
  },
  { name: 'ariel', target: '701', expectedName: 'ariel', center: 'uranus' },
  {
    name: 'umbriel',
    target: '702',
    expectedName: 'umbriel',
    center: 'uranus',
  },
  {
    name: 'titania',
    target: '703',
    expectedName: 'titania',
    center: 'uranus',
  },
  {
    name: 'oberon',
    target: '704',
    expectedName: 'oberon',
    center: 'uranus',
  },
  {
    name: 'amalthea',
    target: '505',
    expectedName: 'amalthea',
    center: 'jupiter',
  },
  {
    name: 'proteus',
    target: '808',
    expectedName: 'proteus',
    center: 'neptune',
  },
  {
    name: 'nereid',
    target: '802',
    expectedName: 'nereid',
    center: 'neptune',
  },
  { name: 'styx', target: '905', expectedName: 'styx', center: 'pluto' },
  { name: 'nix', target: '902', expectedName: 'nix', center: 'pluto' },
  {
    name: 'kerberos',
    target: '904',
    expectedName: 'kerberos',
    center: 'pluto',
  },
  { name: 'hydra', target: '903', expectedName: 'hydra', center: 'pluto' },
  // Sondes spatiales — cibles JPL Horizons par ID négatif, pas de ';' final (contrairement aux
  // numéros de petits corps ambigus, ces IDs sont déjà uniques). `startTime` par corps évite de
  // demander des décennies de non-données à Horizons avant le lancement réel.
  {
    name: 'voyager1',
    target: '-31',
    expectedName: 'voyager 1',
    center: 'sun',
    // +1 jour après le lancement réel : Horizons n'a pas de vecteur au tout premier instant
    // (état initial encore indéterminé), une marge d'un jour tombe dans la couverture réelle.
    // `stopTime` : la solution de trajectoire Horizons pour une sonde est bornée dans le temps
    // (contrairement à la théorie planétaire) — au-delà, Horizons répond une erreur, pas des
    // données tronquées silencieusement. Bornes vérifiées une à une contre l'API réelle.
    startTime: '1977-09-06',
    stopTime: '2099-12-31',
  },
  {
    name: 'voyager2',
    target: '-32',
    expectedName: 'voyager 2',
    center: 'sun',
    startTime: '1977-08-21',
    stopTime: '2099-12-31',
  },
  {
    name: 'parker-solar-probe',
    target: '-96',
    expectedName: 'parker solar probe',
    center: 'sun',
    startTime: '2018-08-13',
    stopTime: '2029-12-31',
    stepDays: PROBE_EVENT_STEP_DAYS,
  },
  {
    name: 'jwst',
    target: '-170',
    // Horizons résout au nom complet "James Webb Space Telescope", pas au sigle.
    expectedName: 'james webb',
    center: 'sun',
    startTime: '2021-12-26',
    stopTime: '2031-08-23',
    stepDays: PROBE_EVENT_STEP_DAYS,
  },
  // Vague C du catalogue (`docs/UNIVERSE_CATALOG.md`). Chaque fenêtre ci-dessous a été LUE
  // dans la réponse de Horizons, pas devinée : demander une fenêtre trop large fait répondre
  // « No ephemeris for target X prior to / after <date> », qui nomme les bornes réelles de la
  // solution de trajectoire. On se place un jour à l'intérieur de chaque côté.
  //
  // HUBBLE est délibérément ABSENT, et ce n'est pas un oubli. Il orbite à 540 km en 95
  // minutes : à l'échelle du Système solaire son marqueur se superposerait exactement à celui
  // de la Terre, et un échantillonnage à 4 jours ne représente rien d'une orbite de 95 minutes
  // — on afficherait un point faux à un endroit déjà occupé. Son ID Horizons est -48 si un
  // jour la couche instrument sait zoomer sur l'orbite terrestre.
  {
    name: 'new-horizons',
    target: '-98',
    expectedName: 'new horizons',
    center: 'sun',
    startTime: '2006-01-21',
    stopTime: '2049-12-31',
  },
  {
    name: 'cassini',
    target: '-82',
    expectedName: 'cassini',
    center: 'sun',
    // Mission TERMINÉE : plongée finale dans Saturne le 15 septembre 2017, et la solution
    // s'arrête là. Au-delà, `getHeliocentricAU` rend `null` et la couche saute la sonde —
    // c'est le comportement voulu, une sonde détruite ne doit pas continuer de voler.
    startTime: '1997-10-17',
    stopTime: '2017-09-14',
    stepDays: PROBE_EVENT_STEP_DAYS,
  },
  {
    name: 'juno',
    target: '-61',
    expectedName: 'juno',
    center: 'sun',
    startTime: '2011-08-07',
    stopTime: '2028-09-29',
    stepDays: PROBE_EVENT_STEP_DAYS,
  },
  {
    name: 'rosetta',
    target: '-226',
    expectedName: 'rosetta',
    center: 'sun',
    // Autre mission terminée : posée sur 67P le 30 septembre 2016.
    startTime: '2004-03-04',
    stopTime: '2016-10-03',
  },
  {
    name: 'bepicolombo',
    target: '-121',
    expectedName: 'bepicolombo',
    center: 'sun',
    startTime: '2018-10-22',
    stopTime: '2027-04-09',
    stepDays: PROBE_EVENT_STEP_DAYS,
  },
  {
    name: 'osiris-rex',
    target: '-64',
    expectedName: 'osiris-rex',
    center: 'sun',
    startTime: '2016-09-10',
    stopTime: '2030-03-20',
  },
  {
    name: 'hayabusa2',
    target: '-37',
    // Horizons écrit « Hayabusa 2 », avec une espace ; la clé du catalogue n'en a pas.
    expectedName: 'hayabusa 2',
    center: 'sun',
    startTime: '2014-12-05',
    stopTime: '2026-11-25',
  },
];

function buildUrl(
  target,
  center,
  startTime = START_TIME,
  stopTime = STOP_TIME,
  stepDays = STEP_DAYS
) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${target}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: `500@${CENTER_IDS[center]}`,
    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,
    // Horizons n'accepte qu'un entier d'unités : un pas fractionnaire passe en heures.
    STEP_SIZE: Number.isInteger(stepDays)
      ? `'${stepDays} d'`
      : `'${Math.round(stepDays * 24)} h'`,
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF',
    OUT_UNITS: 'AU-D',
    VEC_TABLE: '2',
    VEC_CORR: 'NONE',
    CSV_FORMAT: 'YES',
    TIME_DIGITS: 'FRACSEC',
    CAL_TYPE: 'GREGORIAN',
  });
  return `${API_URL}?${params}`;
}

function parseVectors(result, name) {
  const start = result.indexOf('$$SOE');
  const end = result.indexOf('$$EOE');
  if (start < 0 || end <= start)
    throw new Error(`${name}: missing ephemeris block`);

  const rows = result
    .slice(start + 5, end)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(',').map((field) => field.trim());
      const jd = Number(fields[0]);
      const state = fields.slice(2, 8).map(Number);
      if (
        !Number.isFinite(jd) ||
        state.some((value) => !Number.isFinite(value))
      )
        throw new Error(`${name}: malformed row`);
      return { jd, state };
    });
  if (rows.length < 2) throw new Error(`${name}: not enough samples`);
  const stepDays = rows[1].jd - rows[0].jd;
  for (let i = 1; i < rows.length; i++) {
    if (Math.abs(rows[i].jd - rows[i - 1].jd - stepDays) > 1e-9)
      throw new Error(`${name}: non-uniform step at ${i}`);
  }
  return { rows, stepDays };
}

function encodeBinary(rows) {
  const buffer = Buffer.allocUnsafe(rows.length * 6 * 8);
  let offset = 0;
  for (const { state } of rows) {
    for (const value of state) {
      buffer.writeDoubleLE(value, offset);
      offset += 8;
    }
  }
  return buffer;
}

/**
 * Vérifie que Horizons a bien résolu la cible attendue plutôt qu'un homonyme numérique dans
 * une autre base (le bug qui a motivé cette fonction : '699;' matchait l'astéroïde 699 Hela
 * au lieu de Saturne — un résultat silencieusement plausible, jamais une erreur HTTP).
 */
function assertResolvedTarget(result, body) {
  const match = result.match(/Target body name:\s*([^\n{]+)/);
  const resolvedName = match?.[1]?.trim().toLowerCase() ?? '';
  if (!resolvedName.includes(body.expectedName)) {
    throw new Error(
      `${body.name}: Horizons resolved target "${body.target}" to "${resolvedName || 'UNKNOWN'}", expected a name containing "${body.expectedName}" — wrong COMMAND/CENTER, not a network error`
    );
  }
}

async function requestVectors(body, startTime, stopTime) {
  const response = await fetch(
    buildUrl(body.target, body.center, startTime, stopTime, body.stepDays),
    { headers: { 'User-Agent': 'Galaxy-Ephemeris-Generator/1.0' } }
  );
  if (!response.ok) throw new Error(`${body.name}: HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload.result !== 'string')
    throw new Error(`${body.name}: invalid Horizons response`);
  assertResolvedTarget(payload.result, body);
  return payload.result;
}

/**
 * Deux requêtes, coupées à l'ÉPOQUE de la solution orbitale lue dans l'en-tête, au lieu d'une.
 *
 * Pour un petit corps, la réponse d'une requête 1900-2101 dépend de son étendue : comparée au
 * même instant TDB à une requête par liste de dates (lot 11), elle coïncide au début de la plage
 * et s'en écarte ensuite de plus en plus, comme une intégration partie de la première date
 * demandée qui accumulerait l'erreur de chaque rencontre planétaire. Itokawa, qui croise souvent
 * la Terre, s'écarte de 894 km en 2050 et de 14 663 km en 2098 ; Ryugu de 104 km en 2098. Coupé à
 * l'époque (2004 pour Itokawa), l'écart tombe sous 3 km sur toute la plage. Les deux moitiés
 * partent de l'époque, arrondie à un nœud de la grille pour que le pas reste uniforme, et
 * l'échantillon commun n'est gardé qu'une fois.
 */
async function requestSplitAtSolutionEpoch(body, startTime, stopTime) {
  const whole = await requestVectors(body, startTime, stopTime);
  const epoch = Number(whole.match(/EPOCH=\s*([\d.]+)/)?.[1]);
  if (!Number.isFinite(epoch))
    throw new Error(`${body.name}: no solution EPOCH in the Horizons header`);
  const { rows, stepDays } = parseVectors(whole, body.name);
  const first = rows[0].jd;
  const last = rows[rows.length - 1].jd;
  const node = first + Math.round((epoch - first) / stepDays) * stepDays;
  if (node <= first || node >= last) return whole;
  const before = await requestVectors(body, startTime, `JD ${node}`);
  const after = await requestVectors(body, `JD ${node}`, stopTime);
  return { before, after, node };
}

async function fetchBody(body) {
  process.stdout.write(`Fetching ${body.name}... `);
  let rows;
  let stepDays;
  if (body.splitAtSolutionEpoch) {
    const split = await requestSplitAtSolutionEpoch(
      body,
      body.startTime,
      body.stopTime
    );
    if (typeof split === 'string') {
      ({ rows, stepDays } = parseVectors(split, body.name));
    } else {
      const before = parseVectors(split.before, body.name);
      const after = parseVectors(split.after, body.name);
      if (
        before.rows[before.rows.length - 1].jd !== split.node ||
        after.rows[0].jd !== split.node
      )
        throw new Error(`${body.name}: halves do not meet at JD ${split.node}`);
      rows = [...before.rows, ...after.rows.slice(1)];
      stepDays = before.stepDays;
      for (let i = 1; i < rows.length; i++) {
        if (Math.abs(rows[i].jd - rows[i - 1].jd - stepDays) > 1e-9)
          throw new Error(`${body.name}: non-uniform step at ${i}`);
      }
      process.stdout.write(`split at JD ${split.node}, `);
    }
  } else {
    const result = await requestVectors(body, body.startTime, body.stopTime);
    ({ rows, stepDays } = parseVectors(result, body.name));
  }
  const binary = encodeBinary(rows);
  const hash = createHash('sha256').update(binary).digest('hex').slice(0, 12);
  const file = `${body.name}.${hash}.bin`;
  await writeFile(resolve(OUTPUT_DIR, file), binary);
  process.stdout.write(`${rows.length} samples\n`);
  return {
    file,
    target: body.target,
    center: body.center,
    startJdTdb: rows[0].jd,
    stepDays,
    sampleCount: rows.length,
  };
}

await mkdir(OUTPUT_DIR, { recursive: true });

/**
 * `--only a,b` : ne régénère QUE ces corps et garde les autres entrées du manifeste telles
 * quelles. Un `generate` complet refetcherait tout, et chaque solution Horizons raffinée
 * depuis changerait des fichiers sans rapport avec la modification voulue.
 */
const onlyIndex = process.argv.indexOf('--only');
const only =
  onlyIndex === -1 ? null : new Set(process.argv[onlyIndex + 1].split(','));
if (only) {
  const manifest = JSON.parse(
    await readFile(resolve(OUTPUT_DIR, 'manifest.json'), 'utf8')
  );
  const replaced = [];
  for (const name of only) {
    const body = BODIES.find((entry) => entry.name === name);
    if (!body) throw new Error(`--only : corps inconnu « ${name} »`);
    const previous = manifest.bodies[name]?.file;
    manifest.bodies[name] = await fetchBody(body);
    if (previous && previous !== manifest.bodies[name].file)
      replaced.push(previous);
  }
  manifest.generatedAt = new Date().toISOString();
  await writeFile(
    resolve(OUTPUT_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  // Les anciens fichiers ne partent qu'APRÈS l'écriture du manifeste. Une requête qui échouait
  // au milieu de la liste laissait sinon, sur disque, un manifeste désignant des fichiers déjà
  // supprimés (arrivé au lot 11, sur une réponse Horizons sans ligne EPOCH).
  for (const file of replaced) await unlink(resolve(OUTPUT_DIR, file));
  process.stdout.write(`Updated ${[...only].join(', ')}\n`);
  process.exitCode = 0;
  // Pas de process.exit() pendant qu'un fetch peut garder une connexion ouverte (plantage
  // libuv sous Windows, cf. check-deployed-bundle.mjs) : on sort par le chemin normal.
}

async function generateAll() {
  const manifest = {
    version: 1,
    source: 'NASA/JPL Horizons',
    generatedAt: new Date().toISOString(),
    frame: 'ECLIPTIC_J2000',
    center: 'SUN',
    units: 'AU-D',
    coverage: { start: START_TIME, stop: STOP_TIME },
    bodies: {},
  };

  for (const body of BODIES) manifest.bodies[body.name] = await fetchBody(body);

  const activeFiles = new Set(
    Object.values(manifest.bodies).map((body) => body.file)
  );
  for (const file of await readdir(OUTPUT_DIR)) {
    if (file.endsWith('.bin') && !activeFiles.has(file))
      await unlink(resolve(OUTPUT_DIR, file));
  }

  await writeFile(
    resolve(OUTPUT_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write(`Wrote ${OUTPUT_DIR}\n`);
}

if (!only) await generateAll();
