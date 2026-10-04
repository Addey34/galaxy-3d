#!/usr/bin/env node
/* global console, process, fetch, Buffer */
/**
 * Régénère TOUS les modèles de forme livrés depuis leur source scientifique.
 *
 *   node scripts/generate-shape-models.mjs [--only <corps>[,<corps>…]]
 *
 * POURQUOI ce script existe (2026-10-04). Les maillages étaient produits par des commandes
 * lancées à la main, corps par corps, dont les options n'étaient écrites nulle part : refaire un
 * niveau supposait de les deviner, et 19 fichiers sur 24 embarquaient « source à documenter »
 * en guise de crédit. La recette est désormais une DONNÉE (`scripts/shape-model-targets.json`),
 * et ce qui appartient déjà à la fiche du corps n'y est pas recopié :
 *
 * - les NIVEAUX sont `model.resolutions` de la fiche, au budget de triangles de la recette ;
 * - la COULEUR est cuite si la fiche déclare `model.albedo` (un corps drapé d'une texture n'en
 *   déclare pas, et sa couleur est celle de la texture) ;
 * - le CRÉDIT embarqué dans le glTF est `model.credit.en`.
 *
 * Une source absente du cache est téléchargée depuis l'adresse de la recette (et lue depuis le
 * DSK quand c'en est un, `scripts/dsk-to-obj.mjs`) ; sans adresse, le script s'arrête en nommant
 * le jeu de données à aller chercher, plutôt que de livrer un maillage d'une autre origine.
 *
 * `colourFrom` (Éros, Ryugu) : la couleur par sommet d'un fichier DÉJÀ livré, lu dans git à ce
 * commit, reportée sur les nouveaux sommets (`bake-shape-colour.mjs --from`), parce que la carte
 * de mission qui l'avait produite ne se relit plus aujourd'hui.
 */
import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recipe = JSON.parse(
  readFileSync(join(ROOT, 'scripts/shape-model-targets.json'), 'utf8')
);

const onlyAt = process.argv.indexOf('--only');
const only =
  onlyAt === -1 ? null : new Set(process.argv[onlyAt + 1].split(','));

/** Le bloc `model` d'une fiche, où qu'il soit rangé. */
function modelOf(fiche) {
  if (!fiche || typeof fiche !== 'object') return null;
  if (fiche.model?.resolutions) return fiche.model;
  for (const value of Object.values(fiche)) {
    const found = modelOf(value);
    if (found) return found;
  }
  return null;
}

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  console.log(`  téléchargé ${url}`);
}

async function ensureSource(body, entry) {
  const cache = join(ROOT, entry.cache);
  if (existsSync(cache)) return cache;
  if (!entry.url)
    throw new Error(
      `${body} : ${entry.cache} absent du cache, et la recette n'a pas d'adresse directe. ` +
        `Jeu de données : ${entry.dataset}`
    );
  if (entry.dsk) {
    const dsk = join(ROOT, entry.dsk);
    if (!existsSync(dsk)) await download(entry.url, dsk);
    execFileSync('node', [join(ROOT, 'scripts/dsk-to-obj.mjs'), dsk, cache], {
      stdio: 'inherit',
    });
  } else await download(entry.url, cache);
  return cache;
}

const run = (script, args, env = {}) =>
  execFileSync('node', [join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

for (const [body, entry] of Object.entries(recipe.bodies)) {
  if (only && !only.has(body)) continue;
  const fiche = JSON.parse(
    readFileSync(join(ROOT, `src/registry/entities/${body}.json`), 'utf8')
  );
  const model = modelOf(fiche);
  if (!model) throw new Error(`${body} : la fiche ne déclare aucun modèle`);
  console.log(`\n=== ${body} : ${model.resolutions.join(', ')}`);
  const source = await ensureSource(body, entry);

  const dir = join(ROOT, 'public/assets/models', body);
  mkdirSync(dir, { recursive: true });
  // Un niveau que la fiche ne déclare plus ne reste pas sur le disque.
  for (const file of readdirSync(dir))
    if (/_shape_\w+\.glb$/.test(file)) rmSync(join(dir, file));
  for (const quality of model.resolutions) {
    const budget = recipe.budgets[quality];
    if (!budget) throw new Error(`${body} : niveau ${quality} sans budget`);
    run(
      'decimate-shape-model.mjs',
      [
        source,
        join(dir, `${body}_shape_${quality}.glb`),
        '--target',
        String(budget),
        ...entry.flags,
        // Seul le niveau le plus léger peut livrer une source entière plus petite que son budget.
        ...(budget ===
        Math.min(...model.resolutions.map((q) => recipe.budgets[q]))
          ? ['--whole']
          : []),
      ],
      { MODEL_COPYRIGHT: model.credit.en, MODEL_NAME: body }
    );
  }

  if (model.albedo === undefined) continue;
  const bakeArgs = [body, '--albedo', String(model.albedo)];
  let fromFile = null;
  if (entry.colourFrom) {
    fromFile = join(tmpdir(), `galaxy-colour-${body}.glb`);
    writeFileSync(
      fromFile,
      execFileSync('git', ['show', entry.colourFrom], {
        cwd: ROOT,
        maxBuffer: 1 << 28,
      })
    );
    bakeArgs.push('--from', fromFile);
  }
  run('bake-shape-colour.mjs', bakeArgs);
  if (fromFile) rmSync(fromFile);
}
