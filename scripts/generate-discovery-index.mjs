#!/usr/bin/env node
/* global console, process, fetch, setTimeout */
/**
 * CE QU'ON SAVAIT D'UN CORPS À UNE DATE : SA DÉCOUVERTE, ET LES LUNES CONNUES (lot 44, ligne 22.10).
 *
 * Le réservoir de vision décrivait la « timeline du savoir » comme un travail de RECHERCHE par
 * corps, chaque phrase du type « en 1610 on savait que… » demandant sa bibliographie. La mesure
 * du 2026-10-01 a montré qu'une partie de la réponse est DÉCLARÉE par des sources primaires, et
 * se dérive donc au lieu de s'écrire :
 *
 *   - la table « Planetary Satellite Discovery Circumstances » du JPL donne, pour CHAQUE satellite
 *     reconnu de Mars, Jupiter, Saturne, Uranus, Neptune et Pluton, l'année de découverte, les
 *     découvreurs et la référence UAI. Elle couvre les 30 lunes du catalogue (hors la Lune), et
 *     ses comptes par planète sont exactement ceux de NASA Science que la fiche affiche déjà
 *     (115, 293, 29…) : c'est ce qui permet de dire combien de lunes on connaissait à une date ;
 *   - le Small-Body Database (`discovery=1`) donne, pour les 19 petits corps, le jour, les
 *     découvreurs et le lieu ;
 *   - les fiches planétaires du NSSDCA portent « Discoverer » et « Discovery Date » : Uranus,
 *     Neptune, Pluton, et « Prehistoric » pour les cinq planètes visibles à l'œil nu.
 *
 * QUATRE CHOSES QUE LA MESURE A DITES, ET QU'AUCUNE RELECTURE N'AURAIT DONNÉES :
 *
 *   1. LA DATE DE MISE À JOUR DE LA PAGE DU JPL MENT. Elle se dit « last updated 2023-May-23 » et
 *      recense une lune d'Uranus découverte en 2025. La date publiée est donc celle de LECTURE,
 *      qui appartient à la réponse (lot 25), et le script imprime l'écart.
 *   2. UNE LIGNE PEUT PORTER DEUX ANNÉES : Thémisto « 1975, 2000 » (vue, perdue, retrouvée), Janus
 *      « 1966, 1980 », Épiméthée « 1977, 1980 ». Choisir l'une serait inventer : les deux sont
 *      publiées, et le compte des lunes connues à une date devient une BORNE.
 *   3. DEUX SOURCES PEUVENT DIVERGER SUR UN MÊME CORPS : Pluton est découverte le 1930-01-23 selon
 *      SBDB et le 1930-02-18 selon le NSSDCA. Aucune n'est écartée, et aucune explication n'est
 *      écrite de mémoire : la fiche montre les deux.
 *   4. LE MOT « DÉCOUVERTE » D'UNE SOURCE NE VEUT PAS TOUJOURS DIRE DÉCOUVERTE. SBDB fait
 *      découvrir Halley le 1758-12-25 par Palitzsch ; NASA Science écrit que Halley avait prédit
 *      son RETOUR en 1758, et que la comète a été rattachée à des observations de plus de 2 000
 *      ans. Le script exige que l'année citée par NASA Science soit celle de SBDB, puis requalifie
 *      cette date en retour prédit : publier « découverte en 1758 » aurait été faux pour tout
 *      lecteur, et le corriger de mémoire aurait été interdit.
 *
 * PAS 2 (2026-10-02) : LES SATELLITES DES PETITS CORPS QUE LA TABLE DU JPL N'A PAS EN SECTION.
 * SBDB (`sat=1`) les déclare, lu par la MÊME requête que le relevé des faits, donc dans la
 * réponse même qui donne le compte affiché sur la fiche. La liste des corps se DÉRIVE ; Pluton,
 * présent dans les deux sources, sert de TÉMOIN (mêmes noms, mêmes années, sinon échec). Tout
 * corps dont la fiche affiche une lune a sa liste, d'un compte ÉGAL, ou une raison écrite
 * (`satellitesNotCovered`, la Terre). Deux choses mesurées : `confirmed` n'est pas documenté par
 * l'API (seuls « Y » et « N » passent), et `iau_name` vaut la chaîne VIDE pour la lune de
 * Makémaké, nommée alors par sa désignation provisoire.
 *
 * CE QUE CE COMPTE NE DIT PAS, et la fiche le dit aussi : la table ne recense que les lunes
 * reconnues AUJOURD'HUI. Une lune annoncée puis réfutée n'y figure pas, donc ce n'est pas ce que
 * l'on CROYAIT à une date, mais ce que l'on avait déjà vu de ce qui est reconnu aujourd'hui.
 *
 * `--offline` (cache dans `.cache/fact-sources/`, partagé avec le relevé des faits, donc UNE seule
 * règle de date de lecture), `--check` (n'écrit rien, sort en code 1 si un fichier livré a dérivé).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CACHE_DIR,
  cacheKey,
  stampNow,
  stampOf,
} from './fact-source-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, CACHE_DIR);
const OUT = join(ROOT, 'public', 'assets', 'discovery');
/**
 * L'index vit dans `src/` (importé dynamiquement par `config/discovery.ts`), les listes de lunes
 * dans `public/` : un module de l'application ne peut pas importer depuis `public/`, et les 460
 * lignes de la table ne servent qu'à la fiche d'une planète qui en a.
 */
const INDEX = join(ROOT, 'src', 'config', 'discoveryIndex.json');

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const check = args.includes('--check');

const TARGETS = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'discovery-targets.json'), 'utf8')
);
/** Les désignations SBDB ont UN propriétaire, le relevé des faits : on les lit, on ne les recopie pas. */
const SBDB = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'fact-source-targets.json'), 'utf8')
).sbdb;

/** Même marque que le relevé des faits : le NSSDCA sert ses erreurs en HTTP 200. */
const SERVED_ERROR = /Errors and Messages|An error has occurred/;

/** Une réponse et sa date de lecture, avec le cache et la règle de date du relevé des faits. */
async function get(url) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${cacheKey(url)}.txt`);
  if (existsSync(path))
    return { text: readFileSync(path, 'utf8'), retrieved: stampOf(path) };
  if (offline) throw new Error(`absent du cache et --offline demandé : ${url}`);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (galaxy discovery index)' },
    });
    const text = res.ok ? await res.text() : '';
    const served = res.ok && SERVED_ERROR.test(text);
    if (res.ok && !served) {
      writeFileSync(path, text);
      return { text, retrieved: stampNow(path) };
    }
    if (!served && res.status < 500)
      throw new Error(`HTTP ${res.status} : ${url}`);
    if (attempt >= 5)
      throw new Error(
        `${served ? "page d'erreur servie en HTTP 200" : `HTTP ${res.status}`} après ${attempt + 1} tentatives : ${url}`
      );
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
}

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&quot;/g, '"');
const text = (html) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Les corps du catalogue, LUS du registre : nom anglais, parent déclaré. */
function catalogue() {
  const dir = join(ROOT, 'src', 'registry', 'entities');
  const bodies = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'order.json') continue;
    const fiche = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (fiche.targetClass === 'sky') continue;
    // Une planète ou une lune porte ses champs sous `config`, un petit corps sous `elements`.
    const fields = fiche.config ?? fiche.elements ?? {};
    bodies.set(fiche.id, {
      name: fields.displayName?.en ?? fiche.id,
      targetClass: fiche.targetClass,
      satellites: fields.satellites ?? [],
      // Le nombre de lunes que la FICHE affiche : c'est à lui que le compte d'une liste de
      // satellites doit être égal, sans quoi la fiche se contredirait.
      moonCount:
        typeof fiche.facts?.moonCount?.value === 'number'
          ? fiche.facts.moonCount.value
          : null,
    });
  }
  for (const [id, body] of bodies)
    for (const moon of body.satellites)
      if (bodies.has(moon)) bodies.get(moon).parent = id;
  return bodies;
}

// ── JPL : la table de découverte des satellites ────────────────────────────────────────────

const YEAR = /^\d{4}$/;

async function jplSatellites() {
  const { url, systems } = TARGETS.jplSatellites;
  const { text: html, retrieved } = await get(url);
  const start = html.indexOf('<table class="sat-discovery');
  if (start < 0)
    throw new Error(`table « sat-discovery » introuvable : ${url}`);
  const table = html.slice(start, html.indexOf('</table>', start));
  const declaredUpdate =
    /last updated (\d{4})-(\w{3})-(\d{2})/i.exec(text(html)) ?? null;

  const sections = new Map();
  let current = null;
  for (const [, row] of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(
      (m) => text(m[1])
    );
    if (cells.length === 1) {
      const m = /^(.+?):\s*(\d+)$/.exec(cells[0]);
      if (!m)
        throw new Error(`intitulé de section illisible : « ${cells[0]} »`);
      current = { declared: Number(m[2]), rows: [] };
      sections.set(m[1].replace(/\s+/g, ' '), current);
      continue;
    }
    if (!current || cells.length < 6 || cells[0] === 'IAUnumber') continue;
    const [, iauName, provisional, yearsCell, who, ref] = cells;
    const years = yearsCell.split(/\s*,\s*/);
    if (!years.every((y) => YEAR.test(y)))
      throw new Error(
        `année illisible pour ${iauName || provisional} : « ${yearsCell} »`
      );
    current.rows.push({
      name: iauName || provisional,
      ...(iauName && provisional ? { provisional } : {}),
      years: years.map(Number),
      who: who || null,
      ref: ref || null,
    });
  }
  for (const [title, section] of sections)
    if (section.rows.length !== section.declared)
      throw new Error(
        `la section « ${title} » déclare ${section.declared} satellites et en porte ${section.rows.length}`
      );

  const out = {};
  for (const [body, title] of Object.entries(systems)) {
    const section = sections.get(title);
    if (!section)
      throw new Error(
        `section « ${title} » absente de la table (présentes : ${[...sections.keys()].join(' ; ')})`
      );
    out[body] = section.rows;
  }
  const latestYear = Math.max(
    ...[...sections.values()].flatMap((s) => s.rows.flatMap((r) => r.years))
  );
  if (declaredUpdate && latestYear > Number(declaredUpdate[1]))
    console.log(
      `la page se dit à jour du ${declaredUpdate[1]}-${declaredUpdate[2]}-${declaredUpdate[3]} ` +
        `et recense une découverte de ${latestYear} : sa date déclarée ne date rien, on publie celle de LECTURE (${retrieved}).`
    );
  return { url, retrieved, systems: out };
}

// ── SBDB : la découverte d'un petit corps ──────────────────────────────────────────────────

const MONTH = 'JanFebMarAprMayJunJulAugSepOctNovDec';
const sbdbDay = (s) => {
  const m = /^(\d{4})-(\w{3})-(\d{2})$/.exec(String(s));
  const month = m ? MONTH.indexOf(m[2]) / 3 + 1 : 0;
  if (!m || month < 1) throw new Error(`date SBDB illisible : « ${s} »`);
  return `${m[1]}-${String(month).padStart(2, '0')}-${m[3]}`;
};

async function sbdbDiscovery(body, designation) {
  const api = `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(designation)}&discovery=1`;
  const { text: body_, retrieved } = await get(api);
  const json = JSON.parse(body_);
  const d = json.discovery;
  if (!d?.date)
    throw new Error(
      `SBDB ne déclare aucune découverte pour ${body} (${designation})`
    );
  return {
    source: 'sbdb',
    form: 'day',
    day: sbdbDay(d.date),
    who: d.who || null,
    where: d.location || null,
    url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(designation)}`,
    retrieved,
  };
}

// ── SBDB : les satellites d'un petit corps (ligne 22.10, pas 2) ─────────────────────────────

/**
 * La MÊME requête que le relevé des faits (`snapshot-fact-sources.mjs`, `sbdbFacts`), donc la
 * réponse même dont la fiche tire son nombre de lunes (`confirmedSatellites`), à la même date de
 * lecture et dans le même cache. Deux requêtes différentes pourraient se lire à deux jours
 * d'écart et se contredire ; une seule ne le peut pas.
 */
const sbdbSatellitesUrl = (designation) =>
  `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(designation)}&phys-par=1&sat=1`;

async function sbdbSatellites(body, designation) {
  const { text: body_, retrieved } = await get(sbdbSatellitesUrl(designation));
  const rows = JSON.parse(body_).sat ?? [];
  const confirmed = [];
  const unconfirmed = [];
  for (const sat of rows) {
    // `confirmed` n'est pas documenté par l'API (lu le 2026-10-02) : une valeur hors de « Y » et
    // « N » voudrait dire qu'on ne sait plus ce que l'on compte.
    if (sat.confirmed !== 'Y' && sat.confirmed !== 'N')
      throw new Error(
        `${body} : « confirmed » vaut ${JSON.stringify(sat.confirmed)} pour ${sat.prov_des}, ni Y ni N`
      );
    // `year` est « year of discovery » selon la documentation de l'API, et jamais nul. La
    // référence, elle, est souvent d'une autre année (Dactyl 1993, Belton et al. 1994).
    if (!YEAR.test(String(sat.year)))
      throw new Error(
        `${body} : année illisible pour ${sat.prov_des} : « ${sat.year} »`
      );
    // Makémaké : `iau_name` vaut la chaîne VIDE, pas `null` (mesuré le 2026-10-02). Le nom est
    // alors la désignation provisoire, comme dans la table du JPL.
    const iauName = sat.iau_name || null;
    const row = {
      name: iauName ?? sat.prov_des,
      ...(iauName ? { provisional: sat.prov_des } : {}),
      years: [Number(sat.year)],
      who: null,
      ref: sat.ref || null,
    };
    (sat.confirmed === 'Y' ? confirmed : unconfirmed).push(row);
  }
  return {
    url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(designation)}`,
    retrieved,
    confirmed,
    unconfirmed,
  };
}

// ── NSSDCA : « Discoverer » et « Discovery Date » des fiches planétaires ───────────────────

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

async function nssdcaDiscovery(body) {
  const url = `https://nssdc.gsfc.nasa.gov/planetary/factsheet/${body}fact.html`;
  const { text: html, retrieved } = await get(url);
  const lines = decode(html.replace(/<[^>]*>/g, '')).split('\n');
  const at = lines.findIndex((l) => /^\s*Discoverer:/.test(l));
  const dateLine = lines.findIndex((l) => /^\s*Discovery Date:/.test(l));
  if (at < 0 || dateLine < at)
    throw new Error(
      `champs « Discoverer » / « Discovery Date » introuvables : ${url}`
    );
  // Le découvreur court parfois sur deux lignes (Neptune : « Galle (based on predictions by » puis
  // « John Couch Adams and Urbain Leverrier) »). On joint tout ce qui précède la date.
  const who = lines
    .slice(at, dateLine)
    .join(' ')
    .replace(/^\s*Discoverer:/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const when = lines[dateLine].replace(/^\s*Discovery Date:/, '').trim();
  if (when === 'Prehistoric')
    return { source: 'nssdca', form: 'prehistoric', url, retrieved };
  const m = /^(\d{1,2}) (\w+) (\d{4})$/.exec(when);
  const month = m ? MONTHS.indexOf(m[2]) + 1 : 0;
  if (!m || month < 1)
    throw new Error(`date de découverte illisible : « ${when} » (${url})`);
  return {
    source: 'nssdca',
    form: 'day',
    day: `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`,
    who: who === 'Unknown' ? null : who,
    url,
    retrieved,
  };
}

// ── Les citations : une affirmation qu'aucune table ne déclare ─────────────────────────────

async function quoted(body, quote) {
  const { text: html, retrieved } = await get(quote.url);
  const page = text(html);
  if (!page.includes(quote.anchor))
    throw new Error(
      `citation introuvable pour ${body} : « ${quote.anchor} » n'est plus dans ${quote.url}. ` +
        `La page a été réécrite : relire ce qu'elle dit avant de changer la cible.`
    );
  return {
    source: quote.source,
    form: quote.form,
    ...(quote.year ? { years: [quote.year] } : {}),
    url: quote.url,
    retrieved,
  };
}

// ── L'assemblage ───────────────────────────────────────────────────────────────────────────

const bodies = catalogue();
const satellites = await jplSatellites();
const records = new Map([...bodies.keys()].map((id) => [id, []]));

// Chaque lune du catalogue doit être trouvée dans la section de son parent, par son nom UAI.
const systemFiles = {};
for (const [parent, rows] of Object.entries(satellites.systems)) {
  const moons = new Map(
    bodies.get(parent).satellites.map((id) => [bodies.get(id).name, id])
  );
  const list = rows.map((row) => {
    const id = moons.get(row.name);
    if (id) {
      moons.delete(row.name);
      records.get(id).push({
        source: 'jpl-sats',
        form: 'years',
        years: row.years,
        who: row.who,
        ref: row.ref,
        url: satellites.url,
        retrieved: satellites.retrieved,
      });
    }
    return id ? { ...row, body: id } : row;
  });
  if (moons.size)
    throw new Error(
      `lunes du catalogue absentes de la section de ${parent} : ${[...moons.keys()].join(', ')}`
    );
  systemFiles[parent] = {
    source: 'jpl-sats',
    url: satellites.url,
    retrieved: satellites.retrieved,
    list,
  };
}

// Les satellites des petits corps que la table du JPL n'a pas en section : la liste des corps se
// DÉRIVE (toute désignation SBDB du catalogue), jamais écrite.
for (const [body, designation] of Object.entries(SBDB)) {
  if (!bodies.has(body)) continue;
  const read = await sbdbSatellites(body, designation);
  const jpl = systemFiles[body];
  if (jpl) {
    // TÉMOIN (Pluton) : là où les deux sources se recouvrent, elles doivent dire la même chose,
    // nom pour nom et année pour année. C'est ce qui prouve que `year` de SBDB est bien l'année
    // de découverte au sens de la table du JPL, et pas celle de la publication.
    const byName = new Map(jpl.list.map((row) => [row.name, row]));
    for (const row of read.confirmed) {
      const twin = byName.get(row.name);
      if (!twin || !twin.years.includes(row.years[0]))
        throw new Error(
          `${body} : SBDB date ${row.name} de ${row.years[0]}, la table du JPL ` +
            `${twin ? `de ${twin.years.join(', ')}` : 'ne le recense pas'}`
        );
    }
    if (read.confirmed.length !== jpl.list.length)
      throw new Error(
        `${body} : SBDB confirme ${read.confirmed.length} satellites, la table du JPL en recense ${jpl.list.length}`
      );
    console.log(
      `témoin : ${body}, ${read.confirmed.length} satellites, mêmes noms et mêmes années dans SBDB et la table du JPL`
    );
    continue;
  }
  if (read.confirmed.length === 0 && read.unconfirmed.length === 0) continue;
  systemFiles[body] = {
    source: 'sbdb',
    url: read.url,
    retrieved: read.retrieved,
    list: read.confirmed,
    ...(read.unconfirmed.length ? { unconfirmed: read.unconfirmed } : {}),
  };
}

for (const system of Object.values(systemFiles))
  system.list.sort(
    (a, b) =>
      Math.min(...a.years) - Math.min(...b.years) ||
      a.name.localeCompare(b.name)
  );

// PARITÉ : tout corps dont la fiche affiche au moins une lune a la liste de ses satellites, d'un
// compte ÉGAL, ou une raison écrite. Un écart ne se tranche pas : il s'écrit, en arrêtant tout.
const notCovered = TARGETS.satellitesNotCovered ?? {};
const uncovered = [];
for (const [id, body] of bodies) {
  const system = systemFiles[id];
  if (notCovered[id]) {
    if (system)
      throw new Error(
        `${id} a une raison écrite dans satellitesNotCovered ET une liste de satellites`
      );
    continue;
  }
  if (system && system.list.length !== body.moonCount)
    throw new Error(
      `${id} : la fiche affiche ${body.moonCount} lune(s), la liste (${system.source}) en compte ${system.list.length}. ` +
        `Relire les deux sources : l'une a avancé sans l'autre.`
    );
  if (!system && body.moonCount > 0)
    uncovered.push(`${id} (${body.moonCount})`);
}
if (uncovered.length)
  throw new Error(
    `corps dont la fiche affiche des lunes, sans liste de satellites NI raison écrite : ${uncovered.join(', ')}. ` +
      `Déclarer une raison dans satellitesNotCovered de scripts/discovery-targets.json.`
  );

for (const [body, designation] of Object.entries(SBDB)) {
  if (!records.has(body)) continue;
  records.get(body).push(await sbdbDiscovery(body, designation));
}
for (const body of TARGETS.nssdcaPlanets)
  records.get(body).push(await nssdcaDiscovery(body));

for (const [body, quotes] of Object.entries(TARGETS.quotes)) {
  for (const quote of quotes) {
    const claim = await quoted(body, quote);
    if (claim.form !== 'predictedReturn') {
      records.get(body).push(claim);
      continue;
    }
    // Une citation de RETOUR PRÉDIT requalifie la date de découverte d'une autre source, et
    // seulement si l'année concorde. Sinon on s'arrête : ce serait requalifier autre chose.
    const target = records
      .get(body)
      .find(
        (c) => c.form === 'day' && Number(c.day.slice(0, 4)) === quote.year
      );
    if (!target)
      throw new Error(
        `${body} : NASA Science parle d'un retour en ${quote.year}, et aucune source ne date de ` +
          `cette année-là la découverte qu'elle requalifierait.`
      );
    target.role = 'predictedReturn';
    target.roleUrl = claim.url;
    target.roleRetrieved = claim.retrieved;
  }
}

const notApplicable = TARGETS.notApplicable;
const missing = [];
for (const [body, claims] of records) {
  if (notApplicable[body]) {
    if (claims.length)
      throw new Error(
        `${body} est déclaré sans objet ET porte ${claims.length} affirmation(s)`
      );
    continue;
  }
  if (!claims.length) missing.push(body);
}
if (missing.length)
  throw new Error(
    `corps du catalogue sans découverte NI raison écrite : ${missing.join(', ')}. ` +
      `Déclarer une source dans scripts/discovery-targets.json, ou une raison dans notApplicable.`
  );

// Les désaccords se publient, ils ne s'arbitrent pas : on les imprime pour qu'ils se voient.
for (const [body, claims] of records) {
  const days = new Set(
    claims.filter((c) => c.form === 'day').map((c) => c.day)
  );
  if (days.size > 1)
    console.log(
      `désaccord publié tel quel : ${body} — ${[...days].join(' / ')}`
    );
  for (const c of claims)
    if (c.form === 'years' && c.years.length > 1)
      console.log(`deux années publiées : ${body} — ${c.years.join(', ')}`);
  for (const c of claims)
    if (c.role === 'predictedReturn')
      console.log(
        `requalifiée en retour prédit : ${body} — ${c.day} (${c.source})`
      );
}

// ── L'écriture ─────────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
const drifted = [];
const write = (path, json) => {
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (before === json) return;
  if (check) drifted.push(path);
  else writeFileSync(path, json);
};

const index = {
  sources: {
    'jpl-sats': {
      publisher: 'NASA JPL Solar System Dynamics',
      title: 'Planetary Satellite Discovery Circumstances',
      url: satellites.url,
    },
    sbdb: {
      publisher: 'NASA JPL Solar System Dynamics',
      title: 'Small-Body Database, discovery circumstances and satellites',
      url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html',
      api: 'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1&discovery=1',
    },
    nssdca: {
      publisher: 'NASA NSSDCA',
      title: 'Planetary Fact Sheets',
      url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/',
    },
    'jpl-planets': {
      publisher: 'NASA JPL Solar System Dynamics',
      title: 'Planets, Discovery Circumstances',
      url: 'https://ssd.jpl.nasa.gov/planets/discovery.html',
    },
    'nasa-science': {
      publisher: 'NASA Science',
      title: 'Comet 1P/Halley',
      url: 'https://science.nasa.gov/solar-system/comets/1p-halley/',
    },
  },
  bodies: {},
  systems: {},
};
for (const body of [...records.keys()].sort()) {
  index.bodies[body] = notApplicable[body]
    ? { notApplicable: true }
    : { claims: records.get(body) };
}
for (const parent of Object.keys(systemFiles).sort()) {
  const { source, url, retrieved, list, unconfirmed } = systemFiles[parent];
  const json = JSON.stringify(list);
  index.systems[parent] = {
    source,
    url,
    total: list.length,
    bytes: Buffer.byteLength(json),
    retrieved,
    // Non confirmés : pas comptés, mais la fiche dit qu'ils existent.
    ...(unconfirmed ? { unconfirmed } : {}),
  };
  write(join(OUT, `${parent}.json`), json);
}
write(INDEX, `${JSON.stringify(index, null, 1)}\n`);

const claims = [...records.values()].flat();
console.log(
  `${Object.keys(index.bodies).length} corps : ${claims.length} affirmations ` +
    `(${Object.keys(notApplicable).length} sans objet), ` +
    `${Object.values(systemFiles).flatMap((s) => s.list).length} satellites sur ${Object.keys(systemFiles).length} systèmes`
);
if (check) {
  if (drifted.length) {
    console.error(
      `dérive par rapport à la source :\n  ${drifted.join('\n  ')}`
    );
    process.exit(1);
  }
  console.log('--check : aucun fichier livré n’a dérivé.');
}
