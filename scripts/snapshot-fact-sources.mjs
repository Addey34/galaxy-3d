#!/usr/bin/env node
/* global console, process, fetch, Buffer, URL */
/**
 * Instantané des SOURCES PRIMAIRES des faits affichés (fiche d'un corps, pages par corps).
 *
 * Pourquoi un instantané. Chaque valeur affichée cite une source (`realData.sources`, registre
 * `src/config/factSources.ts`). Une citation qu'aucun test ne confronte à la source est une
 * affirmation de plus, pas une preuve : le catalogue a longtemps porté des valeurs « sourcées »
 * qui ne figuraient dans aucune (gravité de Jupiter 24,79 m/s² quand la fiche NASA donne 25,92
 * en moyenne et 23,12 à l'équateur ; masse d'Itokawa 3,15e10 kg pour 3,51e10 publiés). Ce
 * script lit les tables elles-mêmes et écrit `src/config/factSources.snapshot.json`, que
 * `factProvenance.test.ts` compare à chaque valeur citée. Le JSON n'est importé QUE par ce test :
 * rien de ceci n'atteint le bundle client.
 *
 *   node scripts/snapshot-fact-sources.mjs            (réseau, réponses mises en cache)
 *   node scripts/snapshot-fact-sources.mjs --offline  (cache .cache/fact-sources/ seul)
 *
 * Sources lues : fiches NASA NSSDCA (Sun, planètes, Lune, Pluton et Charon), tables JPL SSD
 * des satellites (paramètres physiques, éléments moyens), pages NASA Science des lunes
 * (nombre de lunes « as of »), API JPL SBDB (petits corps : diamètre, GM, rotation, pôle,
 * satellites confirmés). Un libellé introuvable fait ÉCHOUER le script : une table qui change
 * de forme ne doit pas produire un instantané silencieusement vide.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OFFLINE = process.argv.includes('--offline');
const CACHE_DIR = '.cache/fact-sources';
const OUT = 'src/config/factSources.snapshot.json';
mkdirSync(CACHE_DIR, { recursive: true });

async function get(url) {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const path = `${CACHE_DIR}/${key}.txt`;
  if (existsSync(path)) return readFileSync(path, 'utf8');
  if (OFFLINE) throw new Error(`absent du cache (--offline) : ${url}`);
  // Certains éditeurs (Nature) servent une page d'interstitiel sans en-tête de navigateur.
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (galaxy fact-source snapshot)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} : ${url}`);
  const text = await response.text();
  writeFileSync(path, text);
  return text;
}

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&omega;/g, 'ω')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

/**
 * HTML → lignes de texte, espaces normalisés. Les balises sont retirées SANS saut de ligne :
 * `Mass (10<sup>24</sup> kg)` doit rester un seul libellé, sinon l'exposant 24 se lit comme la
 * valeur. Les tables placent déjà chaque cellule sur sa propre ligne de source.
 */
const htmlLines = (html) =>
  decode(html.replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const number = (raw) => {
  const value = Number(String(raw).replace(/,/g, '').replace(/\*$/, ''));
  if (!Number.isFinite(value)) throw new Error(`nombre illisible : ${raw}`);
  return value;
};

// ── NASA NSSDCA : fiches par corps ───────────────────────────────────────────────────────────

const NSSDCA_BASE = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/';

/**
 * Valeur de la ligne `label` d'une fiche : le premier nombre qui SUIT le libellé. Les fiches
 * alternent deux mises en page (tableau HTML d'une cellule par valeur, bloc `<pre>` d'une ligne
 * par grandeur) ; les deux se ramènent à « libellé puis nombres » une fois découpées en jetons.
 */
function sheetValue(lines, label, { occurrence = 0 } = {}) {
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith(label)) continue;
    if (seen++ < occurrence) continue;
    const rest = `${line.slice(label.length)} ${lines[i + 1] ?? ''}`
      .trimStart()
      // Renvoi de note accolé au libellé : « Sidereal rotation period (hrs)* 609.12 ».
      .replace(/^\*\s*/, '');
    const match = rest.match(/^(-?[\d,]+\.?\d*(?:[eE][-+]?\d+)?)\*?(?:\s|$)/);
    if (!match) throw new Error(`valeur illisible après « ${label} »`);
    return number(match[1]);
  }
  throw new Error(`libellé introuvable : « ${label} »`);
}

const lastUpdated = (lines) => {
  const line = lines.find((l) => l.startsWith('Last Updated:'));
  if (!line) throw new Error('date « Last Updated » introuvable');
  return new Date(
    `${line.replace('Last Updated:', '').split(',')[0].trim()} UTC`
  )
    .toISOString()
    .slice(0, 10);
};

/** Colonnes d'une ligne du tableau principal, dans l'ordre des en-têtes du tableau. */
const MAIN_COLUMNS = [
  'mercury',
  'venus',
  'earth',
  'moon',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
];
function mainRow(lines, label) {
  const at = lines.findIndex(
    (l) => l.replace(/ /g, '') === label.replace(/ /g, '')
  );
  if (at < 0)
    throw new Error(`ligne introuvable dans la table principale : ${label}`);
  const out = {};
  MAIN_COLUMNS.forEach((body, k) => (out[body] = number(lines[at + 1 + k])));
  return out;
}

async function nssdca() {
  const sheet = async (file) =>
    htmlLines(await get(`${NSSDCA_BASE}${file}`)).flatMap((line) =>
      // Les blocs <pre> portent « libellé   valeur » sur une ligne : garder la ligne entière
      // (le libellé en tête) suffit à `sheetValue`.
      [line]
    );
  const main = htmlLines(await get(`${NSSDCA_BASE}index.html`));
  const meanTemperature = mainRow(main, 'Mean Temperature (C)');
  const out = {
    url: `${NSSDCA_BASE}`,
    mainTableUpdated: lastUpdated(main),
    bodies: {},
  };
  const planet = async (name, file, labels) => {
    const lines = await sheet(file);
    const entry = { updated: lastUpdated(lines), url: `${NSSDCA_BASE}${file}` };
    for (const [key, label, options] of labels)
      entry[key] = sheetValue(lines, label, options);
    if (meanTemperature[name] !== undefined)
      entry.meanTemperatureC = meanTemperature[name];
    out.bodies[name] = entry;
  };

  const common = (radiusLabel, gravityLabel) => [
    ['mass1e24Kg', 'Mass (1024 kg)'],
    ['equatorialRadiusKm', radiusLabel],
    ['volumetricMeanRadiusKm', 'Volumetric mean radius (km)'],
    ['meanGravity', gravityLabel],
    ['siderealRotationHours', 'Sidereal rotation period (hrs)'],
    ['siderealOrbitDays', 'Sidereal orbit period (days)'],
    ['obliquityDeg', 'Obliquity to orbit (deg)'],
  ];
  const terrestrial = [
    ...common('Equatorial radius (km)', 'Surface gravity (mean) (m/s2)'),
    ['semiMajorAxisAU', 'Semimajor axis (AU)'],
    ['moonCount', 'Number of natural satellites'],
  ];
  const giant = [
    ...common(
      'Equatorial radius (1 bar level) (km)',
      'Gravity (mean, 1 bar) (m/s2)'
    ),
    ['semiMajorAxisAU', 'Semimajor axis (AU)'],
    ['moonCount', 'Number of natural satellites'],
  ];
  await planet('mercury', 'mercuryfact.html', terrestrial);
  await planet('venus', 'venusfact.html', terrestrial);
  await planet('earth', 'earthfact.html', terrestrial);
  await planet('mars', 'marsfact.html', terrestrial);
  await planet('jupiter', 'jupiterfact.html', giant);
  await planet('saturn', 'saturnfact.html', giant);
  await planet('uranus', 'uranusfact.html', giant);
  await planet('neptune', 'neptunefact.html', giant);
  await planet('pluto', 'plutofact.html', [
    ...common('Equatorial radius (km)', 'Surface Gravity (mean) (m/s2)'),
    ['semiMajorAxisAU', 'Semimajor axis (AU)'],
    ['moonCount', 'Number of natural satellites'],
  ]);
  // Charon est décrit dans la fiche de Pluton, APRÈS les grandeurs de Pluton : deuxième
  // occurrence de chaque libellé.
  await planet('charon', 'plutofact.html', [
    ['mass1e21Kg', 'Mass (1021 kg)'],
    ['equatorialRadiusKm', 'Equatorial radius (km)', { occurrence: 1 }],
    ['surfaceGravity', 'Surface gravity (m/s2)'],
    ['siderealOrbitDays', 'Sidereal orbit period (days)', { occurrence: 1 }],
    ['siderealRotationDays', 'Sidereal rotation period (days)'],
  ]);
  delete out.bodies.charon.meanTemperatureC;
  await planet('moon', 'moonfact.html', [
    ['mass1e24Kg', 'Mass (1024 kg)'],
    ['volumetricMeanRadiusKm', 'Volumetric mean radius (km)'],
    ['surfaceGravity', 'Surface gravity (m/s2)'],
    ['semiMajorAxis1e6Km', 'Semimajor axis (106 km)'],
    ['siderealOrbitDays', 'Revolution period (days)'],
    ['siderealRotationHours', 'Sidereal rotation period (hrs)'],
    ['obliquityDeg', 'Obliquity to orbit (deg)'],
  ]);
  await planet('sun', 'sunfact.html', [
    ['mass1e24Kg', 'Mass (1024 kg)'],
    ['volumetricMeanRadiusKm', 'Volumetric mean radius (km)'],
    ['surfaceGravityEq', 'Surface gravity (eq.) (m/s2)'],
    ['siderealRotationHours', 'Sidereal rotation period (hrs)'],
    ['obliquityDeg', 'Obliquity to ecliptic (deg.)'],
    ['effectiveTemperatureK', 'Effective temperature:'],
  ]);
  return out;
}

// ── NASA NSSDCA : fiches des satellites ──────────────────────────────────────────────────────

/**
 * Section « Orbital parameters » des fiches de satellites : demi-grand axe (10³ km), rayons
 * planétaires, période orbitale SIDÉRALE (jours, suffixe R si rétrograde), puis la rotation :
 * `S` synchrone, `C` chaotique, ou rien. Préférée à la table JPL des éléments moyens pour la
 * période, dont la colonne P est anomalistique (Io : 1,7627 j contre 1,7691 j sidéraux).
 */
async function nssdcaSatellites() {
  const sheets = {
    'joviansatfact.html': {
      amalthea: 'Amalthea (V)',
      io: 'Io (I)',
      europa: 'Europa (II)',
      ganymede: 'Ganymede (III)',
      callisto: 'Callisto (IV)',
    },
    'saturniansatfact.html': {
      mimas: 'Mimas (SI)',
      enceladus: 'Enceladus (SII)',
      tethys: 'Tethys (SIII)',
      dione: 'Dione (SIV)',
      rhea: 'Rhea (SV)',
      titan: 'Titan (SVI)',
      hyperion: 'Hyperion (VII)',
      iapetus: 'Iapetus (VIII)',
    },
    'uraniansatfact.html': {
      miranda: 'Miranda (UV)',
      ariel: 'Ariel (UI)',
      umbriel: 'Umbriel (UII)',
      titania: 'Titania (UIII)',
      oberon: 'Oberon (UIV)',
    },
    'neptuniansatfact.html': {
      triton: 'Triton (NI)',
      proteus: 'Proteus (NVIII)',
      nereid: 'Nereid (NII)',
    },
  };
  const out = {};
  for (const [file, moons] of Object.entries(sheets)) {
    const lines = htmlLines(await get(`${NSSDCA_BASE}${file}`));
    const orbital = lines.findIndex((l) => l.startsWith('Orbital parameters'));
    if (orbital < 0) throw new Error(`section orbitale introuvable : ${file}`);
    const updated = lastUpdated(lines);
    for (const [body, label] of Object.entries(moons)) {
      const at = lines.indexOf(label, orbital);
      if (at < 0) throw new Error(`${label} introuvable dans ${file}`);
      const rotation = lines[at + 4];
      out[body] = {
        url: `${NSSDCA_BASE}${file}`,
        updated,
        semiMajorAxisKm: number(lines[at + 1]) * 1000,
        siderealOrbitDays: number(lines[at + 3].replace(/R$/, '')),
        rotation: rotation === 'S' || rotation === 'C' ? rotation : null,
      };
    }
  }
  // Phobos et Déimos sont décrits dans la fiche de Mars, deux colonnes par grandeur.
  const mars = htmlLines(await get(`${NSSDCA_BASE}marsfact.html`));
  const pair = (label) => {
    // DERNIÈRE occurrence : les mêmes libellés décrivent d'abord Mars elle-même.
    const at = mars.findLastIndex((l) => l === label);
    if (at < 0) throw new Error(`fiche de Mars : ${label} introuvable`);
    return [number(mars[at + 1]), number(mars[at + 2])];
  };
  const semiMajor = pair('Semimajor axis* (km)');
  const period = pair('Sidereal orbit period (days)');
  const rotation = pair('Sidereal rotation period (days)');
  ['phobos', 'deimos'].forEach((body, k) => {
    out[body] = {
      url: `${NSSDCA_BASE}marsfact.html`,
      updated: lastUpdated(mars),
      semiMajorAxisKm: semiMajor[k],
      siderealOrbitDays: period[k],
      rotation: rotation[k] === period[k] ? 'S' : null,
    };
  });
  return out;
}

// ── JPL SSD : satellites ─────────────────────────────────────────────────────────────────────

/** Lignes d'un tableau HTML, cellules nettoyées ; tolère les `<tr>` jamais refermés. */
function tableRows(html) {
  return html
    .split(/<tr[^>]*>/)
    .slice(1)
    .map((chunk) =>
      [...chunk.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
        decode(m[1].replace(/<[^>]*>/g, ' '))
          .replace(/\s+/g, ' ')
          .trim()
      )
    );
}

const JPL_NAME = {
  moon: 'Moon',
  phobos: 'Phobos',
  deimos: 'Deimos',
  amalthea: 'Amalthea',
  io: 'Io',
  europa: 'Europa',
  ganymede: 'Ganymede',
  callisto: 'Callisto',
  mimas: 'Mimas',
  enceladus: 'Enceladus',
  tethys: 'Tethys',
  dione: 'Dione',
  rhea: 'Rhea',
  titan: 'Titan',
  hyperion: 'Hyperion',
  iapetus: 'Iapetus',
  miranda: 'Miranda',
  ariel: 'Ariel',
  umbriel: 'Umbriel',
  titania: 'Titania',
  oberon: 'Oberon',
  triton: 'Triton',
  nereid: 'Nereid',
  proteus: 'Proteus',
  charon: 'Charon',
  nix: 'Nix',
  hydra: 'Hydra',
  kerberos: 'Kerberos',
  styx: 'Styx',
};

/** « 5959.91547 0.00135 JUP365 » → valeur, incertitude, étiquette (n/a → null). */
function valueCell(cell) {
  const [value, sigma] = cell.split(' ');
  // Sans GM publié, la cellule porte « n/a PLU060 » : l'étiquette d'éphéméride n'est pas une
  // incertitude.
  const parse = (s) =>
    s === undefined || !/^-?[\d.]+(e-?\d+)?$/i.test(s) ? null : number(s);
  return { value: parse(value), sigma: parse(sigma) };
}

async function jplSatellites() {
  const physUrl = 'https://ssd.jpl.nasa.gov/sats/phys_par/';
  const elemUrl = 'https://ssd.jpl.nasa.gov/sats/elem/';
  const phys = {};
  for (const cells of tableRows(await get(physUrl))) {
    const body = Object.keys(JPL_NAME).find((k) => JPL_NAME[k] === cells[1]);
    if (!body || cells.length < 6) continue;
    const gm = valueCell(cells[3]);
    const radius = valueCell(cells[4]);
    phys[body] = {
      gmKm3s2: gm.value,
      gmSigma: gm.sigma,
      meanRadiusKm: radius.value,
      meanRadiusSigma: radius.sigma,
      ephemeris: cells[3].split(' ').pop(),
    };
  }
  const elem = {};
  for (const cells of tableRows(await get(elemUrl))) {
    // Colonnes : ID, planète, satellite, code, éphéméride, repère, époque, a, e, ω, M, i, nœud, P.
    const body = Object.keys(JPL_NAME).find((k) => JPL_NAME[k] === cells[2]);
    // Première ligne rencontrée seulement : la page répète certains satellites plus bas.
    if (!body || elem[body] || cells.length < 14) continue;
    elem[body] = {
      frame: cells[5],
      epoch: cells[6],
      semiMajorAxisKm: number(cells[7]),
      periodDays: number(cells[13]),
    };
  }
  for (const body of Object.keys(JPL_NAME)) {
    if (!phys[body]) throw new Error(`JPL phys_par : ${body} introuvable`);
    if (!elem[body]) throw new Error(`JPL elem : ${body} introuvable`);
  }
  return {
    physicalParameters: { url: physUrl, bodies: phys },
    meanElements: { url: elemUrl, bodies: elem },
  };
}

// ── NASA Science : nombre de lunes daté ──────────────────────────────────────────────────────

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
async function nasaMoonCounts() {
  const out = {};
  for (const planet of ['jupiter', 'saturn', 'uranus', 'neptune', 'mars']) {
    const url = `https://science.nasa.gov/${planet}/moons/`;
    const text = htmlLines(await get(url)).join(' ');
    const words = { two: 2 };
    // La page répète le chiffre dans ses métadonnées, qui peuvent être en retard sur le corps
    // du texte (Saturne : « 274 » dans la description, « 293 … as of August 2026 » dans la
    // page). La phrase DATÉE fait foi ; sans date, toutes les occurrences doivent concorder.
    const matches = [
      ...text.matchAll(
        /has (\d+|two) (?:known |confirmed )?moons(?:[^.]*?as of (\w+) (\d{4}))?/gi
      ),
    ];
    const match = matches.find((m) => m[2]) ?? matches[0];
    if (!match) throw new Error(`nombre de lunes introuvable : ${url}`);
    if (!match[2] && new Set(matches.map((m) => m[1])).size > 1)
      throw new Error(`nombres de lunes contradictoires sans date : ${url}`);
    const count = words[match[1]] ?? number(match[1]);
    const month = match[2] ? MONTHS.indexOf(match[2]) + 1 : 0;
    out[planet] = {
      url,
      moonCount: count,
      asOf: month ? `${match[3]}-${String(month).padStart(2, '0')}` : null,
      sentence: match[0],
    };
  }
  return out;
}

// ── JPL SBDB : petits corps ──────────────────────────────────────────────────────────────────

// DONNÉE, pas du code : la liste vit dans `fact-source-targets.json`, à côté de ce
// script. Ajouter un corps au catalogue n'exige plus de toucher ce fichier.
const SBDB_TARGET = JSON.parse(
  readFileSync(new URL('./fact-source-targets.json', import.meta.url), 'utf8')
).sbdb;

async function sbdb() {
  const out = {};
  for (const [body, sstr] of Object.entries(SBDB_TARGET)) {
    const url = `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(sstr)}&phys-par=1&sat=1`;
    const json = JSON.parse(await get(url));
    if (!json.object) throw new Error(`SBDB : ${sstr} introuvable`);
    const par = (name) => {
      const p = (json.phys_par ?? []).find((x) => x.name === name);
      if (!p) return null;
      return {
        value: p.value,
        sigma: p.sigma ?? null,
        ref: p.ref ?? null,
        notes: p.notes ?? null,
      };
    };
    // Sigma asymétrique SBDB (« -1/+4 ») : conservée telle quelle, la déparer mentirait.
    const numeric = (p) =>
      p && {
        ...p,
        value: number(p.value),
        sigma:
          p.sigma &&
          (Number.isFinite(Number(String(p.sigma).replace(/,/g, '')))
            ? Number(String(p.sigma).replace(/,/g, ''))
            : String(p.sigma)),
      };
    const pole = par('pole');
    out[body] = {
      url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(sstr)}`,
      fullname: json.object.fullname,
      diameterKm: numeric(par('diameter')),
      gmKm3s2: numeric(par('GM')),
      rotationHours: numeric(par('rot_per')),
      pole: pole && {
        ...pole,
        value: pole.value.split('/').map(Number),
      },
      confirmedSatellites: (json.sat ?? []).filter((s) => s.confirmed === 'Y')
        .length,
    };
  }
  return out;
}

// ── Articles : les phrases citées doivent figurer dans la source ─────────────────────────────

/**
 * Chaque valeur tirée d'un article est citée MOT POUR MOT ici, puis cherchée dans le texte
 * publié (résumé arXiv, page Nature, ou tableau du PDF quand le résumé ne donne pas le
 * chiffre). `factProvenance.test.ts` relie ensuite la valeur du catalogue à cette citation :
 * la transcription du chiffre reste humaine, mais le texte qu'elle transcrit est vérifié.
 */
const ARTICLES = {
  'sicardy-2011-eris': {
    url: 'https://www.nature.com/articles/nature10550',
    quotes: [
      'radius 1,163 ± 6 kilometres',
      'density 2.52 ± 0.05 grams per cm3',
    ],
  },
  'szakats-2023-eris': {
    arxiv: '2211.07987',
    quotes: ['P = 15.8 d', 'the rotation of Eris is tidally locked'],
  },
  'ragozzine-brown-2009-haumea': {
    arxivPdf: '0903.4213v1',
    quotes: ['Haumea Mass 4.006 ± 0.040 1021 kg'],
  },
  'brown-2013-makemake': {
    arxiv: '1304.1041',
    quotes: ['measured equatorial diameter of 1434 +/- 14 km'],
  },
  'kiss-2019-gonggong': {
    arxiv: '1903.05439',
    quotes: ['system mass of 1.75x10$^{21}$ kg', 'a size of 1230$\\pm$50 km'],
  },
  'margoti-2026-quaoar': {
    arxiv: '2607.06450',
    quotes: [
      'equivalent volumetric diameter of 1094.4 +/- 4.6 km',
      'density of 1.760 +/- 0.109 g/cm3',
      '8.8394 +/- 0.0002 hours',
    ],
  },
  'pal-2012-sedna': {
    arxiv: '1204.0899',
    quotes: ['995 +/- 80 km'],
  },
  'kiss-2016-nereid': {
    arxiv: '1601.02395',
    quotes: ['rotation period of P=11.594(+/-)0.017 h'],
  },
};

/**
 * Normalisation de recherche : espaces fusionnés, et toute suite de caractères non ASCII
 * ramenée à `?`. Le « ± » arrive en UTF-8 d'une page web, en Latin-1 ou en caractère de
 * remplacement de pdftotext selon la plateforme : c'est le chiffre qui est vérifié, pas son
 * encodage.
 */
const collapse = (s) => s.replace(/\s+/g, ' ').replace(/[^\x20-\x7E]+/g, '?');

async function articleText({ url, arxiv, arxivPdf }) {
  if (arxiv) {
    const xml = await get(
      `https://export.arxiv.org/api/query?id_list=${arxiv}&max_results=1`
    );
    const summary = xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1];
    if (!summary) throw new Error(`résumé arXiv introuvable : ${arxiv}`);
    return decode(summary.replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  if (arxivPdf) {
    // Le tableau n'existe que dans le PDF : extraction par pdftotext (poppler), dont le texte
    // est mis en cache comme les autres réponses. Hors ligne, seul le cache sert.
    const { execFileSync } = await import('node:child_process');
    const cacheKey = `https://arxiv.org/pdf/${arxivPdf}#pdftotext`;
    const key = createHash('sha1').update(cacheKey).digest('hex').slice(0, 16);
    const path = `${CACHE_DIR}/${key}.txt`;
    if (!existsSync(path)) {
      if (OFFLINE) throw new Error(`absent du cache (--offline) : ${cacheKey}`);
      const pdf = Buffer.from(
        await (await fetch(`https://arxiv.org/pdf/${arxivPdf}`)).arrayBuffer()
      );
      const pdfPath = `${CACHE_DIR}/${key}.pdf`;
      writeFileSync(pdfPath, pdf);
      writeFileSync(
        path,
        execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
          encoding: 'latin1',
        })
      );
    }
    return readFileSync(path, 'latin1');
  }
  // Page d'éditeur : le résumé est dans le HTML servi. Nature répond au `fetch` de Node par
  // une page de défi JavaScript (« Client Challenge ») mais sert l'article à curl : le texte
  // est donc lu par curl, et le script ÉCHOUE plutôt que d'accepter la page de défi.
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const path = `${CACHE_DIR}/${key}.txt`;
  if (!existsSync(path)) {
    if (OFFLINE) throw new Error(`absent du cache (--offline) : ${url}`);
    const { execFileSync } = await import('node:child_process');
    writeFileSync(
      path,
      execFileSync('curl', ['-sSL', '-A', 'Mozilla/5.0', url], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      })
    );
  }
  const html = readFileSync(path, 'utf8');
  if (html.includes('<title>Client Challenge</title>'))
    throw new Error(`page de défi au lieu de l'article : ${url}`);
  return decode(html.replace(/<[^>]*>/g, ' '));
}

async function articles() {
  const out = {};
  for (const [id, article] of Object.entries(ARTICLES)) {
    const text = collapse(await articleText(article));
    for (const quote of article.quotes)
      if (!text.includes(collapse(quote)))
        throw new Error(
          `${id} : citation introuvable dans la source : « ${quote} »`
        );
    out[id] = {
      url:
        article.url ??
        `https://arxiv.org/abs/${(article.arxiv ?? article.arxivPdf).replace(/v\d+$/, '')}`,
      verifiedQuotes: article.quotes,
    };
  }
  return out;
}

const snapshot = {
  generatedBy: 'scripts/snapshot-fact-sources.mjs',
  retrieved: new Date().toISOString().slice(0, 10),
  nssdca: await nssdca(),
  nssdcaSatellites: await nssdcaSatellites(),
  jplSatellites: await jplSatellites(),
  nasaMoonCounts: await nasaMoonCounts(),
  sbdb: await sbdb(),
  articles: await articles(),
};
// La date de relevé n'a de sens qu'en ligne : hors ligne, garder celle du cache existant pour
// qu'une régénération à l'identique ne produise aucun diff.
if (OFFLINE && existsSync(OUT))
  snapshot.retrieved = JSON.parse(readFileSync(OUT, 'utf8')).retrieved;
writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`écrit ${OUT}`);
