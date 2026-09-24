#!/usr/bin/env node
/* global console, process */
/**
 * Publie au manifeste le facteur d'échelle du temps de propagation de chaque corps qui le
 * déclare (`MEAN_MOTION_PROPAGATION`, cf. `src/config/gravity.ts`).
 *
 * POURQUOI ce script existe : ce facteur est la médiane, sur le FICHIER ENTIER, du rapport
 * période osculatrice sur période du catalogue. Tant que le navigateur téléchargeait les 64
 * binaires complets, le service pouvait le recalculer lui-même. Le lot 17 ne lui envoie plus
 * qu'une FENÊTRE : la même formule y rend un autre nombre, donc une autre position, sans la
 * moindre erreur (mesuré sur Encelade : 27 mètres). Le facteur est donc calculé une fois ici
 * et publié, décision D5 de `docs/private/EPHEMERIDES_LOT17.md`.
 *
 * La formule n'est PAS recopiée : elle est importée de `src/core/meanMotionScale.ts`, par
 * `ssrLoadModule` de Vite, comme `scripts/validate-against-horizons.mjs` charge le code de
 * l'application. Une copie aurait dérivé du lecteur, et c'est exactement le genre d'écart que
 * personne ne voit.
 *
 * Aucun binaire n'est régénéré, aucun hachage de fichier ne change : seul le manifeste gagne
 * un champ.
 *
 *   node scripts/compute-mean-motion-scale.mjs            réécrit le manifeste
 *   node scripts/compute-mean-motion-scale.mjs --check     ne touche à rien, code 1 si écart
 */
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

const { CELESTIAL_CONFIG } = await load('/src/config/bodies.ts');
const { bodyDynamics } = await load('/src/config/gravity.ts');
const { medianMeanMotionScale } = await load('/src/core/meanMotionScale.ts');

const dynamics = bodyDynamics(CELESTIAL_CONFIG);
const original = await readFile(MANIFEST_PATH, 'utf8');
const manifest = JSON.parse(original);

const changed = [];
for (const [name, entry] of Object.entries(manifest.bodies)) {
  const body = dynamics[name];
  const declares =
    body?.meanMotionPropagation === true && body.periodDays !== undefined;

  if (!declares) {
    // Un corps qui ne déclare plus la propagation au rythme moyen ne garde pas son facteur :
    // un champ orphelin finirait par être lu par quelqu'un.
    if (entry.meanMotionScale !== undefined) {
      delete entry.meanMotionScale;
      changed.push(
        `${name} : facteur retiré (ne déclare plus meanMotionPropagation)`
      );
    }
    continue;
  }

  const file = await readFile(join(EPHEMERIDES_DIR, entry.file));
  const samples = new Float64Array(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  );
  const expectedLength = entry.sampleCount * 6;
  if (samples.length !== expectedLength) {
    throw new Error(
      `${name} : ${samples.length} flottants pour ${expectedLength} attendus ; le manifeste et le fichier ont divergé`
    );
  }
  const scale = medianMeanMotionScale(
    samples,
    entry.sampleCount,
    body.mu,
    body.periodDays
  );
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`${name} : facteur non exploitable (${scale})`);
  }
  if (entry.meanMotionScale !== scale) {
    const before = entry.meanMotionScale;
    entry.meanMotionScale = scale;
    changed.push(
      `${name} : ${before === undefined ? 'absent' : before} -> ${scale}`
    );
  }
}

const updated = `${JSON.stringify(manifest, null, 2)}\n`;
await loader.close();

if (checkOnly) {
  if (updated !== original) {
    console.error(
      'Le manifeste ne porte pas les facteurs que les binaires donnent :'
    );
    for (const line of changed) console.error(`  ${line}`);
    console.error('Lance : node scripts/compute-mean-motion-scale.mjs');
    process.exit(1);
  }
  const published = Object.entries(manifest.bodies).filter(
    ([, entry]) => entry.meanMotionScale !== undefined
  );
  console.log(
    `Manifeste à jour : ${published.length} corps publient leur facteur d'échelle.`
  );
  process.exit(0);
}

if (updated === original) {
  console.log('Manifeste déjà à jour, rien à écrire.');
} else {
  await writeFile(MANIFEST_PATH, updated);
  console.log(`Manifeste réécrit, ${changed.length} entrée(s) :`);
  for (const line of changed) console.log(`  ${line}`);
}
