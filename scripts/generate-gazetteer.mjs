#!/usr/bin/env node
/* global console, process, fetch, Buffer */
/**
 * LES NOMS DE LA SURFACE, LUS AU SEUL ORGANISME QUI LES DONNE.
 *
 * L'Union astronomique internationale est la seule autorite qui nomme une formation planetaire,
 * et son Gazetteer of Planetary Nomenclature publie chaque nuit, par corps, un KMZ contenant
 * TOUT ce qu'elle a approuve : le nom, le type, le diametre, le centre, la date d'adoption, la
 * raison du nom, et un lien stable vers sa fiche. Rien ici n'est saisi a la main, et surtout pas
 * une etymologie : elles sont recopiees telles que l'IAU les publie.
 *
 * LA LISTE DES CORPS SE DERIVE, elle ne se tient pas. Le script LIT la page des telechargements
 * de l'IAU pour savoir quels corps elle couvre, et croise avec les fiches de
 * `src/registry/entities/`. Ajouter un corps au catalogue le fait donc entrer ici sans que
 * personne y pense, et un corps que l'IAU ne couvre pas ne produit pas de fichier vide. C'est la
 * lecon du lot 29 : une valeur qu'on entretient n'est pas une garde, c'est une corvee.
 *
 * CE QUE LE FICHIER LIVRE NE PORTE PAS, et pourquoi : la geometrie du contour, la `continent` et
 * l'`ethnicity` du nom. Seul ce qui s'AFFICHE est livre, plus l'identifiant IAU qui permet
 * d'aller lire le reste a la source.
 *
 * CONVENTION DE COORDONNEES, LUE ET NON SUPPOSEE : la page des telechargements dit « The images
 * and KML files are in east longitude, planetocentric latitude ». Le champ `center_lon` est donc
 * en degres EST de 0 a 360, alors que le `<Point>` du meme enregistrement est en -180..180
 * (Fensal porte `center_lon 330` et un point a `-30`). On garde `center_lon`, et la convention
 * est ecrite DANS le manifeste pour que personne n'ait a la redeviner.
 *
 * AUCUNE DEPENDANCE : un KMZ est un zip, et `zlib.inflateRawSync` suffit a en sortir le KML.
 * Ajouter une bibliotheque pour trente lignes couterait plus cher que de les ecrire.
 *
 * `--only <corps>`, `--offline` (cache dans `.cache/gaz/`), `--check` (n'ecrit rien, sort en
 * code 1 si un fichier livre a derive de la source).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'gaz');
const OUT = join(ROOT, 'public', 'assets', 'gazetteer');
/**
 * L'INDEX VIT DANS `src/`, ET LES DONNEES DANS `public/`, pour une raison que Vite impose :
 * un module de l'application ne peut pas importer depuis `public/` (« Assets in public
 * directory cannot be imported from JavaScript »). L'application a besoin, AU BUILD, de savoir
 * quels corps portent des noms — c'est ce qui lui evite de demander quoi que ce soit au
 * demarrage. Elle n'a pas besoin des formations elles-memes, qui restent servies a l'approche.
 *
 * Un seul proprietaire : cet index porte aussi la provenance et la convention, et il n'existe
 * pas de second manifeste dans `public/` qui pourrait en diverger.
 */
const INDEX = join(ROOT, 'src', 'config', 'gazetteerIndex.json');
/**
 * Les adoptions par date, HORS de la clôture de démarrage : seule la fiche d'un corps les lit,
 * par un import dynamique (`config/nameAdoptions.ts`). L'index ci-dessus, lui, est dans le bundle.
 */
const ADOPTION_INDEX = join(
  ROOT,
  'src',
  'config',
  'gazetteerAdoptionIndex.json'
);
/** Le type que l'UAI donne aux désignations lettrées (« Copernicus A »). */
const LETTERED_TYPE = 'Satellite Feature';
const GIS_PAGE = 'https://planetarynames.wr.usgs.gov/GIS_Downloads';
const KMZ = (t) =>
  `https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/${t}_nomenclature_center_pts.kmz`;

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const offline = args.includes('--offline');
const check = args.includes('--check');

/** Les cibles que l'IAU publie, LUES sur sa page plutot que recopiees. */
async function iauTargets() {
  const page = await (await fetch(GIS_PAGE)).text();
  const found = new Set();
  for (const m of page.matchAll(
    /asc-planetarynames-data[^"]*\/([A-Z_0-9]+)_nomenclature/g
  ))
    found.add(m[1]);
  if (found.size < 20)
    throw new Error(
      `la page de l'IAU ne rend que ${found.size} cibles : format change, ou reponse tronquee. ` +
        `On s'arrete plutot que de livrer un catalogue ampute.`
    );
  return found;
}

/** Les corps du catalogue, LUS du registre. */
function catalogueBodies() {
  return new Set(
    readdirSync(join(ROOT, 'src', 'registry', 'entities'))
      .filter((f) => f.endsWith('.json') && f !== 'order.json')
      .map((f) => f.slice(0, -5))
  );
}

/**
 * LA DATE DE LECTURE APPARTIENT À LA RÉPONSE (règle du lot 25). Elle était écrite en dur
 * (« 2026-09-29 ») et ne valait que par coïncidence : la fiche l'affiche désormais (« lu le … »,
 * ligne 22.10), donc une relecture qui la laisserait à son ancienne valeur mentirait. Chaque KMZ
 * est daté par l'écriture de son fichier en cache, et l'index publie le jour le PLUS ANCIEN :
 * aucune donnée n'est alors présentée comme plus fraîche qu'elle ne l'est.
 */
const readDays = [];

async function kmzFor(target) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${target}.kmz`);
  if (!existsSync(path)) {
    if (offline)
      throw new Error(`${target} absent du cache et --offline demande`);
    const res = await fetch(KMZ(target));
    if (!res.ok) throw new Error(`${target} : HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  readDays.push(statSync(path).mtime.toISOString().slice(0, 10));
  return readFileSync(path);
}

/**
 * Le KML d'un KMZ. Lecture par le REPERTOIRE CENTRAL du zip et non par un balayage des en-tetes
 * locaux : c'est le repertoire central qui fait foi, un en-tete local pouvant annoncer des
 * tailles nulles quand le zip porte un descripteur de donnees.
 */
function kmlFromKmz(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i -= 1)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('KMZ illisible : pas de repertoire central');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error('entree zip invalide');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name.toLowerCase().endsWith('.kml')) {
      const lNameLen = buf.readUInt16LE(local + 26);
      const lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compressed);
      return (method === 0 ? raw : inflateRawSync(raw)).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('KMZ sans fichier .kml');
}

/**
 * LA DATE D'ADOPTION, AVEC SA PRÉCISION (ligne 22.10, front des noms, 2026-10-02).
 *
 * Le KML écrit toujours un jour et une heure (« 2006/01/01 00:00:00 »). Mais la FICHE de l'UAI
 * n'affiche qu'une ANNÉE quand ce jour est le 1er janvier (« Approval Date : 2006 »), et un jour
 * sinon (Occator : « Jul 03, 2015 »). MESURÉ le 2026-10-02 sur 124 fiches : une par couple
 * (corps, année au 1er janvier), les 89 couples, et une fiche datée au jour par corps qui en a,
 * soit 35 : 124 conformes sur 124. Un « 01-01 » est donc une ANNÉE SEULE, et le livrer comme un
 * jour ferait dire à l'application que 7 050 cratères ont été nommés le jour de l'an 2006.
 * D'où « AAAA » pour une année seule, « AAAA-MM-JJ » pour un jour publié. L'heure est toujours
 * minuit : une autre voudrait dire que le format a changé, et on s'arrête.
 */
function approvalDate(raw, name) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) 00:00:00$/.exec(raw);
  if (!m)
    throw new Error(`date d'adoption illisible pour ${name} : « ${raw} »`);
  return m[2] === '01' && m[3] === '01' ? m[1] : `${m[1]}-${m[2]}-${m[3]}`;
}

const field = (block, name) => {
  const m = new RegExp('name="' + name + '">([^<]*)<').exec(block);
  return m ? m[1].trim() : '';
};

/** Une formation nommee, reduite a ce que l'application affiche. */
function features(kml) {
  const out = [];
  for (const m of kml.matchAll(/<Placemark[\s\S]*?<\/Placemark>/g)) {
    const b = m[0];
    const diameter = Number.parseFloat(field(b, 'diameter'));
    const lat = Number.parseFloat(field(b, 'center_lat'));
    const lon = Number.parseFloat(field(b, 'center_lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      name: field(b, 'clean_name'),
      code: field(b, 'code'),
      type: field(b, 'type'),
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      diameterKm: Number.isFinite(diameter)
        ? Math.round(diameter * 10) / 10
        : 0,
      approved: approvalDate(field(b, 'approvaldt'), field(b, 'clean_name')),
      origin: field(b, 'origin'),
      iauId: Number.parseInt(field(b, 'link').split('/').pop() ?? '', 10) || 0,
      rawLat: lat,
      rawDiameter: diameter,
    });
  }
  out.sort(
    (a, b) => b.diameterKm - a.diameterKm || a.name.localeCompare(b.name)
  );
  return out;
}

/**
 * L'UAI PUBLIE PARFOIS DEUX FOIS LA MEME FORMATION, et c'est mesure (ligne 40.3, 2026-09-30) :
 * douze identifiants repetes sur trois corps (Dione 3, Mars 1, Mercure 8), sous le MEME lien de
 * fiche, sans aucun champ qui dise lequel est courant. Six copies sont identiques dans ce qui est
 * livre : on en garde une. Six autres DIVERGENT (Kunisada : deux centres a 0,16 degre l'un de
 * l'autre, 241,45 km contre 241,0). Garder « la premiere » serait arbitraire : c'est la FICHE de
 * l'UAI qui tranche, par son diametre puis sa latitude, compares aux valeurs NON arrondies. Sa
 * longitude n'est pas comparee, parce que la fiche l'affiche dans un AUTRE systeme (Kunisada y
 * est a 246,98, soit 360 - 113,02 : positive vers l'ouest). Une fiche illisible fait ECHOUER le
 * generateur plutot que de laisser deviner.
 */
async function withoutDuplicates(body, list) {
  const byId = new Map();
  for (const f of list) byId.set(f.iauId, [...(byId.get(f.iauId) ?? []), f]);
  const drop = new Set();
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    const shipped = group.map(({ rawLat: _l, rawDiameter: _d, ...f }) =>
      JSON.stringify(f)
    );
    if (shipped.every((x) => x === shipped[0])) {
      group.slice(1).forEach((f) => drop.add(f));
      continue;
    }
    const page = await featurePage(id);
    const num = (re) => Number.parseFloat(re.exec(page)?.[1] ?? '');
    const diameter = num(/<th>Diameter<\/th>\s*<td>\s*([-\d.]+)/);
    const lat = num(/<th>Center Latitude<\/th>\s*<td>\s*([-\d.]+)/);
    if (!Number.isFinite(diameter) || !Number.isFinite(lat))
      throw new Error(
        `${body} ${id} : fiche UAI illisible, doublon impossible a trancher`
      );
    const score = (f) =>
      Math.abs(f.rawDiameter - diameter) + Math.abs(f.rawLat - lat);
    const ranked = [...group].sort((a, b) => score(a) - score(b));
    if (score(ranked[0]) === score(ranked[1]))
      throw new Error(
        `${body} ${id} : la fiche UAI ne departage pas ses ${group.length} enregistrements`
      );
    console.log(
      `${body} : ${group[0].name} (${id}) publie ${group.length} fois, la fiche garde ${ranked[0].rawLat}, ${ranked[0].rawDiameter} km`
    );
    ranked.slice(1).forEach((f) => drop.add(f));
  }
  return list.filter((f) => !drop.has(f));
}

async function featurePage(id) {
  const path = join(CACHE, `feature-${id}.html`);
  if (!existsSync(path)) {
    if (offline)
      throw new Error(`fiche UAI ${id} absente du cache et --offline demande`);
    const res = await fetch(`https://planetarynames.wr.usgs.gov/Feature/${id}`);
    if (!res.ok) throw new Error(`fiche UAI ${id} : HTTP ${res.status}`);
    writeFileSync(path, await res.text());
  }
  return readFileSync(path, 'utf8');
}

const targets = await iauTargets();
const bodies = catalogueBodies();
const pairs = [...targets]
  .map((t) => ({ target: t, body: t.toLowerCase() }))
  .filter((p) => bodies.has(p.body))
  .filter((p) => !only || p.body === only)
  .sort((a, b) => a.body.localeCompare(b.body));

if (pairs.length === 0) {
  console.error(
    only
      ? `aucun corps ne correspond a --only ${only}`
      : 'aucun corps a traiter'
  );
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const manifest = { convention: {}, provider: {}, bodies: {} };
/**
 * CE QUE L'UAI AVAIT ADOPTÉ À UNE DATE, par corps : les dates d'adoption distinctes, chacune avec
 * son nombre de noms et, parmi eux, de désignations LETTRÉES (« Copernicus A », type « Satellite
 * Feature », la Lune seule en porte). Compté ici pour que la fiche n'ait pas à télécharger les
 * 9 087 noms de la Lune pour répondre. Une date d'ADOPTION n'est pas une date de découverte ni
 * de premier usage : Copernicus A est adoptée en 2006, et sa fiche cite une liste de 1935.
 */
const adoptions = { bodies: {} };
const drifted = [];
let total = 0;
for (const { target, body } of pairs) {
  const list = (
    await withoutDuplicates(body, features(kmlFromKmz(await kmzFor(target))))
  ).map(({ rawLat: _lat, rawDiameter: _diameter, ...f }) => f);
  const json = JSON.stringify(list);
  const path = join(OUT, `${body}.json`);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (check) {
    if (before !== json) drifted.push(body);
  } else if (before !== json) {
    writeFileSync(path, json);
  }
  manifest.bodies[body] = {
    count: list.length,
    bytes: Buffer.byteLength(json),
  };
  const steps = new Map();
  for (const f of list) {
    const step = steps.get(f.approved) ?? [f.approved, 0, 0];
    step[1] += 1;
    if (f.type === LETTERED_TYPE) step[2] += 1;
    steps.set(f.approved, step);
  }
  adoptions.bodies[body] = {
    total: list.length,
    lettered: list.filter((f) => f.type === LETTERED_TYPE).length,
    // Triées par date ; une année seule (« 2006 ») passe avant les jours de cette année-là.
    steps: [...steps.values()].sort((a, b) => a[0].localeCompare(b[0])),
  };
  total += list.length;
  console.log(
    `${body.padEnd(12)} ${String(list.length).padStart(5)} formations`
  );
}

/**
 * LA PROVENANCE VOYAGE AVEC LA DONNEE, et non dans le registre des fournisseurs.
 *
 * Ce registre refuse — a juste titre, et sa garde me l'a dit — une fiche que rien ne cite : il
 * decrit les sources des FAITS affiches par corps (rayon, masse, periode). Le repertoire des
 * noms est un jeu de donnees livre, comme l'instantane des petits corps, et sa provenance se
 * suffit a elle-meme ici. La mention de domaine public et la citation sont celles que l'IAU
 * DEMANDE, lues dans sa FAQ le 2026-09-29, jamais formulees par nous.
 */
manifest.convention = {
  longitude:
    'east 0-360 degrees, as the IAU GIS download page states for its KML files',
  latitude: 'planetocentric',
  source: GIS_PAGE,
};
manifest.provider = {
  publisher:
    'International Astronomical Union Working Group for Planetary System Nomenclature',
  title: 'Gazetteer of Planetary Nomenclature',
  url: 'https://planetarynames.wr.usgs.gov/',
  rights: 'public-domain',
  rightsStatedAt: 'https://planetarynames.wr.usgs.gov/Page/FAQ',
  rightsQuote:
    'Everything in the Gazetteer of Planetary Nomenclature is in the public domain.',
  citation:
    'International Astronomical Union Working Group for Planetary System Nomenclature. "Gazetteer of Planetary Nomenclature." https://planetarynames.wr.usgs.gov/',
  accessed: [...readDays].sort()[0],
};
if (!only) {
  // La provenance voyage avec la donnée, comme dans l'index : la même.
  const aJson = `${JSON.stringify({ provider: manifest.provider, ...adoptions })}\n`;
  if (check) {
    if (
      !existsSync(ADOPTION_INDEX) ||
      readFileSync(ADOPTION_INDEX, 'utf8') !== aJson
    )
      drifted.push('adoptions');
  } else writeFileSync(ADOPTION_INDEX, aJson);
}
if (!only) {
  const mPath = INDEX;
  const mJson = JSON.stringify(manifest, null, 1);
  if (check) {
    if (!existsSync(mPath) || readFileSync(mPath, 'utf8') !== mJson)
      drifted.push('manifest');
  } else writeFileSync(mPath, mJson);
}

console.log(`\n${pairs.length} corps, ${total} formations nommees`);
if (check && drifted.length > 0) {
  console.error(
    `\nA DERIVE de la source : ${drifted.join(', ')}. Relancer sans --check.`
  );
  process.exit(1);
}
if (check) console.log("rien n'a derive");
