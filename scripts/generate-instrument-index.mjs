#!/usr/bin/env node
/* global console, process, fetch */
/**
 * QUELS INSTRUMENTS UNE SONDE PORTE, ET DANS QUELLES INVESTIGATIONS ELLE A SERVI (lot 42).
 *
 * Le lot 40 a répondu « qu'est-ce qui est venu ICI » sur la fiche d'un CORPS. La fiche d'une SONDE
 * restait, elle, sans rien d'autre que son nom, sa description et ses quatre faits de lancement :
 * `config/missions.ts` le dit noir sur blanc, « une mission n'est pas la cible d'une archive, elle
 * en est l'auteur », donc le bloc « Missions » y reste masqué. Ce script donne à la sonde la
 * question qui est la sienne, lue au même registre de contexte du Planetary Data System.
 *
 * LES CIBLES SE LISENT, ELLES NE SE DEVINENT PAS : `scripts/pds-archive-targets.json`, qui porte
 * aussi la RAISON mesurée des deux sondes absentes du registre. Son en-tête explique pourquoi la
 * jointure est déclarée plutôt que dérivée d'un `naif_host_id` qui mélange un entier, un
 * mnémonique et la phrase « not applicable ».
 *
 * TROIS CHOSES MESURÉES LE 2026-09-30 QU'AUCUNE RELECTURE N'AURAIT DONNÉES :
 *
 *   1. LA JOINTURE EST ASYMÉTRIQUE, et lire un seul sens PERD une mission. L'investigation
 *      `mission.apex` (OSIRIS-APEX, l'extension vers Apophis) déclare `spacecraft.orex` parmi ses
 *      porteurs, alors que le produit `spacecraft.orex` ne déclare PAS `mission.apex` parmi ses
 *      investigations. Sur nos onze porteurs, c'est le seul désaccord, et il vaut une mission
 *      entière. On prend donc l'UNION des deux sens, et l'asymétrie est IMPRIMÉE : elle n'est pas
 *      fusionnée en silence, parce qu'une contradiction de la source est une information.
 *
 *   2. « PHASE » EST LE MAUVAIS MOT, et c'est la mesure qui l'a dit. Une sonde est citée par une à
 *      trois investigations, mais elles ne sont pas toutes des phases de sa mission : New Horizons
 *      en a bien trois (la mission, puis KEM1 et KEM2, ses deux extensions Kuiper), OSIRIS-REx
 *      deux (OSIRIS-REx puis OSIRIS-APEX), mais la SECONDE de Voyager 2 est « Comet D/1993 F2
 *      (Shoemaker-Levy 9) Collision into Jupiter », qui est une CAMPAGNE d'observation et non une
 *      phase de Voyager 2. Publier « phases » aurait été faux. On publie donc ce que l'archive
 *      déclare : les investigations où cette sonde figure.
 *
 *   3. UN INSTRUMENT NE PUBLIE AUCUN TYPE. Mesuré sur cinq produits de trois agences : la classe
 *      `pds:Instrument` ne sert que `name`, `description`, `naif_instrument_id` et
 *      `serial_number`. Il n'y a donc rien à classer, et un « type » d'instrument ne sera pas
 *      inventé. Le `naif_instrument_id` porte la même plaie que celui du porteur — « not
 *      applicable » en clair — et n'est publié QUE lorsqu'il est numérique.
 *
 * CE QUI N'EST PAS LIVRÉ, ET POURQUOI : la DESCRIPTION de chaque instrument. Elle existe, elle est
 * riche, et elle est en ANGLAIS uniquement. Le nom d'un instrument est un nom propre, qu'on publie
 * donc tel quel dans les quatre langues, comme le bloc « Missions » publie « Lucy MIssion » sans
 * le corriger ; un PARAGRAPHE de prose anglaise sous une interface portugaise serait une
 * régression, et le traduire serait inventer. Elle reste donc au registre du PDS, que le lid cite.
 *
 * `--offline` (cache partagé avec le relevé des faits, donc UNE seule règle de date de lecture),
 * `--check` (n'écrit rien, sort en code 1 si un fichier livré a dérivé de la source).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
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
const OUT = join(ROOT, 'public', 'assets', 'instruments');
/**
 * L'index vit dans `src/`, les listes dans `public/`, pour la raison que Vite impose et que le
 * gazetteer puis les missions ont déjà payée : un module de l'application ne peut pas importer
 * depuis `public/`. L'application a besoin de savoir COMBIEN d'instruments porte une sonde pour
 * annoncer le bloc sans rien demander ; elle n'a pas besoin des cent et quelques noms au démarrage.
 */
const INDEX = join(ROOT, 'src', 'config', 'instrumentIndex.json');

const API = 'https://pds.nasa.gov/api/search/1';
const CONTEXT = `${API}/classes/context`;
const NO_END_SENTINEL = '3000-01-01';
/** Ce que le PDS écrit quand un champ ne s'applique pas. En CLAIR, dans un champ d'identifiant. */
const NOT_APPLICABLE = 'not applicable';

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const check = args.includes('--check');

const one = (v) => (Array.isArray(v) ? v[0] : v);
const day = (v) => {
  const s = one(v);
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)
    ? s.slice(0, 10)
    : null;
};
const refs = (v) => (v ?? []).filter((x) => x && x !== 'null');
/** Un identifiant NAIF n'est publié que s'il EST un nombre. Cf. le point 3 de l'en-tête. */
const naifNumber = (v) => {
  const s = one(v);
  return typeof s === 'string' && /^-?\d+$/.test(s) ? Number(s) : null;
};

/**
 * Une réponse du PDS, avec sa date de lecture. Même cache et même règle de date que le relevé des
 * faits : une date de lecture appartient à la RÉPONSE (lot 25), et il n'y a pas deux règles.
 *
 * UNE RÉPONSE REFUSÉE NE RESTE PAS EN CACHE. Cette API rend HTTP 200 avec `{"hits":0,"data":[]}`
 * quand la requête ne correspond à rien : l'écrire au cache ferait échouer le script
 * DÉFINITIVEMENT sur un fichier d'apparence saine, exactement comme la page « Errors and
 * Messages » du NSSDCA l'a fait au relevé des faits.
 */
async function get(url, valid) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${cacheKey(url)}.json`);
  const refuse = (why) => {
    if (existsSync(path)) unlinkSync(path);
    const stamp = path.replace(/\.json$/, '.at');
    if (existsSync(stamp)) unlinkSync(stamp);
    throw new Error(
      `réponse refusée pour ${url} : ${why}. Elle a été retirée du cache, ` +
        `donc une relance réinterrogera la source au lieu de rejouer une réponse fautive.`
    );
  };
  if (existsSync(path)) {
    const body = readFileSync(path, 'utf8');
    const why = valid?.(body);
    if (why) refuse(why);
    return { body, retrieved: stampOf(path) };
  }
  if (offline) throw new Error(`absent du cache et --offline demandé : ${url}`);
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok)
    throw new Error(`HTTP ${res.status} sur ${url} : ${body.slice(0, 200)}`);
  const why = valid?.(body);
  // Pas encore écrite : il suffit de ne pas l'écrire.
  if (why)
    throw new Error(
      `réponse refusée pour ${url} : ${why}. Rien n'a été mis en cache.`
    );
  writeFileSync(path, body);
  return { body, retrieved: stampNow(path) };
}

/** Un produit de contexte, lu par son identifiant logique, et CONFRONTÉ à ce qu'on demandait. */
async function product(lid, kind) {
  const { body } = await get(
    `${API}/products/${encodeURIComponent(lid)}`,
    (text) => {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return `corps illisible pour ${lid}, ce n'est pas du JSON`;
      }
      const props = parsed.properties ?? {};
      if (one(props.lid) !== lid)
        return `le produit rendu porte l'identifiant ${String(one(props.lid))} et non ${lid}`;
      if (!props[`pds:${kind}.pds:name`])
        return `le produit ${lid} ne publie pas de nom de ${kind}`;
      return null;
    }
  );
  return JSON.parse(body).properties;
}

/**
 * Les investigations de type « Mission », en une requête. Leur NOMBRE ne s'écrit pas ici : il a
 * rendu 113 puis 112 à une heure d'intervalle le 2026-09-30, et le registre est vivant.
 */
async function investigations() {
  const fields = [
    'lid',
    'pds:Investigation.pds:name',
    'pds:Investigation.pds:start_date',
    'pds:Investigation.pds:stop_date',
    'ref_lid_instrument_host',
  ];
  const url =
    `${CONTEXT}?q=${encodeURIComponent('pds:Investigation.pds:type eq "Mission"')}` +
    `&limit=500&fields=${fields.join(',')}`;
  const { body, retrieved } = await get(url, (text) => {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return 'corps illisible, ce n’est pas du JSON';
    }
    const rows = parsed.data ?? [];
    if (rows.length < (parsed.summary?.hits ?? 0))
      return `le PDS annonce ${parsed.summary.hits} missions et n’en rend que ${rows.length}, il faudrait paginer`;
    if (rows.length < 100)
      return `${rows.length} missions seulement, réponse tronquée ou format changé`;
    return null;
  });
  return { rows: JSON.parse(body).data, retrieved };
}

/** Les fiches de sondes, LUES du registre : leur ordre et leur identifiant NAIF déclaré. */
function spacecraftFiches() {
  const dir = join(ROOT, 'src', 'registry', 'spacecraft');
  const order = JSON.parse(readFileSync(join(dir, 'order.json'), 'utf8')).order;
  const naif = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'order.json') continue;
    const fiche = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    naif.set(fiche.id, fiche.identifiers?.naif ?? null);
  }
  return { order, naif };
}

const targets = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'pds-archive-targets.json'), 'utf8')
).spacecraft;
const { order, naif } = spacecraftFiches();

/**
 * LA LISTE DES SONDES SE DÉRIVE DU REGISTRE, elle ne se recopie pas ici : ajouter une sonde
 * OBLIGE à déclarer son porteur ou la raison de son absence, sinon ce script s'arrête. C'est la
 * règle de parité de l'utilisateur rendue mécanique : un manque est comblé ou écrit, jamais laissé.
 */
{
  const declared = new Set(Object.keys(targets));
  const missing = order.filter((id) => !declared.has(id));
  const extra = [...declared].filter((id) => !order.includes(id));
  if (missing.length || extra.length)
    throw new Error(
      `scripts/pds-archive-targets.json ne décrit pas exactement le registre des sondes.` +
        (missing.length
          ? `\n  sans déclaration (porteur ou raison d'absence) : ${missing.join(', ')}`
          : '') +
        (extra.length
          ? `\n  déclarées mais hors registre : ${extra.join(', ')}`
          : '')
    );
  for (const [id, entry] of Object.entries(targets)) {
    const hasHosts = Array.isArray(entry.instrumentHosts);
    if (hasHosts === Boolean(entry.absent))
      throw new Error(
        `${id} doit déclarer SOIT des porteurs SOIT une raison d'absence, jamais les deux ni aucun`
      );
    if (entry.absent && entry.absent.length < 80)
      throw new Error(
        `la raison d'absence de ${id} est trop courte pour être une mesure : ` +
          `elle doit dire ce qui a été cherché, et avec quel témoin`
      );
  }
}

const { rows, retrieved } = await investigations();

/** Ce que chaque investigation déclare : son intervalle, et les porteurs qu'elle cite. */
const byLid = new Map();
const sentinels = [];
for (const row of rows) {
  const props = row.properties;
  const lid = one(props.lid);
  let end = day(props['pds:Investigation.pds:stop_date']);
  if (end === NO_END_SENTINEL) {
    sentinels.push(lid);
    end = null;
  }
  const record = {
    lid,
    name: one(props['pds:Investigation.pds:name']),
    start: day(props['pds:Investigation.pds:start_date']),
    end,
    hosts: refs(props.ref_lid_instrument_host),
  };
  if (!record.name || !record.start)
    throw new Error(`investigation sans nom ou sans début : ${lid}`);
  const already = byLid.get(lid);
  /**
   * Deux lignes d'un même identifiant sont fusionnées SEULEMENT si elles s'accordent une fois
   * normalisée la « pas de fin » ; un désaccord réel ferait publier un chiffre qui dépend de
   * l'ordre des lignes, et Venus Express a montré que le cas se produit (lot 40).
   */
  if (already) {
    const a = JSON.stringify({ ...already, hosts: [...already.hosts].sort() });
    const b = JSON.stringify({ ...record, hosts: [...record.hosts].sort() });
    if (a !== b)
      throw new Error(
        `le registre rend DEUX lignes divergentes pour ${lid} :\n  ${a}\n  ${b}\n` +
          `Choisir entre elles serait arbitraire : on s'arrête.`
      );
    continue;
  }
  byLid.set(lid, record);
}

/** Pour un porteur, les investigations qui le CITENT : le second sens de la jointure. */
const citedBy = new Map();
for (const record of byLid.values())
  for (const host of record.hosts) {
    if (!citedBy.has(host)) citedBy.set(host, new Set());
    citedBy.get(host).add(record.lid);
  }

const asymmetries = [];
const built = new Map();

for (const id of order) {
  const entry = targets[id];
  if (entry.absent) continue;
  const hosts = [];
  const investigationLids = new Set();
  const instrumentLids = new Set();

  for (const hostLid of entry.instrumentHosts) {
    const props = await product(hostLid, 'Instrument_Host');
    /**
     * LE TYPE SE LIT, IL NE SE DÉDUIT PAS DU SEGMENT DE L'IDENTIFIANT. Mesuré le 2026-09-30 :
     * `urn:nasa:pds:context:instrument_host:spacecraft.insight` porte le segment « spacecraft. »
     * et le type publié « Lander ». L'identifiant mentirait donc à qui le lirait, et c'est
     * exactement sur ce produit que cette garde a été falsifiée.
     */
    const type = one(props['pds:Instrument_Host.pds:type']);
    if (type !== 'Spacecraft')
      throw new Error(
        `${hostLid} est publié comme « ${String(type)} » et non « Spacecraft » : ` +
          `la déclaration de ${id} pointe autre chose qu'une sonde.`
      );
    /**
     * LE CROISEMENT QUI RATTRAPERAIT UNE ERREUR DE DÉCLARATION. Quand le PDS publie un
     * `naif_host_id` NUMÉRIQUE, il doit être celui de notre fiche. C'est exercé sur donnée réelle
     * par Hayabusa2 (-37) et OSIRIS-REx (-64) ; ailleurs le champ est un mnémonique (« VG1 »),
     * `null`, ou la phrase « not applicable », et il n'y a alors rien à croiser.
     */
    const published = naifNumber(props['pds:Instrument_Host.pds:naif_host_id']);
    const expected = naif.get(id);
    if (published !== null && published !== expected)
      throw new Error(
        `désaccord d'identifiant NAIF sur ${hostLid} : le PDS publie ${published} et la fiche ` +
          `${id} déclare ${String(expected)}. La déclaration pointe probablement la mauvaise sonde.`
      );
    hosts.push({
      lid: hostLid,
      name: one(props['pds:Instrument_Host.pds:name']),
    });
    for (const lid of refs(props.ref_lid_instrument)) instrumentLids.add(lid);

    // L'UNION DES DEUX SENS, et l'asymétrie imprimée. Cf. le point 1 de l'en-tête.
    const declaredByHost = new Set(refs(props.ref_lid_investigation));
    const declaredByInvestigation = citedBy.get(hostLid) ?? new Set();
    for (const lid of declaredByHost) investigationLids.add(lid);
    for (const lid of declaredByInvestigation) investigationLids.add(lid);
    for (const lid of declaredByInvestigation)
      if (!declaredByHost.has(lid))
        asymmetries.push(`${hostLid} ← ${lid} (côté investigation seulement)`);
    for (const lid of declaredByHost)
      if (!declaredByInvestigation.has(lid))
        asymmetries.push(`${hostLid} → ${lid} (côté porteur seulement)`);
  }

  const investigationList = [];
  for (const lid of [...investigationLids].sort()) {
    const record = byLid.get(lid);
    if (!record)
      throw new Error(
        `${id} cite l'investigation ${lid}, absente de la requête « type eq Mission ». ` +
          `Soit elle n'est pas une mission, soit la requête a changé de portée.`
      );
    investigationList.push({
      lid: record.lid,
      name: record.name,
      start: record.start,
      end: record.end,
    });
  }

  const instrumentList = [];
  for (const lid of [...instrumentLids].sort()) {
    const props = await product(lid, 'Instrument');
    const naifId = naifNumber(props['pds:Instrument.pds:naif_instrument_id']);
    const raw = one(props['pds:Instrument.pds:naif_instrument_id']);
    // Un champ d'identifiant qui porte une PHRASE : on le laisse dehors, on ne le publie pas.
    if (naifId === null && raw && raw !== NOT_APPLICABLE && raw !== 'null')
      throw new Error(
        `${lid} publie un identifiant NAIF d'instrument non numérique et inattendu : ` +
          `« ${String(raw)} ». Seul « ${NOT_APPLICABLE} » est connu, et il vaut absence.`
      );
    instrumentList.push({
      lid,
      name: one(props['pds:Instrument.pds:name']),
      host: one(props.ref_lid_instrument_host) ?? null,
      ...(naifId === null ? {} : { naif: naifId }),
    });
  }

  built.set(id, {
    hosts,
    investigations: investigationList.sort(
      (a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name)
    ),
    instruments: instrumentList.sort((a, b) => a.name.localeCompare(b.name)),
  });
}

mkdirSync(OUT, { recursive: true });
const drifted = [];
const index = { provider: {}, retrieved, spacecraft: {}, absent: {} };
for (const id of order) {
  if (targets[id].absent) {
    index.absent[id] = true;
    continue;
  }
  const record = built.get(id);
  const body = JSON.stringify(record);
  index.spacecraft[id] = {
    hosts: record.hosts.length,
    investigations: record.investigations.length,
    instruments: record.instruments.length,
    bytes: Buffer.byteLength(body),
  };
  const path = join(OUT, `${id}.json`);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (check) {
    if (before !== body) drifted.push(id);
  } else if (before !== body) writeFileSync(path, body);
}

/** Les agences fédérées se DÉRIVENT des identifiants livrés (leçon du lot 40). */
const federates = [
  ...new Set(
    [...built.values()]
      .flatMap((r) => [...r.hosts, ...r.investigations, ...r.instruments])
      .map((x) => x.lid.split(':').slice(0, 3).join(':'))
  ),
].sort();

index.provider = {
  publisher: 'NASA Planetary Data System',
  title: 'PDS Registry, instrument host and instrument context products',
  url: 'https://pds.nasa.gov/',
  api: `${CONTEXT}?q=pds:Instrument_Host.pds:type eq "Spacecraft"`,
  federates,
  // Aucune licence revendiquée : la page de citation du PDS n'en déclare pas (lot 40, mesuré).
  citingGuidance: 'https://pds.nasa.gov/datastandards/citing/',
  citation:
    'NASA Planetary Data System. "PDS Registry, instrument host and instrument context products." https://pds.nasa.gov/',
};

const indexJson = `${JSON.stringify(index, null, 1)}\n`;
const beforeIndex = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : null;
if (check) {
  if (beforeIndex !== indexJson) drifted.push('index');
} else if (beforeIndex !== indexJson) writeFileSync(INDEX, indexJson);

const total = [...built.values()].reduce((n, r) => n + r.instruments.length, 0);
const cited = new Set(
  [...built.values()].flatMap((r) => r.investigations.map((i) => i.lid))
);
console.log(
  `sondes : ${built.size} jointes au registre, ${Object.keys(index.absent).length} absentes ` +
    `avec leur raison (${Object.keys(index.absent).join(', ')})`
);
console.log(
  `instruments nommés : ${total} — investigations citées : ${cited.size}`
);
if (sentinels.length)
  console.log(
    `sentinelle « ${NO_END_SENTINEL} » réécrite en « pas de fin » sur ${sentinels.length} investigations`
  );
if (asymmetries.length) {
  console.log(
    `\nJOINTURE ASYMÉTRIQUE (${asymmetries.length}) — la source se contredit, on prend l'union :`
  );
  for (const line of asymmetries) console.log(`  ${line}`);
}
for (const id of order)
  if (targets[id].absent) console.log(`\n${id} : ${targets[id].absent}`);

if (check) {
  if (drifted.length) {
    console.error(
      `\nDÉRIVE : ${drifted.join(', ')} ne correspond plus à la source. ` +
        `Relancer « pnpm instruments:generate » sans --check.`
    );
    process.exit(1);
  }
  console.log('\n--check : tout est à jour.');
}
