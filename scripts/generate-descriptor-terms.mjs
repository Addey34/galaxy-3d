/* global console, fetch, process */
/**
 * LES TERMES DESCRIPTEURS DE L'UAI (lot 55) : ce que veut dire « Mons », « Planitia » ou « Catena »,
 * lu à la seule autorité qui le définit, la page « Descriptor Terms » du Gazetteer of Planetary
 * Nomenclature. Les pages des grands lieux citent ces définitions EN ANGLAIS, mot pour mot, avec
 * leur source et leur date de lecture : aucune traduction n'est inventée ici, comme pour les
 * descriptions du PDS sur les pages des missions.
 *
 * Écrit `src/seo/descriptorTerms.json` (build seulement) : pour chaque terme, le libellé exact que
 * porte le champ `type` du gazetteer (« Crater, craters ») et sa définition. La date de lecture
 * appartient à la RÉPONSE (`scripts/fact-source-cache.mjs`), pas à l'exécution.
 *
 *   node scripts/generate-descriptor-terms.mjs [--offline] [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampNow, stampOf } from './fact-source-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://planetarynames.wr.usgs.gov/DescriptorTerms';
const CACHE = join(ROOT, '.cache', 'iau-descriptor-terms');
const OUT = join(ROOT, 'src', 'seo', 'descriptorTerms.json');
const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const CHECK = args.includes('--check');

const decode = (text) =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

async function page() {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, 'descriptor-terms.html');
  if (!existsSync(path)) {
    if (OFFLINE) throw new Error(`hors ligne et rien en cache : ${path}`);
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`${SOURCE} : HTTP ${res.status}`);
    const body = await res.text();
    // TÉMOIN : une page d'erreur servie en 200 n'aurait pas ce titre de colonne.
    if (!body.includes('Feature (Designation)'))
      throw new Error(
        `${SOURCE} : la table des termes est absente de la réponse`
      );
    writeFileSync(path, body);
    stampNow(path);
  }
  return { html: readFileSync(path, 'utf8'), retrieved: stampOf(path) };
}

const { html, retrieved } = await page();
const terms = [];
for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
  // La source ouvre la première cellule par `<th scope="row">` et la ferme par `</td>` :
  // les deux balises sont acceptées, sans quoi aucune ligne n'est lue.
  const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) =>
    decode(m[1])
  );
  if (cells.length < 2) continue;
  // « Crater, craters AA » : le libellé du gazetteer, puis la désignation à deux lettres.
  const match = /^(.*\S)\s+([A-Z]{2})$/.exec(cells[0]);
  if (!match || !cells[1]) continue;
  terms.push({ label: match[1], code: match[2], definition: cells[1] });
}
if (terms.length < 40)
  throw new Error(
    `${terms.length} termes seulement : la page a changé de forme`
  );

const record = {
  generatedBy: 'scripts/generate-descriptor-terms.mjs',
  source: SOURCE,
  retrieved,
  terms: terms.sort((a, b) => a.label.localeCompare(b.label, 'en')),
};
const text = `${JSON.stringify(record, null, 2)}\n`;
if (CHECK) {
  const shipped = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (shipped !== text) {
    console.error(`${OUT} a dérivé de sa source`);
    process.exit(1);
  }
  console.log(`termes descripteurs à jour (${terms.length})`);
} else {
  writeFileSync(OUT, text);
  console.log(
    `${terms.length} termes descripteurs, lus le ${retrieved} → ${OUT}`
  );
}
