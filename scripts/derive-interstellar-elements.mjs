#!/usr/bin/env node
/* global console, process, fetch, URLSearchParams */
/**
 * Dérive les éléments hyperboliques des objets interstellaires DEPUIS l'API JPL Horizons en
 * direct, et les imprime prêts à coller dans `src/config/interstellar.ts`.
 *
 * Pourquoi un script plutôt qu'une saisie. Les éléments d'une trajectoire ouverte se
 * trouvent partout, à des époques différentes et souvent arrondis ; or une anomalie moyenne
 * recopiée à la mauvaise époque place le corps faux à TOUTES les dates, sans erreur (c'est
 * exactement le défaut qui a été livré pour Vesta, Pallas, Hygie et Halley). On demande donc
 * à Horizons les éléments osculateurs À L'ÉPOQUE DE SA PROPRE SOLUTION (EPHEM_TYPE=ELEMENTS,
 * TLIST=époque), à pleine précision.
 *
 * Chaque cible est vérifiée par son nom : une désignation mal résolue renverrait un autre
 * objet sans le dire (cf. « 699; » → l'astéroïde 699 Hela au lieu de Saturne).
 *
 *   node scripts/derive-interstellar-elements.mjs            # éléments
 *   node scripts/derive-interstellar-elements.mjs --vectors  # + vecteurs de référence du test
 */

const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/** Décalages (années juliennes) autour du périhélie pour les vecteurs de référence. */
const REFERENCE_OFFSETS_YEARS = [-20, -5, -1, 0, 1, 5, 20];

const OBJECTS = [
  { key: 'oumuamua', command: '1I', expectedName: "1I/'Oumuamua (A/2017 U1)" },
  { key: 'borisov', command: '2I', expectedName: 'Borisov (C/2019 Q4)' },
  { key: 'atlas', command: '3I', expectedName: 'ATLAS (C/2025 N1)' },
];

async function horizons(params) {
  const query = new URLSearchParams({
    format: 'text',
    CENTER: "'500@10'",
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'J2000',
    OUT_UNITS: 'AU-D',
    CSV_FORMAT: 'NO',
    ...params,
  });
  const response = await fetch(`${API_URL}?${query}`);
  if (!response.ok) throw new Error(`Horizons HTTP ${response.status}`);
  return response.text();
}

function field(text, key) {
  const match = text.match(new RegExp(`\\b${key}\\s*=\\s*([-+0-9.E]+)`));
  if (!match) throw new Error(`Champ ${key} introuvable`);
  return Number(match[1]);
}

function block(text) {
  const match = text.match(/\$\$SOE([\s\S]*?)\$\$EOE/);
  if (!match) throw new Error(`Réponse sans $$SOE :\n${text.slice(0, 1500)}`);
  return match[1];
}

function assertTarget(text, expectedName) {
  const match = text.match(/Target body name:\s*(.+?)\s*\{/);
  const actual = match?.[1]?.trim();
  if (actual !== expectedName) {
    throw new Error(
      `Cible inattendue : « ${actual} » au lieu de « ${expectedName} »`
    );
  }
}

/** JD → ISO à la seconde (TDB lu comme UTC : 69 s d'écart, négligeable à cette échelle). */
const jdToIso = (jd) =>
  new Date(Math.round((jd - 2_440_587.5) * 86_400) * 1000).toISOString();

const withVectors = process.argv.includes('--vectors');

for (const object of OBJECTS) {
  // 1. La solution elle-même : son époque, son numéro d'enregistrement, sa date.
  const header = await horizons({
    COMMAND: `'${object.command}'`,
    OBJ_DATA: 'YES',
    MAKE_EPHEM: 'NO',
  });
  const epochJd = field(header, 'EPOCH');
  const record = header.match(/Rec #:\s*(\d+)/)?.[1];
  const solution = header.match(/Soln\.date:\s*(\S+)/)?.[1];

  // 2. Les éléments osculateurs exactement à cette époque.
  const text = await horizons({
    COMMAND: `'${object.command}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'ELEMENTS',
    TLIST: `'${epochJd}'`,
  });
  assertTarget(text, object.expectedName);
  const el = block(text);
  const e = field(el, 'EC');
  const a = field(el, 'A');
  if (!(e > 1 && a < 0)) {
    throw new Error(`${object.key} : e=${e}, a=${a} — pas une hyperbole`);
  }

  console.log(
    `  // Horizons rec #${record}, solution ${solution}, ${object.expectedName}.`
  );
  console.log(
    `  // Éléments osculateurs à l'époque de la solution (JD ${epochJd}).`
  );
  console.log(`  ${object.key}: {`);
  console.log(`    a: ${a},`);
  console.log(`    e: ${e},`);
  console.log(`    iDeg: ${field(el, 'IN')},`);
  console.log(`    omDeg: ${field(el, 'OM')},`);
  console.log(`    wDeg: ${field(el, 'W')},`);
  console.log(`    maDeg: ${field(el, 'MA')},`);
  console.log(`    epoch: '${jdToIso(epochJd)}',`);
  console.log(
    `    // Tp Horizons (contrôle, non stocké) : JD ${field(el, 'Tp')}`
  );
  console.log('  },');

  if (!withVectors) continue;

  // 3. Vecteurs d'état de référence autour du périhélie — la vérité du test de régression.
  const tp = field(el, 'Tp');
  // Minuit TDB le plus proche : des dates rondes, lisibles dans le test.
  const jds = REFERENCE_OFFSETS_YEARS.map((years) =>
    (Math.round(tp + years * 365.25 - 0.5) + 0.5).toFixed(1)
  );
  const vectors = await horizons({
    COMMAND: `'${object.command}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    VEC_TABLE: '1',
    TLIST: jds.map((jd) => `'${jd}'`).join(' '),
  });
  assertTarget(vectors, object.expectedName);
  const rows = block(vectors).matchAll(
    /(\d+\.\d+) = [^\n]*\n\s*X =\s*([-+0-9.E]+) Y =\s*([-+0-9.E]+) Z =\s*([-+0-9.E]+)/g
  );
  console.log(`  // Vecteurs Horizons ${object.key} (UA, écliptique J2000) :`);
  for (const [, jd, x, y, z] of rows) {
    const years = Math.round((Number(jd) - tp) / 365.25);
    console.log(
      `  ['${object.key}', '${jdToIso(Number(jd))}', ${Number(x)}, ${Number(y)}, ${Number(z)}], // Tp ${years < 0 ? '' : '+'}${years} an(s)`
    );
  }
}
