#!/usr/bin/env node
/* global console, process */
/**
 * Publie au manifeste le facteur de BALLANT d'un primaire dont les masses ne le donnent pas
 * (cf. `src/core/reflexFactor.ts`) : Patrocle, dont aucune répartition de la masse du couple
 * n'est publiée, mais dont Horizons sert le primaire et le compagnon.
 *
 * La règle (quels corps, sur quel intervalle, à quel seuil) et la formule ne sont PAS recopiées :
 * `reflexDecisions` est importée de `src/core/reflexFactor.ts` par `ssrLoadModule`, comme
 * `compute-mean-motion-scale.mjs` importe la sienne, et sa garde (`reflexFactor.test.ts`)
 * appelle la même. Aucun binaire n'est régénéré.
 *
 *   node scripts/compute-reflex-factor.mjs            réécrit le manifeste
 *   node scripts/compute-reflex-factor.mjs --check    ne touche à rien, code 1 si écart
 */
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'public/assets/ephemerides/manifest.json');
const EPHEMERIDES_DIR = join(ROOT, 'public/assets/ephemerides');
const checkOnly = process.argv.includes('--check');

const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': join(ROOT, 'src') } },
});
const load = (path) => loader.ssrLoadModule(path);
const { reflexDecisions, publishedFactor } = await load(
  '/src/core/reflexFactor.ts'
);
const { REFLEX_MIN_MASS_RATIO } = await load('/src/config/gravity.ts');

const original = await readFile(MANIFEST_PATH, 'utf8');
const manifest = JSON.parse(original);

const cache = new Map();
function samplesOf(name) {
  if (!cache.has(name)) {
    const entry = manifest.bodies[name];
    const file = readFileSync(join(EPHEMERIDES_DIR, entry.file));
    const samples = new Float64Array(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    );
    if (samples.length !== entry.sampleCount * 6)
      throw new Error(`${name} : le manifeste et le fichier ont divergé`);
    cache.set(name, samples);
  }
  return cache.get(name);
}

const km = (au) => `${(au * 149_597_870.7).toFixed(2)} km`;
const changed = [];
for (const [name, entry] of Object.entries(manifest.bodies)) {
  let published;
  for (const decision of reflexDecisions(
    name,
    manifest.bodies,
    samplesOf,
    REFLEX_MIN_MASS_RATIO
  )) {
    const { fit } = decision;
    console.log(
      `${name} / ${decision.companion} : f = ${fit.factor.toFixed(5)}, rugosité ${km(fit.roughnessBefore)} -> ${km(fit.roughnessAfter)} : ${decision.published ? 'publié' : 'non publié'}`
    );
    if (decision.published)
      published = {
        companion: decision.companion,
        factor: publishedFactor(fit.factor),
      };
  }
  const before = JSON.stringify(entry.reflex);
  if (published) entry.reflex = published;
  else delete entry.reflex;
  if (JSON.stringify(entry.reflex) !== before)
    changed.push(
      `${name} : ${before ?? 'absent'} -> ${JSON.stringify(entry.reflex) ?? 'absent'}`
    );
}

const updated = `${JSON.stringify(manifest, null, 2)}\n`;
await loader.close();

if (checkOnly) {
  if (updated !== original) {
    console.error(
      'Le manifeste ne porte pas les facteurs de ballant que les binaires donnent :'
    );
    for (const line of changed) console.error(`  ${line}`);
    console.error('Lance : pnpm ephemeris:reflex');
    process.exit(1);
  }
  console.log('Manifeste à jour.');
  process.exit(0);
}
if (updated === original) console.log('Manifeste déjà à jour, rien à écrire.');
else {
  await writeFile(MANIFEST_PATH, updated);
  console.log(`Manifeste réécrit, ${changed.length} entrée(s) :`);
  for (const line of changed) console.log(`  ${line}`);
}
