#!/usr/bin/env node
/* global console, process */
/**
 * PRÉCONTRÔLE D'UNE COLLECTE ODE (GAL-A003-03). AUCUNE requête réseau : il ne lit que le cache et
 * le disque, et ne tire rien.
 *
 *   node scripts/ode-precheck.mjs --body mercury --cache-dir D:/donnees/ode \
 *        --backup-dir E:/sauvegardes/ode [--bytes-per-product 2000] [--json]
 *
 * Vérifie, pour le corps visé : les métadonnées complètes (tous les jeux), les exceptions de gel
 * (jeux sans date de création, ou gelés en partie), le gel au regard de l'index livré, le chemin
 * du cache, l'espace disque (cache ET sauvegarde) et la séparation cache/sauvegarde. Sortie
 * code 0 si tout est bon, 1 sinon, 2 pour un argument refusé.
 *
 * L'ESTIMATION DE TAILLE N'EST PAS UNE MESURE : aucune page n'existe encore sur ce poste. Elle
 * vaut produits × octets par produit (2 000 par défaut, hypothèse prudente) × 1,25, et sera
 * recalée sur la première page réellement tirée.
 */
import { existsSync, readFileSync, statfsSync } from 'node:fs';
import { dirname, join, parse, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FREEZE,
  PAGE,
  assertMetadataComplete,
  canWriteInto,
  datasetsFromIipt,
  freezeAction,
  resolveCacheDir,
  selectDatasets,
} from './ode-selection.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAFETY = 1.25;

const readJsonOrNull = (file) =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;

/** Octets libres du plus proche dossier existant au-dessus de `path`. */
export function freeBytes(path, statfs = statfsSync) {
  let dir = path;
  while (!existsSync(dir)) {
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const f = statfs(dir);
  return Number(f.bavail) * Number(f.bsize);
}

/** Vrai si `path` est dans `parent` (ou égal). */
const within = (path, parent) => {
  const rel = relative(resolve(parent), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * Le précontrôle, pur hors lecture de fichiers. Renvoie { ok, checks[], plan }.
 * `checks` : { name, ok, detail } ; une exception de gel n'est jamais un échec, elle est LISTÉE.
 */
export function precheck({
  body,
  cacheDir,
  backupDir,
  bytesPerProduct = 2000,
  deliveredIndex,
  statfs = statfsSync,
  root = ROOT,
}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  // 1. métadonnées complètes (tous les jeux, jamais la sélection)
  const iipt = readJsonOrNull(join(cacheDir, 'iipt.json'));
  const counts = readJsonOrNull(join(cacheDir, 'counts.json'));
  const redundancy = readJsonOrNull(join(cacheDir, 'redundancy.json'));
  const unfrozen = readJsonOrNull(join(cacheDir, 'unfrozen.json'));
  const freezeOnDisk = readJsonOrNull(join(cacheDir, 'freeze.json'));
  let full = [];
  if (!iipt || !counts || !redundancy) {
    add(
      'métadonnées présentes',
      false,
      `manque : ${[!iipt && 'iipt.json', !counts && 'counts.json', !redundancy && 'redundancy.json'].filter(Boolean).join(', ')} (se calculent par \`pull-ode-footprints.mjs --plan --body ${body} --cache-dir …\`, requêtes de comptage seulement)`
    );
  } else {
    full = datasetsFromIipt(iipt);
    try {
      assertMetadataComplete({
        list: full,
        counts,
        redundancy,
        unfrozen,
        freezeOnDisk,
        freeze: FREEZE,
      });
      add(
        'métadonnées complètes',
        true,
        `${full.length} jeux, counts/redundancy/unfrozen cohérents`
      );
    } catch (error) {
      add('métadonnées complètes', false, error.message);
    }
  }

  // 2. gel
  const delivered = deliveredIndex?.frozenAt ?? null;
  add(
    'gel du script = index livré',
    delivered === FREEZE.maxcreationtime,
    `script ${FREEZE.maxcreationtime}, index livré ${delivered}`
  );
  let freezeDetail;
  let freezeOk = true;
  try {
    const action = freezeAction(cacheDir);
    freezeDetail =
      action === 'present'
        ? `cache ${freezeOnDisk?.maxcreationtime}`
        : 'cache vierge : sera écrit au premier lancement';
    if (action === 'present')
      freezeOk = freezeOnDisk?.maxcreationtime === FREEZE.maxcreationtime;
  } catch (error) {
    freezeOk = false;
    freezeDetail = error.message;
  }
  add('freeze.json du cache', freezeOk, freezeDetail);

  // 3. sélection, plan, exceptions de gel
  let plan = null;
  if (full.length && counts && redundancy) {
    try {
      const picked = selectDatasets(full, { body });
      const todo = picked.filter(
        (s) => redundancy[s.key]?.verdict !== 'redundant' && counts[s.key] > 0
      );
      const products = todo.reduce((a, s) => a + counts[s.key], 0);
      const pages = todo.reduce(
        (a, s) => a + Math.ceil(counts[s.key] / PAGE),
        0
      );
      const exceptions = todo
        .filter((s) => unfrozen?.[s.key])
        .map((s) => ({
          key: s.key,
          frozen: unfrozen[s.key].frozen,
          all: unfrozen[s.key].all,
          kind:
            unfrozen[s.key].frozen === 0
              ? 'sans date de création'
              : 'gelé en partie',
        }));
      plan = { datasets: todo.length, products, pages, exceptions };
      add(
        'plan du corps',
        pages > 0,
        `${todo.length} jeux, ${products} produits, ${pages} pages (${picked.length - todo.length} jeu(x) redondant(s) ou vide(s) écarté(s))`
      );
    } catch (error) {
      add('plan du corps', false, error.message);
    }
  }

  // 4. chemins et disque
  const estimate = plan
    ? Math.ceil(plan.products * bytesPerProduct * SAFETY)
    : 0;
  const gib = (n) => `${(n / 2 ** 30).toFixed(1)} Gio`;
  add(
    'chemin du cache',
    !within(cacheDir, root),
    `${cacheDir} (hors du dépôt ${root})`
  );
  const cacheWrite = canWriteInto(cacheDir);
  add('cache inscriptible', cacheWrite.ok, cacheWrite.detail);
  const cacheFree = freeBytes(cacheDir, statfs);
  add(
    'espace du cache',
    cacheFree >= estimate,
    `${gib(cacheFree)} libres pour ${gib(estimate)} estimés (${bytesPerProduct} o/produit × ${SAFETY}, NON mesuré)`
  );
  if (!backupDir) add('sauvegarde', false, '--backup-dir manque');
  else {
    const sameTree = within(backupDir, cacheDir) || within(cacheDir, backupDir);
    add('sauvegarde distincte du cache', !sameTree, backupDir);
    const backupWrite = canWriteInto(backupDir);
    add('sauvegarde inscriptible', backupWrite.ok, backupWrite.detail);
    add('sauvegarde hors du dépôt', !within(backupDir, root), `${backupDir}`);
    add(
      'sauvegarde sur un autre volume',
      parse(resolve(backupDir)).root.toLowerCase() !==
        parse(resolve(cacheDir)).root.toLowerCase(),
      `${parse(resolve(cacheDir)).root} / ${parse(resolve(backupDir)).root}`
    );
    const backupFree = freeBytes(backupDir, statfs);
    add(
      'espace de la sauvegarde',
      backupFree >= estimate,
      `${gib(backupFree)} libres pour ${gib(estimate)} estimés`
    );
  }
  return { ok: checks.every((c) => c.ok), checks, plan, estimate };
}

function main() {
  const argv = process.argv.slice(2);
  const val = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const body = val('--body');
  try {
    const cacheDir = resolveCacheDir({
      arg: val('--cache-dir'),
      env: process.env.GALAXY_ODE_CACHE ?? null,
      root: ROOT,
      requireExternal: true,
    });
    const backupDir = val('--backup-dir');
    if (backupDir && !isAbsolute(backupDir))
      throw new Error('--backup-dir doit être un chemin absolu');
    const bpp = Number(val('--bytes-per-product') ?? 2000);
    if (!(bpp > 0)) throw new Error('--bytes-per-product invalide');
    const deliveredIndex = readJsonOrNull(
      join(ROOT, 'src', 'config', 'placeObservationIndex.json')
    );
    const result = precheck({
      body,
      cacheDir,
      backupDir,
      bytesPerProduct: bpp,
      deliveredIndex,
    });
    if (argv.includes('--json')) console.log(JSON.stringify(result, null, 1));
    else {
      for (const c of result.checks)
        console.log(`${c.ok ? 'OK    ' : 'ÉCHEC '} ${c.name} : ${c.detail}`);
      if (result.plan?.exceptions.length) {
        console.log(
          '\nExceptions de gel (pages tirées SANS gel, non reproductibles) :'
        );
        for (const e of result.plan.exceptions)
          console.log(`  ${e.key} : ${e.kind} (${e.frozen} gelés / ${e.all})`);
      }
      console.log(result.ok ? '\nPRÊT (aucune requête lancée)' : '\nNON PRÊT');
    }
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
