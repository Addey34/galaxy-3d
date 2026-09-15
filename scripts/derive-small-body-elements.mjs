#!/usr/bin/env node
/* global console, process, fetch, URLSearchParams, setTimeout */
/**
 * Dérive les éléments d'un petit corps DEPUIS l'API JPL Horizons en direct, à une époque
 * déclarée, et les imprime prêts à coller dans `src/config/smallBodies.ts` — avec les vecteurs
 * d'état de référence du test de régression et l'obliquité calculée depuis le pôle publié.
 *
 * Pourquoi un script. Vesta, Pallas, Hygie et Halley ont été livrés avec une anomalie moyenne
 * prise à une autre époque que celle déclarée : chaque corps était faux à TOUTES les dates, sans
 * erreur. Ces corps n'ont pas de binaire Horizons de repli, leur position dépend entièrement de
 * ces éléments. On ne les recopie donc jamais : on les demande, à l'époque exacte.
 *
 * L'obliquité aussi est DÉRIVÉE, pas recopiée : pôle (RA/Dec J2000 équatorial, convention
 * « pôle positif » = sens du moment cinétique) converti en écliptique, puis comparé à la
 * normale orbitale (i, Ω). Au-delà de 90°, le corps tourne à rebours de son orbite.
 *
 *   node scripts/derive-small-body-elements.mjs "433;" "433 Eros (A898 PA)" \
 *     --epoch 2461041.5 --pole 11.37/17.22 [--years -10,-1,0,1,10]
 *
 * Le `;` final est VOULU ici : ce sont des numéros de petits corps (cf. CLAUDE.md, piège
 * « 699; »). La cible est vérifiée par son nom exact et le script échoue sinon.
 */

const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const OBLIQUITY_J2000_DEG = 23.4392911;
const D2R = Math.PI / 180;

const [command, expectedName] = process.argv.slice(2);
const option = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const epochJd = Number(option('--epoch') ?? 2451545.0);
const pole = option('--pole')?.split('/').map(Number);
const years = (option('--years') ?? '-10,-1,0,1,10').split(',').map(Number);
if (!command || !expectedName) {
  console.error(
    'usage : node scripts/derive-small-body-elements.mjs <COMMAND> <nom attendu> [--epoch JD] [--pole RA/Dec] [--years a,b,c]'
  );
  process.exit(1);
}

async function horizons(params) {
  const query = new URLSearchParams({
    format: 'text',
    COMMAND: `'${command}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    CENTER: "'500@10'",
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'J2000',
    OUT_UNITS: 'AU-D',
    CSV_FORMAT: 'NO',
    ...params,
  });
  // Horizons renvoie parfois une panne de configuration passagère sous un HTTP 200 : on
  // réessaie quelques fois avant d'abandonner, plutôt que de parser un message d'erreur.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API_URL}?${query}`);
    const text = await response.text();
    if (response.ok && text.includes('$$SOE')) return text;
    if (attempt >= 4)
      throw new Error(`Horizons sans éphéméride :\n${text.slice(0, 800)}`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

function assertTarget(text) {
  const actual = text.match(/Target body name:\s*(.+?)\s*\{/)?.[1]?.trim();
  if (actual !== expectedName)
    throw new Error(
      `Cible inattendue : « ${actual} » au lieu de « ${expectedName} »`
    );
}

const block = (text) => text.match(/\$\$SOE([\s\S]*?)\$\$EOE/)[1];
const field = (text, key) => {
  const match = text.match(new RegExp(`\\b${key}\\s*=\\s*([-+0-9.E]+)`));
  if (!match) throw new Error(`Champ ${key} introuvable`);
  return Number(match[1]);
};
const jdToIso = (jd) =>
  new Date(Math.round((jd - 2_440_587.5) * 86_400) * 1000).toISOString();

const text = await horizons({
  EPHEM_TYPE: 'ELEMENTS',
  TLIST: `'${epochJd}'`,
});
assertTarget(text);
const el = block(text);
const elements = {
  a: field(el, 'A'),
  e: field(el, 'EC'),
  iDeg: field(el, 'IN'),
  omDeg: field(el, 'OM'),
  wDeg: field(el, 'W'),
  maDeg: field(el, 'MA'),
};
if (!(elements.e < 1 && elements.a > 0))
  throw new Error(`orbite non elliptique : ${JSON.stringify(elements)}`);

console.log(
  `    // Éléments osculateurs JPL Horizons EXACTEMENT à cette époque (COMMAND '${command}',`
);
console.log(`    // EPHEM_TYPE=ELEMENTS, TLIST=${epochJd}).`);
for (const [key, value] of Object.entries(elements))
  console.log(`    ${key}: ${value},`);
console.log(`    epoch: '${jdToIso(epochJd)}',`);

if (pole) {
  // Pôle équatorial J2000 → écliptique J2000 (rotation d'obliquité autour de X).
  const [ra, dec] = pole.map((d) => d * D2R);
  const eq = [
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  ];
  const eps = OBLIQUITY_J2000_DEG * D2R;
  const ecl = [
    eq[0],
    Math.cos(eps) * eq[1] + Math.sin(eps) * eq[2],
    -Math.sin(eps) * eq[1] + Math.cos(eps) * eq[2],
  ];
  const i = elements.iDeg * D2R;
  const node = elements.omDeg * D2R;
  const normal = [
    Math.sin(i) * Math.sin(node),
    -Math.sin(i) * Math.cos(node),
    Math.cos(i),
  ];
  const dot = ecl.reduce((sum, v, k) => sum + v * normal[k], 0);
  console.log(
    `    // Obliquité DÉRIVÉE du pôle (RA ${pole[0]}°, Dec ${pole[1]}°) et de la normale orbitale :`
  );
  console.log(
    `    axialTiltDeg: ${((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI).toFixed(1)},`
  );
}

// Vecteurs d'état de référence autour de l'époque — la vérité du test de régression.
const jds = years.map((y) =>
  (Math.round(epochJd + y * 365.25 - 0.5) + 0.5).toFixed(1)
);
const vectors = await horizons({
  EPHEM_TYPE: 'VECTORS',
  VEC_TABLE: '1',
  TLIST: jds.map((jd) => `'${jd}'`).join(' '),
});
assertTarget(vectors);
console.log(`  // Vecteurs Horizons ${command} (UA, écliptique J2000) :`);
for (const [, jd, x, y, z] of block(vectors).matchAll(
  /(\d+\.\d+) = [^\n]*\n\s*X =\s*([-+0-9.E]+) Y =\s*([-+0-9.E]+) Z =\s*([-+0-9.E]+)/g
))
  console.log(
    `  ['${jdToIso(Number(jd))}', ${Number(x)}, ${Number(y)}, ${Number(z)}],`
  );
