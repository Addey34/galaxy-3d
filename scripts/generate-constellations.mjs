#!/usr/bin/env node
/* global console, fetch, process */
/**
 * LES FIGURES DES CONSTELLATIONS, rattachées aux ÉTOILES du catalogue livré.
 *
 *   pnpm constellations:generate            # lit le cache .cache/constellations/ sinon télécharge
 *   pnpm constellations:generate -- --check # code 1 si le fichier livré n'est plus celui que ce script écrirait
 *
 * SOURCE. d3-celestial (Olaf Frohn, licence BSD-3-Clause), fichier `data/constellations.lines.json`
 * au commit ÉPINGLÉ ci-dessous : l'adresse `master` changerait sous nos pieds. Le dépôt déclare le
 * tracé issu de la page des constellations de l'UAI, avec « some line modifications » de son auteur :
 * ce n'est donc PAS le tracé officiel de l'UAI (l'UAI ne définit que les frontières), et
 * `/sources` le dit. Les noms sont les noms UAI du fichier `constellations.json` (commit épinglé),
 * en latin : les traductions de ce fichier viennent de Wikipédia (CC BY-SA), elles ne sont pas reprises.
 *
 * FORME. Chaque sommet d'une ligne est un point (ascension droite, déclinaison) J2000. On le rattache
 * à l'étoile de `public/assets/sky/stars.json` la plus proche, et on garde l'INDICE de l'étoile :
 * une figure est donc une liste d'étoiles, et elle SE DÉFORME avec leurs mouvements propres quand la
 * date change (`Starfield.setDate`). Un sommet à plus de MAX_SEPARATION_DEG d'une étoile fait ÉCHOUER
 * le script : il tracerait une ligne vers un point où il n'y a rien. Le fichier porte l'empreinte du
 * catalogue d'étoiles (les indices n'ont de sens que pour lui) : régénérer les étoiles oblige à
 * régénérer ceci.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const REPO = 'ofrohn/d3-celestial';
const LINES_SHA = 'd2e20e104b86429d90ac8227a5b021262b45d75a';
const NAMES_SHA = 'b56735c22935b7bde41a944a74e0f780ca0c6dfa';
const raw = (sha, path) =>
  `https://raw.githubusercontent.com/${REPO}/${sha}/${path}`;
const SOURCES = [
  ['lines', raw(LINES_SHA, 'data/constellations.lines.json')],
  ['names', raw(NAMES_SHA, 'data/constellations.json')],
];
const CACHE_DIR = '.cache/constellations';
const STARS = 'public/assets/sky/stars.json';
const OUT = 'public/assets/sky/constellations.json';
/** Écart toléré entre un sommet et son étoile (degrés). Mesuré le 2026-11-03 : 893 sommets sur 893 à moins de 0,05°. */
const MAX_SEPARATION_DEG = 0.05;
const EXPECTED_CONSTELLATIONS = 88;
const EXPECTED_VERTICES = 893;

async function load(name, url) {
  const file = `${CACHE_DIR}/${name}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
  const json = JSON.parse(text); // refuse une page d'erreur HTML
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, text);
  return json;
}

const [lines, names] = await Promise.all(SOURCES.map(([n, u]) => load(n, u)));
const starsText = readFileSync(STARS, 'utf8');
const stars = JSON.parse(starsText).stars;
const starsSha = createHash('sha256').update(starsText).digest('hex');

const DEG = Math.PI / 180;
function nearest(raDeg, decDeg) {
  let best = Infinity;
  let index = -1;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const dDec = s[1] - decDeg;
    if (Math.abs(dDec) > 1) continue;
    let dRa = Math.abs(s[0] - raDeg);
    if (dRa > 180) dRa = 360 - dRa;
    const d = Math.hypot(dRa * Math.cos(decDeg * DEG), dDec);
    if (d < best) {
      best = d;
      index = i;
    }
  }
  return { index, d: best };
}

const nameOf = new Map(names.features.map((f) => [f.id, f.properties.name]));
const byId = new Map();
let vertices = 0;
let worst = 0;
for (const f of lines.features) {
  if (!nameOf.has(f.id))
    throw new Error(`constellation sans nom UAI : ${f.id}`);
  const out = byId.get(f.id) ?? [];
  for (const line of f.geometry.coordinates) {
    const idx = line.map(([lon, lat]) => {
      vertices++;
      const { index, d } = nearest(((lon % 360) + 360) % 360, lat);
      worst = Math.max(worst, d);
      if (d > MAX_SEPARATION_DEG)
        throw new Error(
          `${f.id} : sommet (${lon}, ${lat}) à ${d.toFixed(3)}° de l'étoile la plus proche (limite ${MAX_SEPARATION_DEG}°)`
        );
      return index;
    });
    out.push(idx);
  }
  byId.set(f.id, out);
}
if (byId.size !== EXPECTED_CONSTELLATIONS)
  throw new Error(
    `${byId.size} constellations au lieu de ${EXPECTED_CONSTELLATIONS}`
  );
if (vertices !== EXPECTED_VERTICES)
  throw new Error(
    `${vertices} sommets au lieu de ${EXPECTED_VERTICES} : source modifiée ?`
  );

const out = {
  source: {
    id: 'd3-celestial-constellation-lines',
    name: 'd3-celestial (constellation lines), Olaf Frohn',
    url: `https://github.com/${REPO}`,
    linesCommit: LINES_SHA,
    namesCommit: NAMES_SHA,
    license: 'BSD-3-Clause',
    licenseUrl: `https://github.com/${REPO}/blob/${LINES_SHA}/LICENSE`,
    retrieved: '2026-11-03',
    maxSeparationDeg: MAX_SEPARATION_DEG,
  },
  stars: { file: 'stars.json', sha256: starsSha },
  count: byId.size,
  constellations: [...byId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, ls]) => ({ id, name: nameOf.get(id), lines: ls })),
};
const json = JSON.stringify(out) + '\n';
if (process.argv.includes('--check')) {
  const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === json;
  console.log(
    same ? 'à jour' : 'DÉRIVE : relancer pnpm constellations:generate'
  );
  process.exit(same ? 0 : 1);
}
writeFileSync(OUT, json);
console.log(
  `${byId.size} constellations, ${vertices} sommets, écart maximal ${worst.toFixed(4)}°, ${json.length} o`
);
