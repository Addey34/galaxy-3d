#!/usr/bin/env node
/* global console, process, fetch */
/**
 * QUELLES MISSIONS ONT ÉTUDIÉ CE CORPS, LU AU REGISTRE QUI ARCHIVE LEURS DONNÉES (lot 40).
 *
 * L'application savait déjà OÙ est une sonde à une date, et depuis le lot 37 elle sait NOMMER une
 * formation. Elle ne savait pas répondre à « qu'est-ce qui est venu ici, et quand ». Ce script le
 * DÉRIVE du registre de contexte du Planetary Data System, qui est la seule source à déclarer,
 * pour chaque mission, l'intervalle qu'elle couvre ET les corps qu'elle prend pour cibles.
 *
 * POURQUOI CE REGISTRE ET PAS UN AUTRE, mesuré le 2026-09-30 avant d'écrire une ligne :
 *   - il fédère les trois agences sous une seule API : `urn:nasa:pds`, mais aussi
 *     `urn:esa:psa` (BepiColombo, JUICE, Mars Express, Rosetta, Venus Express, ExoMars) et
 *     `urn:jaxa:darts` (Hayabusa2). La priorité ESA du réservoir de vision est donc servie sans
 *     seconde source ;
 *   - la cible d'une investigation est COMPLÈTE et non anecdotique : Voyager y déclare 55 cibles,
 *     dont les cinq grandes lunes d'Uranus et les quatre de Neptune ;
 *   - une seule requête rend les 113 missions, donc le relevé ne dépend pas de 113 disponibilités.
 *
 * CE QUE LE TÉMOIN A TROUVÉ, et qu'aucune relecture n'aurait donné : `pds:Investigation.pds:
 * start_date` N'EST PAS UNE DATE DE LANCEMENT. Voyager y commence le 1972-07-01, alors que
 * Voyager 1 a décollé le 1977-09-05 (notre propre registre, `voyager1.json`). C'est le début du
 * PROJET. Nommer ce champ « lancement » aurait publié une affirmation fausse sur onze fiches, et
 * c'est le croisement avec nos `launchDate` qui l'a dit. Le script REFUSE de confondre les deux :
 * il ne publie que « début » et « fin », les mots de la source.
 *
 * DEUX FAÇONS DE NE PAS DÉCLARER UNE FIN, et elles se ressemblent exactement : 31 missions
 * rendent `null`, et 6 rendent la SENTINELLE `3000-01-01`. Les deux veulent dire « l'archive ne
 * déclare pas de fin », et aucune ne veut dire « toujours en cours » : Venus Express porte la
 * sentinelle alors que la mission s'est terminée en 2014, et Venera 4 rend `null` alors qu'elle
 * s'est tue en 1967. Publier « en cours » serait donc faux dans les deux cas. La sentinelle est
 * réécrite `null`, et les missions concernées sont IMPRIMÉES pour que la substitution se voie.
 *
 * L'APPARIEMENT CORPS ↔ CIBLE NE SE DEVINE PAS, il se dérive et se croise deux fois :
 *   - le segment terminal de l'identifiant PDS doit être un corps du catalogue
 *     (`satellite.jupiter.europa` → `europa`), ou, pour un petit corps, être préfixé de la
 *     désignation SBDB que `fact-source-targets.json` DÉCLARE déjà (`16_psyche`, `1p_halley`) ;
 *   - et le TYPE publié par le PDS doit être d'accord avec le `targetClass` de la fiche. Sans ce
 *     second accord, « 106 Dione » l'astéroïde s'apparierait à Dione la lune de Saturne.
 * Un désaccord ÉCHOUE, il ne se saute pas en silence. Tout ce qui ne s'apparie pas est imprimé,
 * groupé par type : c'est l'inventaire des lieux que le catalogue n'a pas (67P, Arrokoth,
 * Didymos, Lutetia, Gaspra…), et il vaut d'être lu.
 *
 * `--offline` (cache dans `.cache/fact-sources/`, partagé avec le relevé des faits, donc UNE
 * seule règle de date de lecture), `--check` (n'écrit rien, sort en code 1 si un fichier livré a
 * dérivé de la source).
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
const OUT = join(ROOT, 'public', 'assets', 'missions');
/**
 * L'INDEX VIT DANS `src/`, LES MISSIONS DANS `public/`, pour la raison que Vite impose et que le
 * gazetteer a déjà payée : un module de l'application ne peut pas importer depuis `public/`.
 * L'application a besoin, au build, de savoir COMBIEN de missions porte chaque corps — c'est ce
 * qui lui permet d'annoncer le bloc sans rien demander au démarrage. Elle n'a pas besoin des 113
 * missions, qui restent servies à l'ouverture d'une fiche.
 */
const INDEX = join(ROOT, 'src', 'config', 'missionIndex.json');
/**
 * LE CATALOGUE DES MISSIONS, pour les pages `/missions/` (2026-10-04). Il vit dans `src/seo/`,
 * dossier qui n'atteint jamais le bundle (`src/buildOnly.ts`) : seules les pages générées au
 * build le lisent, et l'application n'a besoin ni des descriptions ni des cibles hors catalogue.
 */
const CATALOGUE = join(ROOT, 'src', 'seo', 'missionCatalogue.json');

const API = 'https://pds.nasa.gov/api/search/1';
const CONTEXT = `${API}/classes/context`;
/** La sentinelle « pas de fin déclarée » du PDS. Mesurée, pas supposée : cf. l'en-tête. */
const NO_END_SENTINEL = '3000-01-01';
/**
 * Et son PENDANT pour le début, trouvé le 2026-10-04 en REGARDANT l'index des pages de mission :
 * DART déclare un début au 1000-01-01. Une seule mission sur 112. Elle ne visait aucun corps du
 * catalogue, jusqu'à l'entrée de Didymos le même jour : la fiche de Didymos aurait alors affiché
 * une mission commencée en l'an 1000. Elle est réécrite `null` (« début non déclaré ») partout,
 * et `core/missions.ts` a l'état qui le dit (`startUndeclared`).
 */
const NO_START_SENTINEL = '1000-01-01';

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

/**
 * Une réponse du PDS, avec sa date de lecture. Le cache et la règle de date sont ceux du relevé
 * des faits : une date de lecture appartient à la RÉPONSE (lot 25), et il n'y a pas deux règles.
 */
async function get(url, valid) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${cacheKey(url)}.json`);
  /**
   * UNE RÉPONSE REFUSÉE NE RESTE PAS EN CACHE, et c'est la leçon du NSSDCA appliquée ici.
   *
   * Cette API rend HTTP 200 avec `{"hits":0,"data":[]}` quand la requête ne correspond à rien :
   * 60 octets d'apparence parfaitement normale. Écrire cela au cache ferait échouer le script
   * DÉFINITIVEMENT, sur un fichier normal, et relancer n'y changerait rien — exactement ce qui
   * est arrivé au relevé des faits avec la page « Errors and Messages » servie en 200. Une
   * réponse qui ne passe pas son contrôle est donc EFFACÉE, et le script le dit.
   */
  const refuse = (body, why) => {
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
    if (why) refuse(body, why);
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

/** Les corps du catalogue, LUS du registre, avec leur classe déclarée. */
function catalogueBodies() {
  const dir = join(ROOT, 'src', 'registry', 'entities');
  const bodies = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'order.json') continue;
    const fiche = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    bodies.set(fiche.id, fiche.targetClass);
  }
  return bodies;
}

/** Les désignations SBDB déjà DÉCLARÉES par le relevé des faits. Aucune n'est réécrite ici. */
function sbdbDesignations() {
  const targets = JSON.parse(
    readFileSync(join(ROOT, 'scripts', 'fact-source-targets.json'), 'utf8')
  );
  return targets.sbdb;
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
    'ref_lid_target',
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

/**
 * LA DESCRIPTION DE CHAQUE MISSION, par une SECONDE requête et non en ajoutant un champ à la
 * première. Ajouter un champ changerait l'adresse, donc la clé de cache, donc la date de lecture
 * de l'index que l'application affiche déjà (« lu dans l'archive du PDS le … ») : une page de
 * plus ne doit pas redater un bloc de fiche qui n'a pas changé. Les pages publient donc DEUX
 * dates, chacune celle de sa réponse.
 *
 * Mesuré le 2026-10-04 : les 112 missions publient une description, en prose, de 103 à 2 593
 * caractères, en anglais. Une mission sans description fait ÉCHOUER : une page sans texte serait
 * une adresse de plus dans le sitemap, et rien d'autre.
 */
async function descriptions() {
  const fields = ['lid', 'pds:Investigation.pds:description'];
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
  const byLid = new Map();
  for (const row of JSON.parse(body).data) {
    const lid = one(row.properties.lid);
    const text = one(row.properties['pds:Investigation.pds:description']);
    // Le champ demandé revient TOUJOURS, rempli de la chaîne « null » quand il est absent
    // (piège mesuré au lot 42) : c'est la valeur qui se teste, pas la présence de la clé.
    if (typeof text === 'string' && text.trim() && text !== 'null')
      byLid.set(lid, text.replace(/\s+/g, ' ').trim());
  }
  return { byLid, retrieved };
}

/** Le produit de contexte d'une cible : son nom et son type PUBLIÉS. */
async function target(lid) {
  const { body } = await get(`${API}/products/${encodeURIComponent(lid)}`);
  const props = JSON.parse(body).properties ?? {};
  return {
    name: one(props['pds:Target.pds:name']) ?? null,
    type: one(props['pds:Target.pds:type']) ?? null,
  };
}

/**
 * `Dwarf Planet` → `dwarf_planet`, pour confronter le type PDS au `targetClass` du registre.
 *
 * UNE SEULE TRADUCTION, et elle est écrite : le PDS publie « Trans-Neptunian Object » (Arrokoth),
 * que le vocabulaire EPNCore du registre ne connaît pas. EPNCore range un objet transneptunien
 * sous `asteroid` ; sans cette ligne, Arrokoth ne s'apparierait jamais (2026-10-04).
 */
const PDS_CLASS_ALIASES = { 'trans-neptunian_object': 'asteroid' };
const asTargetClass = (type) => {
  if (typeof type !== 'string') return null;
  const cls = type.toLowerCase().replace(/\s+/g, '_');
  return PDS_CLASS_ALIASES[cls] ?? cls;
};

/**
 * Le corps du catalogue qu'une cible PDS désigne, ou `null`. Deux règles, et un accord de classe
 * exigé dans les deux cas : sans lui, un astéroïde homonyme d'une lune s'apparierait à elle.
 */
function bodyFor(lid, type, bodies, sbdb) {
  const segment = String(lid).split(':').pop().split('.').pop();
  const candidates = [segment];
  // Le segment COMMENCE par la désignation SBDB déclarée, suivie d'un tiret bas : le PDS écrit
  // `486958_2014_mu69` pour Arrokoth et `9p_tempel_1` pour Tempel 1, jamais l'identifiant du
  // registre. Le tiret bas exigé empêche `21_` (Lutetia) de prendre `21p_` (Giacobini-Zinner),
  // et l'accord de classe ci-dessous reste la seconde barrière.
  for (const [body, designation] of Object.entries(sbdb))
    if (segment.startsWith(`${designation.toLowerCase()}_`))
      candidates.push(body);
  for (const candidate of candidates) {
    if (!bodies.has(candidate)) continue;
    const declared = bodies.get(candidate);
    const published = asTargetClass(type);
    // UN SATELLITE D'ASTÉROÏDE est publié « Asteroid » sous un identifiant `satellite.` :
    // `satellite.65803_didymos.dimorphos` (2026-10-04). On n'accepte CETTE paire que sous ce
    // segment, et un astéroïde homonyme d'une lune (`asteroid.106_dione`) reste refusé.
    const satelliteOfAsteroid =
      declared === 'satellite' &&
      published === 'asteroid' &&
      String(lid).includes(':target:satellite.');
    if (published !== declared && !satelliteOfAsteroid)
      throw new Error(
        `désaccord de classe sur ${lid} : le PDS publie « ${type} » (${published}) et ` +
          `la fiche ${candidate} déclare « ${declared} ». Un appariement sur le seul nom ` +
          `poserait la mission sur le mauvais corps : on s'arrête.`
      );
    return candidate;
  }
  return null;
}

const bodies = catalogueBodies();
const sbdb = sbdbDesignations();
const { rows, retrieved } = await investigations();

/** Toutes les cibles citées, lues UNE fois chacune. */
const targetLids = new Set();
for (const row of rows)
  for (const lid of row.properties.ref_lid_target ?? [])
    if (lid && lid !== 'null') targetLids.add(lid);

const targets = new Map();
for (const lid of [...targetLids].sort()) targets.set(lid, await target(lid));

/**
 * LE REGISTRE REND DEUX FOIS LA MÊME INVESTIGATION, et il faut le savoir : mesuré le 2026-09-30,
 * `urn:esa:psa:context:investigation:mission.venus_express` arrive en DEUX lignes, sous le même
 * `lidvid` `::1.1`, l'une portant la sentinelle `3000-01-01` comme fin et l'autre `null`. Le
 * registre se contredit donc lui-même sur un produit dont il annonce une seule version, et
 * `summary.hits` a rendu 113 puis 112 à une heure d'intervalle pour le même contenu.
 *
 * Deux lignes d'un même identifiant sont donc fusionnées, mais SEULEMENT si elles disent la même
 * chose une fois normalisée — et ici c'est le cas, puisque les deux formes de « pas de fin
 * déclarée » se réécrivent `null`. Un désaccord réel ferait ÉCHOUER : choisir entre deux versions
 * qui divergent serait arbitraire, et l'arbitraire n'a pas sa place dans un chiffre publié.
 */
const declared = new Map();
const duplicates = [];
const sentinels = [];
const startSentinels = [];
for (const row of rows) {
  const props = row.properties;
  const mission = {
    name: one(props['pds:Investigation.pds:name']),
    lid: one(props.lid),
    start: day(props['pds:Investigation.pds:start_date']),
    end: day(props['pds:Investigation.pds:stop_date']),
    targets: [...new Set(props.ref_lid_target ?? [])]
      .filter((lid) => lid && lid !== 'null')
      .sort(),
  };
  if (mission.end === NO_END_SENTINEL) {
    sentinels.push(mission.name);
    mission.end = null;
  }
  // Le champ doit être PRÉSENT (contrôlé juste après) ; sa sentinelle, elle, devient `null`.
  const startSentinel = mission.start === NO_START_SENTINEL;
  if (!mission.name || !mission.lid)
    throw new Error(
      `investigation sans nom ni identifiant : ${JSON.stringify(props)}`
    );
  // Les 113 missions déclarent toutes un début (mesuré le 2026-09-30). `core/missions.ts` compte
  // donc sur ce champ : si la source cesse de le publier, ce lot doit ÉCHOUER, pas livrer un
  // enregistrement dont l'état à une date serait indécidable.
  if (startSentinel) {
    startSentinels.push(mission.name);
    mission.start = null;
  } else if (!mission.start)
    throw new Error(
      `« ${mission.name} » ne déclare pas de début. Les 113 missions en déclaraient un le ` +
        `2026-09-30 : la source a changé, et core/missions.ts suppose ce champ présent.`
    );
  const already = declared.get(mission.lid);
  if (already) {
    const before = JSON.stringify(already);
    const now = JSON.stringify(mission);
    if (before !== now)
      throw new Error(
        `le registre rend DEUX lignes divergentes pour ${mission.lid} :
  ${before}
  ${now}
` +
          `Choisir entre elles serait arbitraire. On s'arrête plutôt que de publier un chiffre ` +
          `qui dépend de l'ordre des lignes.`
      );
    duplicates.push(mission.lid);
    continue;
  }
  declared.set(mission.lid, mission);
}

/** L'appariement, et ce qu'il laisse dehors. */
const byBody = new Map([...bodies.keys()].map((body) => [body, []]));
const unmatched = new Map();
for (const mission of declared.values()) {
  const { targets: lids, ...record } = mission;
  for (const lid of lids) {
    const { type } = targets.get(lid);
    const body = bodyFor(lid, type, bodies, sbdb);
    if (body) byBody.get(body).push(record);
    else {
      const group = type ?? 'sans type publié';
      if (!unmatched.has(group)) unmatched.set(group, new Set());
      unmatched.get(group).add(lid);
    }
  }
}

/** Une mission peut citer deux cibles d'un même corps : on ne la compte qu'une fois. */
for (const [body, list] of byBody) {
  const seen = new Map();
  for (const mission of list)
    if (!seen.has(mission.lid)) seen.set(mission.lid, mission);
  byBody.set(
    body,
    [...seen.values()].sort(
      (a, b) =>
        String(a.start).localeCompare(String(b.start)) ||
        a.name.localeCompare(b.name)
    )
  );
}

mkdirSync(OUT, { recursive: true });
const drifted = [];
const index = { provider: {}, retrieved, missions: declared.size, bodies: {} };
let covered = 0;
for (const body of [...byBody.keys()].sort()) {
  const list = byBody.get(body);
  index.bodies[body] = { count: list.length, bytes: 0 };
  if (list.length === 0) continue;
  covered += 1;
  const json = JSON.stringify(list);
  index.bodies[body].bytes = Buffer.byteLength(json);
  const path = join(OUT, `${body}.json`);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (check) {
    if (before !== json) drifted.push(body);
  } else if (before !== json) writeFileSync(path, json);
}

/**
 * LA PROVENANCE VOYAGE AVEC LA DONNÉE, comme pour le répertoire des noms : le registre des
 * fournisseurs décrit les sources des FAITS affichés par corps, et refuse une fiche que rien ne
 * cite. Les conditions de réutilisation sont celles que le PDS DÉCLARE, lues à sa page de
 * politique d'usage, jamais formulées par nous.
 */
/**
 * LES AGENCES FÉDÉRÉES SE DÉRIVENT des identifiants livrés, elles ne se recopient pas. J'avais
 * écrit « nasa, esa, jaxa » à la main : la garde a trouvé CINQ espaces de noms, l'ISRO
 * (Chandrayaan-1) et le KARI (Korea Pathfinder Lunar Orbiter) en plus. Une liste tenue à la main
 * est une liste qui pourrit, et c'est exactement ce que ce dépôt refuse.
 */
const federates = [
  ...new Set(
    [...byBody.values()]
      .flat()
      .map((m) => m.lid.split(':').slice(0, 3).join(':'))
  ),
].sort();

index.provider = {
  publisher: 'NASA Planetary Data System',
  title: 'PDS Registry, context products',
  url: 'https://pds.nasa.gov/',
  api: `${CONTEXT}?q=pds:Investigation.pds:type eq "Mission"`,
  federates,
  /**
   * AUCUNE MENTION DE LICENCE N'EST REVENDIQUÉE ICI, et c'est une décision, pas un oubli.
   *
   * J'avais d'abord écrit `rights: 'public-domain'` en pointant la page de citation du PDS. Je
   * l'ai ensuite LUE : elle ne dit rien de tel. Elle donne des consignes de citation, aux
   * fournisseurs comme aux réutilisateurs, et rien d'autre. Les pages de politique du site
   * (`/home/policies/`, `/about/`, `/home/faq/`) rendent 404, et le lien « Privacy / Copyright »
   * de son pied de page mène à la page de confidentialité de la NASA, qui ne traite pas de la
   * réutilisation des données. Mesuré le 2026-09-30.
   *
   * On publie donc ce qu'on peut POINTER — la page de citation — et pas une licence devinée.
   * C'est la même règle que pour un fait : une source ou une raison écrite, jamais les deux.
   */
  citingGuidance: 'https://pds.nasa.gov/datastandards/citing/',
  citation:
    'NASA Planetary Data System. "PDS Registry, investigation context products." https://pds.nasa.gov/',
};
const indexJson = JSON.stringify(index, null, 1);
if (check) {
  if (!existsSync(INDEX) || readFileSync(INDEX, 'utf8') !== indexJson)
    drifted.push('index');
} else writeFileSync(INDEX, indexJson);

/**
 * LE CATALOGUE DES PAGES : chaque mission, ses cibles TELLES QUE L'ARCHIVE LES DÉCLARE (celles du
 * catalogue de Galaxy sont nommées par leur corps, les autres par leur nom et leur type publiés),
 * et sa description. Le chemin de la page vient du segment terminal de l'identifiant, qui est
 * stable par construction (c'est l'identifiant logique du produit) ; deux missions qui
 * produiraient le même chemin font ÉCHOUER.
 */
const described = await descriptions();
const slugs = new Map();
const catalogue = [];
for (const mission of [...declared.values()].sort((a, b) =>
  a.lid.localeCompare(b.lid)
)) {
  const segment = mission.lid.split(':').pop();
  if (!segment.startsWith('mission.'))
    throw new Error(`identifiant de mission inattendu : ${mission.lid}`);
  const slug = segment.slice('mission.'.length).replace(/_/g, '-');
  if (!/^[a-z0-9-]+$/.test(slug))
    throw new Error(
      `chemin de page illisible pour ${mission.lid} : « ${slug} »`
    );
  if (slugs.has(slug))
    throw new Error(
      `deux missions donneraient la même page /missions/${slug}/ : ${slugs.get(slug)} et ${mission.lid}`
    );
  slugs.set(slug, mission.lid);
  const description = described.byLid.get(mission.lid);
  if (!description)
    throw new Error(
      `« ${mission.name} » ne publie pas de description (${mission.lid}). Les 112 en ` +
        `publiaient une le 2026-10-04 : la source a changé, et une page vide ne se publie pas.`
    );
  catalogue.push({
    slug,
    name: mission.name,
    lid: mission.lid,
    start: mission.start,
    end: mission.end,
    description,
    targets: mission.targets.map((lid) => {
      const { name, type } = targets.get(lid);
      return {
        lid,
        name,
        type,
        body: bodyFor(lid, type, bodies, sbdb),
      };
    }),
  });
}
const catalogueJson = `${JSON.stringify(
  {
    retrieved,
    descriptionsRetrieved: described.retrieved,
    missions: catalogue,
  },
  null,
  1
)}
`;
if (check) {
  if (
    !existsSync(CATALOGUE) ||
    readFileSync(CATALOGUE, 'utf8') !== catalogueJson
  )
    drifted.push('catalogue des pages');
} else writeFileSync(CATALOGUE, catalogueJson);

const withNone = [...byBody.entries()]
  .filter(([, l]) => l.length === 0)
  .map(([b]) => b);
console.log(
  [...byBody.entries()]
    .filter(([, l]) => l.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .map(
      ([body, l]) =>
        `${body.padEnd(12)} ${String(l.length).padStart(3)} missions`
    )
    .join('\n')
);
console.log(
  `\n${declared.size} missions distinctes lues le ${retrieved} ` +
    `(${rows.length} lignes rendues), ${covered} corps sur ${bodies.size} couverts.`
);
if (duplicates.length > 0)
  console.log(
    `Lignes en DOUBLE fusionnées, identiques après normalisation : ${duplicates.join(', ')}.`
  );
console.log(
  `Aucune mission déclarée pour ${withNone.length} corps : ${withNone.join(', ')}.`
);
console.log(
  `Sentinelle ${NO_END_SENTINEL} réécrite « fin non déclarée » pour ${sentinels.length} missions : ` +
    `${sentinels.join(', ')}.`
);
console.log(
  `Sentinelle ${NO_START_SENTINEL} réécrite « début non déclaré » pour ${startSentinels.length} ` +
    `mission(s) : ${startSentinels.join(', ')}.`
);
console.log('\nCibles hors catalogue, par type publié :');
for (const [type, lids] of [...unmatched.entries()].sort(
  (a, b) => b[1].size - a[1].size
))
  console.log(
    `  ${String(type).padEnd(22)} ${String(lids.size).padStart(3)}  ` +
      `${[...lids]
        .map((l) => l.split(':').pop())
        .sort()
        .slice(0, 4)
        .join(', ')}` +
      `${lids.size > 4 ? ', …' : ''}`
  );

if (check && drifted.length > 0) {
  console.error(
    `\nA DÉRIVÉ de la source : ${drifted.join(', ')}. Relancer sans --check.`
  );
  process.exit(1);
}
if (check) console.log("\nrien n'a dérivé");
