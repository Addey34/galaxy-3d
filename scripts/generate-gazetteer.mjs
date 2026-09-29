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
 * demarrage. Elle n'a pas besoin des 15 932 formations, qui restent servies a l'approche.
 *
 * Un seul proprietaire : cet index porte aussi la provenance et la convention, et il n'existe
 * pas de second manifeste dans `public/` qui pourrait en diverger.
 */
const INDEX = join(ROOT, 'src', 'config', 'gazetteerIndex.json');
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
      approved: field(b, 'approvaldt').slice(0, 10).replace(/\//g, '-'),
      origin: field(b, 'origin'),
      iauId: Number.parseInt(field(b, 'link').split('/').pop() ?? '', 10) || 0,
    });
  }
  out.sort(
    (a, b) => b.diameterKm - a.diameterKm || a.name.localeCompare(b.name)
  );
  return out;
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
const drifted = [];
let total = 0;
for (const { target, body } of pairs) {
  const list = features(kmlFromKmz(await kmzFor(target)));
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
  accessed: '2026-09-29',
};
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
