#!/usr/bin/env node
/* global Buffer, console, fetch, process */
/**
 * LES PLUIES DE MÉTÉORES : radiants des pluies annuelles établies, instantané de l'IAU Meteor Data Center.
 *
 *   pnpm meteors:generate                # lit le cache .cache/meteors/ sinon télécharge
 *   pnpm meteors:generate -- --refresh   # télécharge de nouveau (un acte délibéré)
 *   pnpm meteors:generate -- --check     # code 1 si le fichier livré n'est plus celui que le cache produit
 *
 * SOURCE. IAU Meteor Data Center (Astronomical Institute of the Slovak Academy of Sciences),
 * `Etc/streamestablisheddata2026.txt`, « Established meteor showers », dernière mise à jour déclarée
 * par le fichier : 23 octobre 2026. Lu le 2026-11-03. Aucun texte de licence n'est publié sur les pages
 * lues ; le fichier demande de citer Jenniskens et al. (2020, Planetary and Space Science 182, 104821)
 * et Jopek et Kanuchova (2017, Planetary and Space Science 143, 3-6), ce que l'application affiche
 * (aide, /sources, notices tierces). L'empreinte SHA-256 du fichier lu est scellée dans le résultat.
 *
 * SÉLECTION (une règle, écrite ici et dite à l'utilisateur) :
 *   1. le fichier contient plusieurs SOLUTIONS par pluie (une ligne par jeu de paramètres, `AdNo`) ;
 *   2. une pluie est retenue si au moins une de ses solutions est marquée « annual » (la source ne
 *      dit « annual » que d'une activité qui revient chaque année : une pluie épisodique n'est pas
 *      dessinée à date fixe) ;
 *   3. sa solution retenue est celle de plus grand `AdNo` (la plus récemment ajoutée) QUI porte tout
 *      ce qu'il faut pour la placer ET la dater : début et fin d'activité (longitude solaire),
 *      longitude solaire moyenne DANS cette fenêtre, radiant (RA, Dec), vitesse géocentrique. Rien n'est inventé : une
 *      pluie sans aucune solution complète serait écartée, et comptée.
 *
 * FORME. Un tableau par pluie, dans l'ordre de `fields`. Radiant J2000 en degrés, à la longitude
 * solaire moyenne `los` ; sa dérive `dRa`/`dDe` est en degrés PAR JOUR (source) ; une dérive absente
 * est `null`, jamais 0 (le radiant ne bouge alors pas, et le fichier le dit).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const URL_SRC =
  'https://www.ta3.sk/IAUC22DB/MDC2022/Etc/streamestablisheddata2026.txt';
const CACHE_DIR = '.cache/meteors';
const CACHE = `${CACHE_DIR}/streamestablisheddata2026.txt`;
const OUT = 'public/assets/sky/meteors.json';
/** Planchers : la sélection n'a jamais compté moins (776 lignes, 170 pluies le 2026-11-03). */
const MIN_ROWS = 700;
const MIN_SHOWERS = 150;

async function load() {
  if (process.argv.includes('--refresh') || !existsSync(CACHE)) {
    const res = await fetch(URL_SRC);
    if (!res.ok) throw new Error(`HTTP ${res.status} pour ${URL_SRC}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE, bytes);
    return bytes;
  }
  return readFileSync(CACHE);
}

const bytes = await load();
// Le fichier est en Latin-1 (l'en-tête cite des noms accentués) ; les noms de pluies sont ASCII.
const lines = bytes.toString('latin1').split(/\r?\n/);

const header = lines.find((l) => /^:\s+LP\s+IAUNo/.test(l));
if (!header) throw new Error("ligne d'en-tête des colonnes introuvable");
const names = header
  .replace(/^:/, '')
  .trim()
  .split(/\s+/)
  .filter((n) => n !== '');
const COLS = [
  'LP',
  'IAUNo',
  'AdNo',
  'Code',
  's',
  'sub.date',
  'shower',
  'activity',
  'LoSb',
  'LoSe',
  'LoS',
  'Ra',
  'De',
  'dRa',
  'dDe',
  'Vg',
];
// « shower name-designation » s'écrit en trois mots dans l'en-tête : on ne compare que ce dont on dépend.
const i = Object.fromEntries(COLS.map((n, k) => [n, k]));
for (const n of [
  'LP',
  'IAUNo',
  'AdNo',
  'Code',
  'activity',
  'Ra',
  'De',
  'dRa',
  'dDe',
  'Vg',
  'LoSb',
])
  if (!names.includes(n))
    throw new Error(`colonne absente « ${n} » de l'en-tête`);

const rows = lines
  .filter((l) => l.startsWith('"'))
  .map((l) =>
    l
      .replace(/^"|"\s*$/g, '')
      .split('"|"')
      .map((s) => s.trim())
  );
if (rows.length < MIN_ROWS)
  throw new Error(`${rows.length} lignes, moins que le plancher ${MIN_ROWS}`);
const width = rows[0].length;
rows.forEach((r, n) => {
  if (r.length !== width)
    throw new Error(`ligne ${n + 1} : ${r.length} champs au lieu de ${width}`);
});

const num = (s) => {
  if (s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

const byShower = new Map();
for (const r of rows) {
  const k = r[i.IAUNo];
  if (!byShower.has(k)) byShower.set(k, []);
  byShower.get(k).push(r);
}

const inWindow = (lon, b, e) => {
  const mod = (x) => ((x % 360) + 360) % 360;
  const [l, lb, le] = [mod(lon), mod(b), mod(e)];
  return lb <= le ? l >= lb && l <= le : l >= lb || l <= le;
};
/**
 * Une solution est utilisable si elle porte tout, ET si sa longitude solaire moyenne tombe dans sa
 * propre fenêtre d'activité : une solution qui se contredit (mesuré le 2026-11-03 sur les
 * Southern Librids-Lupids, dont la moyenne sort de la fenêtre) ne saurait ni placer ni dater.
 */
const complete = (r) =>
  ['LoSb', 'LoSe', 'LoS', 'Ra', 'De', 'Vg'].every(
    (c) => num(r[i[c]]) !== null
  ) && inWindow(num(r[i.LoS]), num(r[i.LoSb]), num(r[i.LoSe]));

const showers = [];
const dropped = { notAnnual: [], noCompleteSolution: [] };
for (const [id, solutions] of byShower) {
  const label = `${solutions[0][i.Code]} (${solutions[0][i.shower]})`;
  if (!solutions.some((r) => r[i.activity] === 'annual')) {
    dropped.notAnnual.push(label);
    continue;
  }
  const chosen = solutions
    .filter(complete)
    .sort((a, b) => Number(b[i.AdNo]) - Number(a[i.AdNo]))[0];
  if (!chosen) {
    dropped.noCompleteSolution.push(label);
    continue;
  }
  const name = chosen[i.shower];
  if (!/^[\x20-\x7e]+$/.test(name))
    throw new Error(`nom non ASCII « ${name} »`);
  showers.push([
    Number(id),
    chosen[i.Code],
    name,
    round(num(chosen[i.LoSb]), 2),
    round(num(chosen[i.LoSe]), 2),
    round(num(chosen[i.LoS]), 2),
    round(num(chosen[i.Ra]), 2),
    round(num(chosen[i.De]), 2),
    num(chosen[i.dRa]) === null ? null : round(num(chosen[i.dRa]), 3),
    num(chosen[i.dDe]) === null ? null : round(num(chosen[i.dDe]), 3),
    round(num(chosen[i.Vg]), 1),
    Number(chosen[i.AdNo]),
  ]);
}
showers.sort((a, b) => a[2].localeCompare(b[2]));
if (showers.length < MIN_SHOWERS)
  throw new Error(
    `${showers.length} pluies, moins que le plancher ${MIN_SHOWERS}`
  );

/**
 * TÉMOINS, indépendants de la règle de choix : les pics des trois grandes pluies tombent aux
 * longitudes solaires que tout observateur connaît (Perséides vers le 12 août, λ☉ ≈ 140° ; Géminides
 * vers le 14 décembre, ≈ 262° ; Quadrantides vers le 3 janvier, ≈ 283°), et leur radiant dans la
 * constellation qui leur donne leur nom. Une règle qui prendrait la mauvaise ligne ferait échouer ici.
 */
const witness = (code, los, ra, de) => {
  const s = showers.find((x) => x[1] === code);
  if (!s) throw new Error(`témoin ${code} absent de la sélection`);
  if (Math.abs(s[5] - los) > 1.5)
    throw new Error(`témoin ${code} : λ☉ ${s[5]} au lieu de ~${los}`);
  if (Math.abs(s[6] - ra) > 3 || Math.abs(s[7] - de) > 3)
    throw new Error(
      `témoin ${code} : radiant ${s[6]}, ${s[7]} au lieu de ~${ra}, ${de}`
    );
  if (!(s[3] <= s[5] && s[5] <= s[4]))
    throw new Error(`témoin ${code} : le pic sort de sa fenêtre d'activité`);
};
witness('PER', 140, 48, 58);
witness('GEM', 262, 113, 32);
witness('QUA', 283, 230, 50);

const out = {
  source: {
    id: 'iau-mdc',
    name: 'IAU Meteor Data Center, established meteor showers',
    url: 'https://www.ta3.sk/IAUC22DB/MDC2022/index.php',
    file: URL_SRC,
    retrieved: '2026-11-03',
    updated: '2026-10-23',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    rows: rows.length,
    cite: [
      'Jenniskens, P.; Jopek, T.J.; Janches, D.; Hajdukova, M.; Kokhirova, G.I.; Rudawska, R., 2020, Planetary and Space Science, 182, 104821',
      'Jopek, T.J.; Kanuchova, Z., 2017, Planetary and Space Science, 143, 3-6',
    ],
  },
  fields: [
    'iauNo',
    'code',
    'name',
    'sunLonBegin',
    'sunLonEnd',
    'sunLonMean',
    'raDeg',
    'decDeg',
    'raDriftDegPerDay',
    'decDriftDegPerDay',
    'vgKmS',
    'solution',
  ],
  count: showers.length,
  dropped: {
    notAnnual: dropped.notAnnual.length,
    noCompleteSolution: dropped.noCompleteSolution.length,
  },
  showers,
};
const json = JSON.stringify(out) + '\n';
if (process.argv.includes('--check')) {
  const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === json;
  console.log(same ? 'à jour' : 'DÉRIVE : relancer pnpm meteors:generate');
  process.exit(same ? 0 : 1);
}
mkdirSync('public/assets/sky', { recursive: true });
writeFileSync(OUT, json);
console.log(
  `${showers.length} pluies sur ${byShower.size} (écartées : ${dropped.notAnnual.length} non annuelles [${dropped.notAnnual.join(', ')}], ${dropped.noCompleteSolution.length} sans solution complète), ${json.length} o`
);
